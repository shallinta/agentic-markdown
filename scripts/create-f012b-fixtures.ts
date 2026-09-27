import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f012b-"));
const samples = [
  {
    name: "01-mixed.markdown",
    text: "\uFEFF# 增量保存样本\r\n中文局部编辑：你好，世界🙂\n这一行保持 CRLF 不变。\r\n末行无换行🚀",
  },
  {
    name: "02-independent.md",
    text: "# 独立文档\n只修改这一句：保存消费者的局部差异。🙂\n另一行不应被改写。\n",
  },
];
for (const { name, text } of samples) {
  await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
}
console.info(`F-012b 一次性验收目录：${directory}`);
console.info("仅使用这些临时样本；保存会真实修改磁盘，不操作工作文档。");
console.info("01 初始：UTF-8 BOM，CRLF 2 / LF 1，无末尾换行，含中文和 emoji。");
console.info("02 初始：无 BOM，LF 3，有末尾换行，验证独立标签保存。");
console.info(
  "打开两篇，局部修改中文或 emoji，按 ⌘S；核对传输诊断为增量，并从磁盘确认保存内容。"
);
console.info("再次修改保存；切换标签检查选区/历史保持，再撤销或重做后保存。");
console.info(
  "只做局部替换时，01 的 BOM 与未触及行的混合换行应保持；跨行编辑按实际修改范围核对。"
);
console.info(
  "镜像失配/驱逐和迟到回执由自动测试覆盖，无需人为损坏真实文档或注入故障。"
);
