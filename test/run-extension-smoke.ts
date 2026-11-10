import * as path from "path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { runTests } from "@vscode/test-electron";

async function main() {
  delete process.env.ELECTRON_RUN_AS_NODE;

  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "smoke", "runTest");
  const profileRoot = mkdtempSync(path.join(tmpdir(), "breadcrumbs-vscode-test-"));
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    version: "1.90.2",
    reuseMachineInstall: true,
    launchArgs: [
      "--disable-extensions",
      `--extensions-dir=${path.join(profileRoot, "extensions")}`,
      `--user-data-dir=${path.join(profileRoot, "user-data")}`,
    ],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
