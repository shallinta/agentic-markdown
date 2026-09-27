import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f012f-"));
const samples: [string, string][] = [
  [
    "01-quotes-rules.md",
    "# 引用与分隔线\n\n普通正文，移开光标检查展示。\n\n> 中文🙂 **粗体**\n> > 嵌套引用\n>\n> 显式续行\nlazy continuation 继续区块边框\n\n- 列表\n  > 列表内引用\n\n> ```js\n> > literal 这个第二个大于号保持\n> ---\n> ```\n\n---\n\n* * *\n\n___\n\nSetext 标题不是分隔线\n---\n\n<script>\n> 原文不执行\n</script>\n",
  ],
  ["02-mixed.markdown", "\uFEFF> 中文🙂\r\n> 第二行\n\r\n---"],
  [
    "03-long-quotes.md",
    "# 长引用滚动\n\n" + "> 长引用中文🙂 English\n".repeat(1500),
  ],
];
for (const [name, content] of samples)
  await writeFile(join(directory, name), content, { flag: "wx", mode: 0o600 });
console.info(`F-012f 一次性验收目录：${directory}`);
console.info("02 含 BOM、CRLF 2 / LF 1、无末尾换行；不覆盖既有样本。");
