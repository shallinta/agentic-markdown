import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f014-"));
const samples = [
  ["01-history.md", "# 撤销与输入法\n在此输入中文，测试撤销、重做和保存。\n"],
  ["02-independent.md", "# 独立历史\n此文档的修改不应被另一标签的撤销影响。\n"],
  ["03-mixed.markdown", "\uFEFF# 保真历史\r\n第二行 LF\n孤立 CR\r末行无换行"],
] as const;
for (const [name, text] of samples)
  await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
console.info(`F-014a 临时验收样本：${directory}`);
console.info("仅使用这些一次性样本；手动保存会真实写盘。");
console.info(
  "01：真实中文输入法/保存后撤销；02：跨标签独立历史；03：混合换行保真。"
);
