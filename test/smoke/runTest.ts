import Mocha from "mocha";
import path from "node:path";

export async function run(): Promise<void> {
  const mocha = new Mocha({
    color: true,
    ui: "tdd",
  });

  mocha.addFile(path.resolve(__dirname, "index.js"));

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} extension-host smoke test${failures === 1 ? "" : "s"} failed.`));
        return;
      }
      resolve();
    });
  });
}
