import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f012e-"));
const samples = [
  {
    name: "01-code-blocks.md",
    text: [
      "# 代码围栏基础呈现",
      "",
      "原围栏与语言名始终可编辑，无代码执行按钮。",
      "",
      "```typescript",
      "const greeting = '中文🙂';",
      "# 此处不按标题排版",
      "- 此处不按列表排版",
      "<script>alert('不执行')</script>",
      "```",
      "",
      "~~~unknown-language",
      "未知语言同样只呈现原文，不加载高亮器。",
      "~~~",
      "",
      "    缩进代码保留四个空格",
      "    **不呈现粗体**",
      "",
      "```",
      "```",
      "",
      "- 列表外层",
      "",
      "  ```",
      "  # 列表内代码",
      "  ```",
      "",
      "```text",
      "长行：" + "中文测试🙂 English 0123456789 ".repeat(20),
      "```",
      "",
      "```unclosed",
      "未闭合围栏也按解析器识别结果显示。",
    ].join("\n"),
  },
  {
    name: "02-mixed.markdown",
    text: "\uFEFF```md\r\n中文🙂\n```\r\n末行无换行",
  },
  {
    name: "03-long-fence.md",
    text:
      "```text\n" +
      Array.from(
        { length: 1500 },
        (_, index) => `第 ${index + 1} 行 中文🙂`
      ).join("\n") +
      "\n```\n",
  },
];
for (const sample of samples)
  await writeFile(join(directory, sample.name), sample.text, {
    flag: "wx",
    mode: 0o600,
  });
console.info(`F-012e 一次性验收目录：${directory}`);
console.info(
  "02 初始 BOM、CRLF 2 / LF 1、无末尾换行。样本仅用于本片验证，不代表性能门槛。"
);
