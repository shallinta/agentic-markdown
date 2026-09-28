import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f018f-"));
const token = "**bold** [link](local.md) &amp; \\* ";
for (const units of [9999, 10000, 50000, 200000]) {
  const line = token.repeat(Math.ceil(units / token.length)).slice(0, units);
  await writeFile(
    join(directory, `${units}-dense.md`),
    "\uFEFF# 普通标题\r\n\n" + line + "\r\n\n**普通尾段** &amp;",
    { flag: "wx", mode: 0o600 }
  );
}
console.info(`F-018f 一次性验收目录：${directory}`);
