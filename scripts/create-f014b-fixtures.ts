import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f014b-"));
for (const [name, text] of [
  [
    "01-cjk.md",
    "# 日韩输入回归\n\n在这里输入：\n\n- 列表内输入：\n\n**粗体内输入** 与 `行内代码`\n\n```text\n代码块内输入：\n```\n\n中文🙂 日本語 한국어\n",
  ],
  ["02-mixed.markdown", "\uFEFF# 混合行尾\r\n- 起点\n尾🙂"],
  ["03-other.md", "# 第二文档\n\n用于独立选区和撤销历史回归。\n"],
  ["04-readonly.md", "# 只读样本\n日本語 한국어 中文🙂\n"],
] as const) {
  await writeFile(join(directory, name), text, {
    flag: "wx",
    mode: name === "04-readonly.md" ? 0o400 : 0o600,
  });
}
console.info(`F-014b 一次性样本目录：${directory}`);
console.info(
  "02 初始 BOM、CRLF 1 / LF 1、无末尾换行。合成样本不代替真实日/韩输入法验收。"
);
