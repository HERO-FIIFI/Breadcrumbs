import * as assert from "assert";
import * as vscode from "vscode";

suite("Breadcrumbs extension smoke", () => {
  test("activates and registers core commands", async () => {
    const extension = vscode.extensions.getExtension("breadcrumbs-labs.breadcrumbs");

    assert.ok(extension, "Extension should be discoverable by publisher and name.");
    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes("breadcrumbs.open"));
    assert.ok(commands.includes("breadcrumbs.explainCurrentLine"));
    assert.ok(commands.includes("breadcrumbs.toggleAutoExplain"));
    assert.ok(commands.includes("breadcrumbs.selectProvider"));
  });
});
