import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPrompt, completeCrumb, getNonce, safeReadHistory, shouldRetryProviderStatus, type Crumb } from "../src/core";

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

  it("filters malformed entries while preserving valid crumbs", () => {
    assert.deepEqual(safeReadHistory([crumb, { id: "broken" }]), [crumb]);
  });
});

describe("buildPrompt", () => {
  it("includes file, language, and marked context", () => {
    const prompt = buildPrompt(crumb);

    assert.match(prompt, /File: demo\.ts/);
    assert.match(prompt, /Language: typescript/);
    assert.match(prompt, /> 7: const total = price \* quantity;/);
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

  it("does not retry normal client errors", () => {
    assert.equal(shouldRetryProviderStatus(400), false);
    assert.equal(shouldRetryProviderStatus(401), false);
    assert.equal(shouldRetryProviderStatus(404), false);
  });
});
