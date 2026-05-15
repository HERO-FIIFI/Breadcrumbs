import * as path from "path";
import { downloadAndUnzipVSCode, runTests } from "@vscode/test-electron";

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "smoke", "index");
  const downloadedExecutablePath = await downloadAndUnzipVSCode("1.90.2");
  const vscodeRoot = path.dirname(downloadedExecutablePath);
  const vscodeExecutablePath = process.platform === "win32" ? path.join(vscodeRoot, "bin", "code.cmd") : downloadedExecutablePath;

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    version: "1.90.2",
    vscodeExecutablePath,
    launchArgs: ["--disable-extensions"],
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
