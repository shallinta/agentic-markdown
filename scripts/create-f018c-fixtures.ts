import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f018c-"));
const samples: [string, string][] = [
  [
    "01-local-protection.md",
    "# 普通标题保持排版\n\n普通 **粗体**。下一物理行为超长格式行。\n\n" +
      "**中文🙂** ".repeat(1800) +
      "\n\n## 普通末尾标题\n\n删除长行的大部分内容应恢复；撤销应再次保护。\n",
  ],
  [
    "02-code-and-quote.md",
    "# 长行只影响自身\n\n```md\nshort\n" +
      "**literal** ".repeat(1500) +
      "\nshort after\n```\n\n> 普通引用\n> " +
      "中文 ".repeat(4000) +
      "\n> 后续普通引用\n\n结束\n",
  ],
  [
    "03-threshold.markdown",
    "\uFEFF# 阈值与保真\r\n\r\n" + "x".repeat(10000) + "\n\n最后无换行",
  ],
];
for (const [name, text] of samples)
  await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
console.info(`F-018c 一次性验收目录：${directory}`);
console.info(
  "03 长行恰为10000 UTF-16单位；删一字应恢复、撤销再次保护。仅使用临时样本保存。"
);
