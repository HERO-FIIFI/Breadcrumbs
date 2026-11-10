import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import path from "node:path";

describe("extension smoke test harness", () => {
  it("has a dedicated Mocha runner entry point", () => {
    const runnerPath = path.resolve(__dirname, "smoke", "runTest.js");

    assert.equal(existsSync(runnerPath), true, "The extension host needs a Mocha runner to provide suite/test globals.");
  });

  it("launches the downloaded VS Code executable directly", () => {
    const launcherPath = path.resolve(__dirname, "run-extension-smoke.js");
    const launcher = readFileSync(launcherPath, "utf8");

    assert.doesNotMatch(launcher, /bin", "code\.cmd"/);
  });

  it("clears Electron's Node-mode environment flag before launching VS Code", () => {
    const launcherPath = path.resolve(__dirname, "run-extension-smoke.js");
    const launcher = readFileSync(launcherPath, "utf8");

    assert.match(launcher, /delete process\.env\.ELECTRON_RUN_AS_NODE/);
  });

  it("uses an isolated VS Code profile for smoke runs", () => {
    const launcherPath = path.resolve(__dirname, "run-extension-smoke.js");
    const launcher = readFileSync(launcherPath, "utf8");

    assert.match(launcher, /mkdtempSync/);
    assert.match(launcher, /reuseMachineInstall: true/);
  });

  it("declares the bundled Anime.js motion runtime", () => {
    const packageManifest = readFileSync(path.resolve(process.cwd(), "package.json"), "utf8");

    assert.match(packageManifest, /"animejs"/);
  });
});
