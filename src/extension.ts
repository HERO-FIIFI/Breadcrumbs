import * as vscode from "vscode";
import { buildPrompt, completeCrumb, getNonce, postJson as postJsonRequest, safeReadHistory, shouldRetryProviderStatus, type Crumb, type ExplanationResult, type JsonResult } from "./core";

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
let debounceTimer: NodeJS.Timeout | undefined;
let lastSelectionKey = "";
// Incremented on each explanation attempt; lets async completions detect stale UI updates.
let explanationRun = 0;

export function activate(context: vscode.ExtensionContext) {
  extensionContext = context;
  provider = new BreadcrumbsViewProvider(context);

  context.subscriptions.push(
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
    webviewView.webview.html = this.getHtml(webviewView.webview);

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

  private getHtml(webview: vscode.Webview) {
    const nonce = getNonce();

    return /* html */ `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style nonce="${nonce}">
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        color: var(--vscode-foreground);
        background: var(--vscode-sideBar-background);
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size);
      }

      button {
        border: 1px solid var(--vscode-button-border, transparent);
        border-radius: 4px;
        padding: 7px 10px;
        color: var(--vscode-button-foreground);
        background: var(--vscode-button-background);
        font: inherit;
        cursor: pointer;
      }

      button.secondary {
        color: var(--vscode-foreground);
        background: var(--vscode-input-background);
        border-color: var(--vscode-input-border, transparent);
      }

      .shell {
        display: grid;
        gap: 14px;
        padding: 14px;
      }

      .topbar,
      .actions,
      .meta,
      .crumb-head {
        display: flex;
        gap: 8px;
      }

      .topbar,
      .crumb-head {
        align-items: flex-start;
        justify-content: space-between;
      }

      h1,
      h2,
      h3,
      p {
        margin: 0;
      }

      h1 {
        font-size: 18px;
        letter-spacing: 0;
      }

      .status {
        min-width: 8px;
        height: 8px;
        margin-top: 7px;
        border-radius: 999px;
        background: var(--vscode-testing-iconQueued);
      }

      .status.on {
        background: var(--vscode-testing-iconPassed);
      }

      .card {
        border: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-panel-border));
        border-radius: 6px;
        padding: 12px;
        background: var(--vscode-editor-background);
      }

      .setup {
        display: grid;
        gap: 10px;
      }

      .setup-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .setup-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .line {
        overflow-wrap: anywhere;
        color: var(--vscode-textPreformat-foreground);
        font-family: var(--vscode-editor-font-family);
        line-height: 1.45;
        white-space: pre-wrap;
      }

      .explanation {
        margin-top: 10px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.55;
        white-space: pre-wrap;
      }

      .meta {
        flex-wrap: wrap;
        margin-top: 10px;
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }

      .pill {
        border: 1px solid var(--vscode-badge-background);
        border-radius: 999px;
        padding: 2px 7px;
      }

      .pill.connected {
        color: var(--vscode-testing-iconPassed);
        border-color: var(--vscode-testing-iconPassed);
      }

      .pill.missing {
        color: var(--vscode-testing-iconQueued);
        border-color: var(--vscode-testing-iconQueued);
      }

      .explanation.error {
        color: var(--vscode-errorForeground);
      }

      .history {
        display: grid;
        gap: 8px;
      }

      .crumb {
        border-left: 2px solid var(--vscode-focusBorder);
      }

      .crumb h3 {
        max-width: 70%;
        overflow: hidden;
        font-size: 12px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .small {
        color: var(--vscode-descriptionForeground);
        font-size: 11px;
      }

      .empty {
        border: 1px dashed var(--vscode-panel-border);
        border-radius: 6px;
        padding: 18px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.5;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="topbar">
        <div>
          <h1>Breadcrumbs</h1>
          <p class="small" id="modeLabel">Watching cursor</p>
        </div>
        <span class="status" id="statusDot" aria-hidden="true"></span>
      </section>

      <section class="actions">
        <button id="explainButton" type="button">Explain</button>
        <button id="toggleButton" class="secondary" type="button">Auto</button>
        <button id="clearButton" class="secondary" type="button">Clear</button>
      </section>

      <section class="card setup" aria-label="Provider account setup">
        <div class="setup-row">
          <div>
            <p class="small">AI provider</p>
            <h2 id="providerName">Gemini</h2>
          </div>
          <span class="pill" id="connectionStatus">Not connected</span>
        </div>
        <p class="small" id="connectionHelp">Connect a provider key to generate explanations.</p>
        <div class="setup-actions">
          <button id="providerButton" class="secondary" type="button">Choose</button>
          <button id="keyButton" type="button">Connect</button>
        </div>
        <button id="disconnectButton" class="secondary" type="button">Disconnect key</button>
      </section>

      <section class="card" id="activeCard">
        <p class="small">Current line</p>
        <p class="line" id="activeLine">Move your cursor inside a code file.</p>
        <p class="explanation" id="activeExplanation"></p>
        <div class="meta" id="activeMeta"></div>
      </section>

      <section>
        <p class="small">Trail</p>
        <div class="history" id="history"></div>
      </section>
    </main>

    <script nonce="${nonce}">
      const vscode = acquireVsCodeApi();
      const explainButton = document.querySelector("#explainButton");
      const toggleButton = document.querySelector("#toggleButton");
      const providerButton = document.querySelector("#providerButton");
      const keyButton = document.querySelector("#keyButton");
      const disconnectButton = document.querySelector("#disconnectButton");
      const clearButton = document.querySelector("#clearButton");
      const modeLabel = document.querySelector("#modeLabel");
      const statusDot = document.querySelector("#statusDot");
      const providerName = document.querySelector("#providerName");
      const connectionStatus = document.querySelector("#connectionStatus");
      const connectionHelp = document.querySelector("#connectionHelp");
      const activeLine = document.querySelector("#activeLine");
      const activeExplanation = document.querySelector("#activeExplanation");
      const activeMeta = document.querySelector("#activeMeta");
      const history = document.querySelector("#history");

      explainButton.addEventListener("click", () => vscode.postMessage({ type: "explainCurrent" }));
      toggleButton.addEventListener("click", () => vscode.postMessage({ type: "toggleAutoExplain" }));
      providerButton.addEventListener("click", () => vscode.postMessage({ type: "selectProvider" }));
      keyButton.addEventListener("click", () => vscode.postMessage({ type: "setApiKey" }));
      disconnectButton.addEventListener("click", () => vscode.postMessage({ type: "clearApiKey" }));
      clearButton.addEventListener("click", () => vscode.postMessage({ type: "clearHistory" }));

      window.addEventListener("message", (event) => {
        if (event.data.type !== "state") return;
        render(event.data);
      });

      function render(state) {
        const active = state.active || state.history[0];
        modeLabel.textContent = (state.autoExplain ? "Auto on" : "Auto paused") + " - " + state.provider;
        toggleButton.textContent = state.autoExplain ? "Pause" : "Resume";
        providerName.textContent = formatProvider(state.provider);
        providerButton.textContent = "Choose";
        keyButton.textContent = state.provider === "editor" ? "No key needed" : state.hasApiKey ? "Update key" : "Connect";
        keyButton.disabled = state.provider === "editor";
        disconnectButton.disabled = state.provider === "editor" || !state.hasApiKey;
        connectionStatus.textContent = state.provider === "editor" || state.hasApiKey ? "Connected" : "Not connected";
        connectionStatus.classList.toggle("connected", state.provider === "editor" || state.hasApiKey);
        connectionStatus.classList.toggle("missing", state.provider !== "editor" && !state.hasApiKey);
        connectionHelp.textContent = helpText(state.provider, state.hasApiKey);
        statusDot.classList.toggle("on", state.autoExplain);

        if (active) {
          activeLine.textContent = active.lineText || "(blank line)";
          activeExplanation.textContent = active.explanation || labelForStatus(active.status);
          activeExplanation.classList.toggle("error", active.status === "error");
          activeMeta.replaceChildren(
            pill(active.fileName),
            pill("line " + active.lineNumber),
            pill(active.languageId || "plain text")
          );
        }

        if (!state.history.length) {
          const empty = document.createElement("div");
          empty.className = "empty";
          empty.textContent = "Your cursor trail will appear here.";
          history.replaceChildren(empty);
          return;
        }

        history.replaceChildren(...state.history.map((crumb) => {
          const card = document.createElement("article");
          card.className = "card crumb";

          const head = document.createElement("div");
          head.className = "crumb-head";
          const title = document.createElement("h3");
          title.textContent = crumb.fileName;
          const line = document.createElement("span");
          line.className = "small";
          line.textContent = "L" + crumb.lineNumber;
          head.append(title, line);

          const text = document.createElement("p");
          text.className = "line";
          text.textContent = crumb.lineText || "(blank line)";

          const explanation = document.createElement("p");
          explanation.className = "explanation";
          explanation.classList.toggle("error", crumb.status === "error");
          explanation.textContent = crumb.explanation || labelForStatus(crumb.status);

          card.append(head, text, explanation);
          return card;
        }));
      }

      function pill(text) {
        const node = document.createElement("span");
        node.className = "pill";
        node.textContent = text;
        return node;
      }

      function labelForStatus(status) {
        if (status === "loading") return "Asking the language model...";
        if (status === "error") return "Could not generate an explanation.";
        return "Ready when you are.";
      }

      function formatProvider(provider) {
        if (provider === "openrouter") return "OpenRouter";
        if (provider === "groq") return "Groq";
        if (provider === "editor") return "Editor model";
        return "Gemini";
      }

      function helpText(provider, hasApiKey) {
        if (provider === "editor") return "Uses the language model account already connected to this editor.";
        if (hasApiKey) return "Your key is saved securely in VS Code SecretStorage.";
        return "Connect your " + formatProvider(provider) + " API key to start explaining code.";
      }
    </script>
  </body>
</html>`;
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
