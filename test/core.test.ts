import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt, completeCrumb, getNonce, postJson, safeReadHistory, shouldRetryProviderStatus, type Crumb, type FetchLike } from "../src/core";

const crumb: Crumb = {
  id: "crumb-1",
  fileName: "demo.ts",
  filePath: "/workspace/demo.ts",
  languageId: "typescript",
  lineNumber: 7,
  lineText: "const total = price * quantity;",
  selectedText: "",
  context: "  6: const quantity = 2;\n> 7: const total = price * quantity;",
  explanation: "",
  status: "loading",
  createdAt: 1,
};

describe("completeCrumb", () => {
  it("turns a successful explanation into a ready crumb", () => {
    const completed = completeCrumb(crumb, { ok: true, text: "Calculates the total cost." });

    assert.equal(completed.status, "ready");
    assert.equal(completed.explanation, "Calculates the total cost.");
  });

  it("turns a failed explanation into an error crumb", () => {
    const completed = completeCrumb(crumb, { ok: false, text: "Provider unavailable." });

    assert.equal(completed.status, "error");
    assert.equal(completed.explanation, "Provider unavailable.");
  });
});

describe("safeReadHistory", () => {
  it("recovers to an empty history when workspace state is corrupted", () => {
    assert.deepEqual(safeReadHistory({ bad: "state" }), []);
  });

  it("returns empty history for null input", () => {
    assert.deepEqual(safeReadHistory(null), []);
  });

  it("returns empty history for an empty array", () => {
    assert.deepEqual(safeReadHistory([]), []);
  });

  it("filters malformed entries while preserving valid crumbs", () => {
    assert.deepEqual(safeReadHistory([crumb, { id: "broken" }]), [crumb]);
  });

  it("filters crumbs with wrong-typed fields", () => {
    assert.deepEqual(safeReadHistory([{ ...crumb, lineNumber: "7" }]), []);
  });
});

describe("buildPrompt", () => {
  it("includes file, language, and marked context", () => {
    const prompt = buildPrompt(crumb);

    assert.match(prompt, /File: demo\.ts/);
    assert.match(prompt, /Language: typescript/);
    assert.match(prompt, /> 7: const total = price \* quantity;/);
  });

  it("includes selected text when provided", () => {
    const prompt = buildPrompt({ ...crumb, selectedText: "price * quantity" });

    assert.match(prompt, /Selected text:/);
    assert.match(prompt, /price \* quantity/);
  });
});

describe("getNonce", () => {
  it("returns a cryptographic-looking hex nonce", () => {
    assert.match(getNonce(), /^[a-f0-9]{32}$/);
  });
});

describe("shouldRetryProviderStatus", () => {
  it("retries rate limits and transient server failures", () => {
    assert.equal(shouldRetryProviderStatus(429), true);
    assert.equal(shouldRetryProviderStatus(500), true);
    assert.equal(shouldRetryProviderStatus(503), true);
  });

  it("retries request timeouts", () => {
    assert.equal(shouldRetryProviderStatus(408), true);
  });

  it("does not retry normal client errors", () => {
    assert.equal(shouldRetryProviderStatus(400), false);
    assert.equal(shouldRetryProviderStatus(401), false);
    assert.equal(shouldRetryProviderStatus(404), false);
  });

  it("does not retry status codes just below the 5xx threshold", () => {
    assert.equal(shouldRetryProviderStatus(499), false);
  });
});

describe("postJson", () => {
  const endpoint = "https://example.test/provider";
  const request = {
    headers: { "Content-Type": "application/json" },
    body: { prompt: "explain this" },
  };

  it("preserves HTTP status when an error response is not JSON", async () => {
    const fetchFn: FetchLike = async () => ({
      ok: false,
      status: 503,
      text: async () => "temporarily unavailable",
    });

    const result = await postJson(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, {
      ok: false,
      text: "Provider request failed with HTTP 503.",
    });
  });

  it("uses provider error messages from JSON error responses", async () => {
    const fetchFn: FetchLike = async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Invalid API key." } }),
    });

    const result = await postJson(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, {
      ok: false,
      text: "Invalid API key.",
    });
  });

  it("reports invalid JSON from a successful response as a provider error", async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "<html>not json</html>",
    });

    const result = await postJson(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, {
      ok: false,
      text: "Provider returned invalid JSON.",
    });
  });

  it("returns parsed data on a successful JSON response", async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: "ok" }),
    });

    const result = await postJson<{ result: string }>(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, { ok: true, data: { result: "ok" } });
  });

  it("returns empty data on a successful empty response body", async () => {
    const fetchFn: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
    });

    const result = await postJson(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, { ok: true, data: {} });
  });

  it("returns the HTTP status message when a JSON error body has no message field", async () => {
    const fetchFn: FetchLike = async () => ({
      ok: false,
      status: 503,
      text: async () => JSON.stringify({ error: {} }),
    });

    const result = await postJson(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, { ok: false, text: "Provider request failed with HTTP 503." });
  });

  it("returns the error message when fetch throws", async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error("Network failure");
    };

    const result = await postJson(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, { ok: false, text: "Network failure" });
  });

  it("returns a fallback message when fetch throws a non-Error value", async () => {
    const fetchFn: FetchLike = async () => {
      throw "unexpected";
    };

    const result = await postJson(endpoint, { ...request, fetchFn });

    assert.deepEqual(result, { ok: false, text: "Provider request failed." });
  });

  it("returns an error when the request times out", async () => {
    const fetchFn: FetchLike = () => new Promise(() => {});

    const result = await postJson(endpoint, { ...request, fetchFn, timeoutMs: 1 });

    assert.equal(result.ok, false);
  });
});
