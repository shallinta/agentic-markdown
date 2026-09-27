import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f013a-"));
const samples = [
  {
    name: "01-mode.md",
    text: [
      "# 源码模式验证",
      "",
      "正文 **粗体中文🙂**、*斜体*、`inline code`。",
      "在本行输入中文，再切模式、撤销、重做与保存。",
      "",
      "```markdown",
      "# 围栏内原文 **保留标记**",
      "```",
      "",
      "<script>globalThis.__documentExecuted = true</script>",
      "![不加载图片](https://example.invalid/image.png)",
      "[不导航](https://example.invalid/)",
      "",
    ].join("\n"),
  },
  {
    name: "02-mixed.markdown",
    text: "\uFEFF## 第二篇标题\r\n**保留混合换行**\n`code`\r\n末行无换行",
  },
  {
    name: "03-scroll.md",
    text: Array.from(
      { length: 300 },
      (_, index) =>
        `## 第 ${index + 1} 节\n正文 **粗体**、*斜体* 和 \`code\`。\n\n`
    ).join(""),
  },
];
for (const { name, text } of samples) {
  await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
}
console.info(`F-013a 一次性验收目录：${directory}`);
console.info(
  "01/02 分别验证独立模式、选区与共享历史。保存会真实修改临时文件。"
);
console.info("02 初始 BOM、CRLF 2 / LF 1、无末尾换行；03 用于视口切换观察。");
