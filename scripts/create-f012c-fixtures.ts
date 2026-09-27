import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f012c-"));
const samples = [
  {
    name: "01-formatting.md",
    text: [
      "# 一级标题：即时排版",
      "## 二级标题",
      "### 三级标题",
      "#### 四级标题",
      "##### 五级标题",
      "###### 六级标题",
      "",
      "普通正文，**粗体中文🙂**、*斜体*、`inline code`。",
      "也支持 __粗体__ 与 _斜体_，以及 ***粗斜体***。",
      "在这行练习中文输入，然后撤销、重做和保存。",
      "",
      "转义：\\*不是斜体\\*，未闭合：**不要隐藏。",
      "",
      "```markdown",
      "# 围栏内不是标题",
      "**这里不是粗体**，*这里不是斜体*。",
      "```",
      "",
      "<script>globalThis.__documentExecuted = true</script>",
      "![不加载图片](https://example.invalid/image.png)",
      "[不打开链接](https://example.invalid/)",
      "",
      "末行：跨段选区应复制原始 Markdown。",
      "",
    ].join("\n"),
  },
  {
    name: "02-mixed.markdown",
    text: "\uFEFF# BOM 标题\r\n**中文🙂** 与 `code`\n这一行保持 CRLF。\r\n末行无换行",
  },
  {
    name: "03-scroll.md",
    text: Array.from(
      { length: 1200 },
      (_, index) =>
        `## 第 ${index + 1} 节\n正文 **粗体**、*斜体* 和 \`code\`，用于滚动观察。\n\n`
    ).join(""),
  },
];
for (const { name, text } of samples) {
  await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
}
console.info(`F-012c 一次性验收目录：${directory}`);
console.info(
  "仅使用临时样本，保存会真实修改磁盘。01 验证排版、显隐与原文复制。"
);
console.info("02 初始 BOM、CRLF 2 / LF 1、无末尾换行；只做局部编辑验证保真。");
console.info("03 用于滚动观察，不是性能门槛或完整大文档能力承诺。");
