import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f012d-"));
const samples = [
  {
    name: "01-lists.md",
    text: [
      "# 列表基础排版",
      "",
      "在本行放置光标，观察下方列表。",
      "",
      "- 一级 **粗体中文🙂** 与 `code`",
      "  - 二级 *斜体*",
      "    - 三级条目",
      "- 第二个一级条目",
      "",
      "+ 加号标记",
      "+ 第二条",
      "",
      "* 星号标记",
      "* 第二条",
      "",
      "3. 保留起始数字",
      "9. 保留非连续编号，不自动改成 4",
      "   1. 嵌套有序条目",
      "",
      "12) 右括号分隔符保留",
      "15) 非连续编号保留",
      "",
      "- " +
        "这是一条用于缩窄窗口观察视觉折行与正文对齐的中文长条目。".repeat(8),
      "  原本带两个空格的物理续行。",
      "没有缩进的物理续行不自动改写。",
      "",
      "- [ ] 任务列表本轮只显示原文，不提供复选框",
      "",
      "```markdown",
      "- 围栏内不排版",
      "1. 围栏内保留数字",
      "```",
      "",
      "    - 缩进代码不排版",
      "",
      "\\- 转义内容不排版",
      "",
      "<script>",
      "- HTML 内不排版、不执行",
      "</script>",
      "",
    ].join("\n"),
  },
  {
    name: "02-mixed.markdown",
    text: "\uFEFF- BOM 列表\r\n  + 嵌套中文🙂\n- 第二项\r\n末行无换行",
  },
  {
    name: "03-scroll.md",
    text: Array.from(
      { length: 500 },
      (_, i) => `## 第 ${i + 1} 组\n\n- 第一项\n  - 子项\n- 第二项\n\n`
    ).join(""),
  },
];
for (const { name, text } of samples) {
  await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
}
console.info(`F-012d 一次性验收目录：${directory}`);
console.info(
  "01 验证列表呈现、显隐与原文复制；02 初始 BOM、CRLF 2 / LF 1、无末尾换行。"
);
console.info(
  "03 验证滚动呈现。保存会真实修改临时样本，不代表完整大文档性能验收。"
);
