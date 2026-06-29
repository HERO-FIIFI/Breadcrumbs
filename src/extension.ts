import * as vscode from "vscode";
import { buildPrompt, completeCrumb, postJson as postJsonRequest, safeReadHistory, shouldRetryProviderStatus, type Crumb, type ExplanationResult, type JsonResult } from "./core";
import { getWebviewHtml } from "./webview";

type WebviewMessage =
  | { type: "explainCurrent" }
  | { type: "clearHistory" }
  | { type: "toggleAutoExplain" }
  | { type: "setApiKey" }
  | { type: "clearApiKey" }
  | { type: "selectProvider" };

type ProviderId = "gemini" | "openrouter" | "groq" | "editor";

const HISTORY_KEY = "breadcrumbs.history.v1";
const AUTO_EXPLAIN_KEY = "breadcrumbs.autoExplain.runtime";
const PRIVACY_NOTICE_KEY = "breadcrumbs.privacyNoticeAccepted.v1";
const SECRET_KEYS: Record<Exclude<ProviderId, "editor">, string> = {
  gemini: "breadcrumbs.geminiApiKey",
  openrouter: "breadcrumbs.openRouterApiKey",
  groq: "breadcrumbs.groqApiKey",
};

let provider: BreadcrumbsViewProvider;
let extensionContext: vscode.ExtensionContext;
let logChannel: vscode.OutputChannel;
let debounceTimer: NodeJS.Timeout | undefined;
let lastSelectionKey = "";
// Incremented on each explanation attempt; lets async completions detect stale UI updates.
let explanationRun = 0;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  logChannel = vscode.window.createOutputChannel("Breadcrumbs");
  provider = new BreadcrumbsViewProvider(context);

  context.subscriptions.push(
    logChannel,
    vscode.window.registerWebviewViewProvider(BreadcrumbsViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.window.onDidChangeActiveTextEditor(() => {
      lastSelectionKey = "";
      scheduleCursorUpdate(context, false);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const selectionKey = `${event.textEditor.document.uri.toString()}:${event.textEditor.selection.active.line}`;
      if (selectionKey === lastSelectionKey) {
        return;
      }
      lastSelectionKey = selectionKey;
      scheduleCursorUpdate(context, false);
    }),
    vscode.commands.registerCommand("breadcrumbs.open", () => vscode.commands.executeCommand("breadcrumbs.trailView.focus")),
    vscode.commands.registerCommand("breadcrumbs.explainCurrentLine", () => explainCurrentLine(context, true)),
    vscode.commands.registerCommand("breadcrumbs.toggleAutoExplain", () => toggleAutoExplain(context)),
    vscode.commands.registerCommand("breadcrumbs.clearHistory", () => clearHistory(context)),
    vscode.commands.registerCommand("breadcrumbs.setApiKey", () => setApiKey(context)),
    vscode.commands.registerCommand("breadcrumbs.clearApiKey", () => clearApiKey(context)),
    vscode.commands.registerCommand("breadcrumbs.selectProvider", () => selectProvider(context)),
  );

  scheduleCursorUpdate(context, false);
}

export function deactivate() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
}

class BreadcrumbsViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "breadcrumbs.trailView";

  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [] };
    webviewView.webview.html = getWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === "explainCurrent") {
        void explainCurrentLine(this.context, true);
      }
      if (message.type === "clearHistory") {
        void clearHistory(this.context);
      }
      if (message.type === "toggleAutoExplain") {
        void toggleAutoExplain(this.context);
      }
      if (message.type === "setApiKey") {
        void setApiKey(this.context);
      }
      if (message.type === "clearApiKey") {
        void clearApiKey(this.context);
      }
      if (message.type === "selectProvider") {
        void selectProvider(this.context);
      }
    });

    this.publishState();
  }

  publishState(active?: Crumb) {
    void this.createState(active).then((state) => this.postMessage(state));
  }

  private async createState(active?: Crumb) {
    const selectedProvider = getProvider();
    return {
      type: "state",
      active,
      history: readHistory(this.context).map(({ filePath: _fp, ...rest }) => rest),
      autoExplain: isAutoExplainEnabled(this.context),
      provider: selectedProvider,
      hasApiKey: await hasProviderApiKey(selectedProvider),
    };
  }

  private postMessage(payload: unknown) {
    void this.view?.webview.postMessage(payload);
  }
}

function scheduleCursorUpdate(context: vscode.ExtensionContext, forceExplain: boolean) {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  const debounceMs = forceExplain ? 0 : getConfig("debounceMs", 650);
  debounceTimer = setTimeout(() => {
    void explainCurrentLine(context, forceExplain);
  }, debounceMs);
}

async function explainCurrentLine(context: vscode.ExtensionContext, forceExplain: boolean) {
  const crumb = createCrumbFromEditor();
  if (!crumb) {
    provider.publishState();
    return;
  }

  const shouldExplain = forceExplain || isAutoExplainEnabled(context);
  const existing = findMatchingCrumb(context, crumb);
  const nextCrumb = existing && !forceExplain ? existing : crumb;

  if (!shouldExplain) {
    await persistCrumb(context, nextCrumb);
    provider.publishState(nextCrumb);
    return;
  }

  const acceptedNotice = await ensurePrivacyNoticeAccepted(context);
  if (!acceptedNotice) {
    await persistCrumb(context, nextCrumb);
    provider.publishState(nextCrumb);
    return;
  }

  const runId = ++explanationRun;
  const loadingCrumb: Crumb = { ...nextCrumb, status: "loading", explanation: "" };
  await persistCrumb(context, loadingCrumb);
  provider.publishState(loadingCrumb);

  const explanation = await generateExplanation(loadingCrumb);
  const readyCrumb = completeCrumb(loadingCrumb, explanation);

  if (!explanation.ok) {
    logChannel.appendLine(`[Error] ${explanation.text}`);
  }

  if (runId !== explanationRun) {
    await persistCrumb(context, readyCrumb);
    return;
  }

  await persistCrumb(context, readyCrumb);
  provider.publishState(readyCrumb);
}

function createCrumbFromEditor(): Crumb | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") {
    return undefined;
  }

  const document = editor.document;
  const activeLine = editor.selection.active.line;
  const contextRadius = getConfig("contextRadius", 8);
  const start = Math.max(0, activeLine - contextRadius);
  const end = Math.min(document.lineCount - 1, activeLine + contextRadius);
  const contextLines: string[] = [];

  for (let line = start; line <= end; line += 1) {
    const marker = line === activeLine ? ">" : " ";
    contextLines.push(`${marker} ${line + 1}: ${document.lineAt(line).text}`);
  }

  const selectedText = editor.selection.isEmpty ? "" : document.getText(editor.selection).slice(0, 2000);
  const fileName = document.fileName.split(/[\\/]/).pop() || document.fileName;

  return {
    id: `${document.uri.toString()}:${activeLine + 1}:${Date.now()}`,
    fileName,
    filePath: document.fileName,
    languageId: document.languageId,
    lineNumber: activeLine + 1,
    lineText: document.lineAt(activeLine).text.trim(),
    selectedText,
    context: contextLines.join("\n"),
    explanation: "",
    status: "idle",
    createdAt: Date.now(),
  };
}

async function generateExplanation(crumb: Crumb): Promise<ExplanationResult> {
  const selectedProvider = getProvider();

  if (selectedProvider === "gemini") {
    return generateGeminiExplanation(crumb);
  }
  if (selectedProvider === "openrouter") {
    return generateOpenRouterExplanation(crumb);
  }
  if (selectedProvider === "groq") {
    return generateGroqExplanation(crumb);
  }

  return generateEditorExplanation(crumb);
}

async function generateEditorExplanation(crumb: Crumb): Promise<ExplanationResult> {
  // @types/vscode@1.90 does not expose all LM API shapes used by newer hosts.
  const lm = (vscode as unknown as { lm?: unknown }).lm as
    | {
        selectChatModels?: (selector?: Record<string, unknown>) => Promise<unknown[]>;
      }
    | undefined;

  if (!lm?.selectChatModels) {
    return {
      ok: false,
      text: "No VS Code language model API is available in this host. Select Gemini, OpenRouter, or Groq and add an API key with Breadcrumbs: Set Provider API Key.",
    };
  }

  const models = await lm.selectChatModels({});
  const model = models[0] as
    | {
        sendRequest?: (messages: unknown[], options: Record<string, unknown>, token: vscode.CancellationToken) => Promise<{ text?: AsyncIterable<string> }>;
      }
    | undefined;

  if (!model?.sendRequest) {
    return {
      ok: false,
      text: "No chat model is available. In VS Code, sign in to a provider such as GitHub Copilot Chat. In Cursor, use this as the UI shell and connect the explainer to your preferred model endpoint.",
    };
  }

  const prompt = buildPrompt(crumb);

  try {
    const messageFactory = (vscode as unknown as {
      LanguageModelChatMessage?: { User: (content: string) => unknown };
    }).LanguageModelChatMessage;
    const messages = messageFactory?.User ? [messageFactory.User(prompt)] : [{ role: "user", content: prompt }];
    const cancellation = new vscode.CancellationTokenSource();
    try {
      const response = await model.sendRequest(messages, {}, cancellation.token);
      let text = "";
      for await (const chunk of response.text ?? []) {
        text += chunk;
      }
      return { ok: true, text: text.trim() || "The model returned an empty response." };
    } catch (error) {
      return {
        ok: false,
        text: error instanceof Error ? error.message : "The language model request failed.",
      };
    } finally {
      cancellation.dispose();
    }
  } catch (error) {
    return {
      ok: false,
      text: error instanceof Error ? error.message : "The language model request failed.",
    };
  }
}

async function generateGeminiExplanation(crumb: Crumb): Promise<ExplanationResult> {
  const apiKey = await getProviderApiKey("gemini");
  if (!apiKey) {
    return missingKeyResult("Gemini");
  }

  const model = getConfig("geminiModel", "gemini-2.5-flash");
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const result = await postJson<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  }>(endpoint, {
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: buildPrompt(crumb) }],
        },
      ],
      generationConfig: {
        maxOutputTokens: getConfig("maxOutputTokens", 180),
        temperature: 0.2,
      },
    },
  });

  if (!result.ok) {
    return result;
  }

  const text = result.data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  return text ? { ok: true, text } : { ok: false, text: "Gemini returned an empty response." };
}

async function generateOpenRouterExplanation(crumb: Crumb): Promise<ExplanationResult> {
  const apiKey = await getProviderApiKey("openrouter");
  if (!apiKey) {
    return missingKeyResult("OpenRouter");
  }

  const result = await postOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", apiKey, {
    model: getConfig("openRouterModel", "google/gemma-3-27b-it:free"),
    prompt: buildPrompt(crumb),
    extraHeaders: {
      "HTTP-Referer": "https://breadcrumbs.local",
      "X-Title": "Breadcrumbs",
    },
  });

  return result;
}

async function generateGroqExplanation(crumb: Crumb): Promise<ExplanationResult> {
  const apiKey = await getProviderApiKey("groq");
  if (!apiKey) {
    return missingKeyResult("Groq");
  }

  return postOpenAiCompatible("https://api.groq.com/openai/v1/chat/completions", apiKey, {
    model: getConfig("groqModel", "llama-3.1-8b-instant"),
    prompt: buildPrompt(crumb),
  });
}

async function postOpenAiCompatible(
  endpoint: string,
  apiKey: string,
  options: { model: string; prompt: string; extraHeaders?: Record<string, string> },
): Promise<ExplanationResult> {
  const result = await postJson<{
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  }>(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...options.extraHeaders,
    },
    body: {
      model: options.model,
      messages: [
        {
          role: "system",
          content: "You explain code briefly for a developer reading line by line.",
        },
        {
          role: "user",
          content: options.prompt,
        },
      ],
      max_tokens: getConfig("maxOutputTokens", 180),
      temperature: 0.2,
      stream: false,
    },
  });

  if (!result.ok) {
    return result;
  }

  const text = result.data.choices?.[0]?.message?.content?.trim();
  return text ? { ok: true, text } : { ok: false, text: "The provider returned an empty response." };
}

async function postJson<T>(
  endpoint: string,
  options: { headers: Record<string, string>; body: unknown },
): Promise<JsonResult<T>> {
  let result: JsonResult<T> = { ok: false, text: "Provider request was not attempted." };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await postJsonCore<T>(endpoint, options);
    if (result.ok || !isRetryableProviderError(result.text) || attempt === 1) {
      return result;
    }
    await wait(200 + Math.floor(Math.random() * 300));
  }

  return result;
}

async function postJsonCore<T>(
  endpoint: string,
  options: { headers: Record<string, string>; body: unknown },
): Promise<JsonResult<T>> {
  return postJsonRequest<T>(endpoint, {
    ...options,
    timeoutMs: getConfig("providerTimeoutMs", 12000),
  });
}

function isRetryableProviderError(message: string) {
  const statusMatch = message.match(/HTTP (\d+)/);
  return statusMatch ? shouldRetryProviderStatus(Number(statusMatch[1])) : /aborted|timeout|network/i.test(message);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function missingKeyResult(providerName: string): ExplanationResult {
  return {
    ok: false,
    text: `${providerName} is selected, but no API key is saved. Run Breadcrumbs: Set Provider API Key.`,
  };
}

async function persistCrumb(context: vscode.ExtensionContext, crumb: Crumb) {
  const maxHistory = getConfig("maxHistory", 80);
  const history = readHistory(context).filter(
    (entry) => !(entry.filePath === crumb.filePath && entry.lineNumber === crumb.lineNumber),
  );
  await context.workspaceState.update(HISTORY_KEY, [crumb, ...history].slice(0, maxHistory));
}

function readHistory(context: vscode.ExtensionContext): Crumb[] {
  return safeReadHistory(context.workspaceState.get<unknown>(HISTORY_KEY, []));
}

function findMatchingCrumb(context: vscode.ExtensionContext, crumb: Crumb) {
  return readHistory(context).find(
    (entry) =>
      entry.filePath === crumb.filePath &&
      entry.lineNumber === crumb.lineNumber &&
      entry.lineText === crumb.lineText &&
      entry.status === "ready",
  );
}

async function toggleAutoExplain(context: vscode.ExtensionContext) {
  const nextValue = !isAutoExplainEnabled(context);
  await context.globalState.update(AUTO_EXPLAIN_KEY, nextValue);
  provider.publishState();
  vscode.window.setStatusBarMessage(`Breadcrumbs auto explain ${nextValue ? "enabled" : "paused"}.`, 1800);
}

async function clearHistory(context: vscode.ExtensionContext) {
  await context.workspaceState.update(HISTORY_KEY, []);
  provider.publishState();
}

async function ensurePrivacyNoticeAccepted(context: vscode.ExtensionContext) {
  if (context.globalState.get<boolean>(PRIVACY_NOTICE_KEY, false)) {
    return true;
  }

  const choice = await vscode.window.showWarningMessage(
    "Breadcrumbs sends the current line and surrounding code context to your selected AI provider for explanations.",
    "Continue",
    "Pause Auto Explain",
  );

  if (choice === "Continue") {
    await context.globalState.update(PRIVACY_NOTICE_KEY, true);
    return true;
  }

  if (choice === "Pause Auto Explain") {
    await context.globalState.update(AUTO_EXPLAIN_KEY, false);
    provider.publishState();
  }

  return false;
}

async function selectProvider(context: vscode.ExtensionContext) {
  const picked = await vscode.window.showQuickPick(
    [
      { label: "gemini", description: "Google Gemini API, good default free-tier option" },
      { label: "openrouter", description: "OpenRouter free model variants and paid fallback" },
      { label: "groq", description: "Groq fast inference free plan and paid fallback" },
      { label: "editor", description: "VS Code Language Model API from the host editor" },
    ],
    {
      placeHolder: "Choose the Breadcrumbs explanation provider",
    },
  );

  if (!picked) {
    return;
  }

  await vscode.workspace
    .getConfiguration("breadcrumbs")
    .update("provider", picked.label, vscode.ConfigurationTarget.Global);
  provider.publishState();
  vscode.window.setStatusBarMessage(`Breadcrumbs provider set to ${picked.label}.`, 1800);
}

async function setApiKey(context: vscode.ExtensionContext) {
  const selectedProvider = getProvider();
  if (selectedProvider === "editor") {
    vscode.window.showInformationMessage("The editor provider does not need a Breadcrumbs API key.");
    return;
  }

  const apiKey = await vscode.window.showInputBox({
    title: `Set ${selectedProvider} API key`,
    prompt: "The key is stored in VS Code SecretStorage, not in settings.json.",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim() ? undefined : "Enter an API key."),
  });

  if (!apiKey) {
    return;
  }

  await context.secrets.store(SECRET_KEYS[selectedProvider], apiKey.trim());
  provider.publishState();
  vscode.window.showInformationMessage(`Breadcrumbs saved the ${selectedProvider} API key.`);
}

async function clearApiKey(context: vscode.ExtensionContext) {
  const selectedProvider = getProvider();
  if (selectedProvider === "editor") {
    vscode.window.showInformationMessage("The editor provider does not use a Breadcrumbs API key.");
    return;
  }

  await context.secrets.delete(SECRET_KEYS[selectedProvider]);
  provider.publishState();
  vscode.window.showInformationMessage(`Breadcrumbs cleared the ${selectedProvider} API key.`);
}

function isAutoExplainEnabled(context: vscode.ExtensionContext) {
  return context.globalState.get<boolean>(AUTO_EXPLAIN_KEY, getConfig("autoExplain", true));
}

function getProvider(): ProviderId {
  const providerId = getConfig<ProviderId>("provider", "gemini");
  if (providerId === "gemini" || providerId === "openrouter" || providerId === "groq" || providerId === "editor") {
    return providerId;
  }
  return "gemini";
}

async function getProviderApiKey(providerId: Exclude<ProviderId, "editor">) {
  return extensionContext.secrets.get(SECRET_KEYS[providerId]);
}

async function hasProviderApiKey(providerId: ProviderId) {
  if (providerId === "editor") {
    return true;
  }
  return Boolean(await getProviderApiKey(providerId));
}

function getConfig<T>(key: string, fallback: T): T {
  return vscode.workspace.getConfiguration("breadcrumbs").get<T>(key, fallback);
}
