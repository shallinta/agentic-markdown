import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

test("live-formatting can initialize first in a fresh process", () => {
  const path = fileURLToPath(new URL("./live-formatting.ts", import.meta.url));
  const result = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      `const m = await import(${JSON.stringify(path)}); if (!m.editingMarkdown || !m.livePresentation) throw Error("missing exports");`,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  expect(new TextDecoder().decode(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
});
