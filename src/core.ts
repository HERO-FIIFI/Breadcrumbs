import { randomBytes } from "crypto";

export type CrumbStatus = "idle" | "loading" | "ready" | "error";

export type Crumb = {
  id: string;
  fileName: string;
  filePath: string;
  languageId: string;
  lineNumber: number;
  lineText: string;
  selectedText: string;
  context: string;
  explanation: string;
  status: CrumbStatus;
  createdAt: number;
};

export type ExplanationResult = { ok: true; text: string } | { ok: false; text: string };

export type JsonResult<T> = { ok: true; data: T } | { ok: false; text: string };

export type FetchLike = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}>;

export function completeCrumb(loadingCrumb: Crumb, explanation: ExplanationResult): Crumb {
  return {
    ...loadingCrumb,
    status: explanation.ok ? "ready" : "error",
    explanation: explanation.text,
  };
}

export function safeReadHistory(value: unknown): Crumb[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isCrumb);
}

export function buildPrompt(crumb: Crumb) {
  return [
    "Explain the marked code line for a developer who is reading quickly.",
    "Keep it to 1-3 plain-English sentences.",
    "Mention important side effects, data flow, or gotchas if they matter.",
    "",
    `File: ${crumb.fileName}`,
    `Language: ${crumb.languageId}`,
    "",
    "Context:",
    crumb.context,
    crumb.selectedText ? `\nSelected text:\n${crumb.selectedText}` : "",
  ].join("\n");
}

export function getNonce() {
  return randomBytes(16).toString("hex");
}

export async function postJson<T>(
  endpoint: string,
  options: { headers: Record<string, string>; body: unknown; timeoutMs?: number; fetchFn?: FetchLike },
): Promise<JsonResult<T>> {
  const timeoutMs = options.timeoutMs ?? 12000;
  const fetchFn = options.fetchFn ?? (fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn(endpoint, {
      method: "POST",
      headers: options.headers,
      body: JSON.stringify(options.body),
      signal: controller.signal,
    });
    const rawText = await response.text();
    const data = rawText ? (JSON.parse(rawText) as T & { error?: { message?: string } }) : ({} as T & { error?: { message?: string } });

    if (!response.ok) {
      return {
        ok: false,
        text: data.error?.message || `Provider request failed with HTTP ${response.status}.`,
      };
    }

    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      text: error instanceof Error ? error.message : "Provider request failed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function shouldRetryProviderStatus(status: number) {
  return status === 408 || status === 429 || status >= 500;
}

function isCrumb(value: unknown): value is Crumb {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Crumb>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.fileName === "string" &&
    typeof candidate.filePath === "string" &&
    typeof candidate.languageId === "string" &&
    typeof candidate.lineNumber === "number" &&
    typeof candidate.lineText === "string" &&
    typeof candidate.selectedText === "string" &&
    typeof candidate.context === "string" &&
    typeof candidate.explanation === "string" &&
    typeof candidate.createdAt === "number" &&
    (candidate.status === "idle" || candidate.status === "loading" || candidate.status === "ready" || candidate.status === "error")
  );
}
