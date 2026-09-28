import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-cross-mode-"));
for (const fileName of ["01-current.md", "02-other.markdown"])
  await writeFile(
    join(directory, fileName),
    "\uFEFF# 跨模式验收\r\n\n**普通文本** &amp;\n中文🙂\r\n尾段",
    { flag: "wx", mode: 0o600 }
  );
console.info(`跨模式一次性验收目录：${directory}`);
