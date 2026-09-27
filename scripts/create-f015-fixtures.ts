import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Explicitly disposable files for a feature that writes to disk. Never reuse
// the earlier read-only verification manifest as a save acceptance criterion.
const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f015-"));
const samples = [
  ["01-save.md", "# 手动保存\n请在这里追加 SAVE_OK，然后按 ⌘S。\n"],
  ["02-mixed.markdown", "\uFEFF# 混合换行\r\n第二行 LF\n孤立 CR\r末行无换行"],
  [
    "03-conflict.md",
    "# 外部修改\n打开后先在 App 修改，再用外部编辑器修改磁盘文件。\n",
  ],
  [
    "04-readonly.md",
    "# 无写权限\n此样本只用于验证保存失败不会丢失内存修改。\n",
  ],
  ["05-empty.md", ""],
] as const;
for (const [name, text] of samples) {
  await writeFile(join(directory, name), text, { flag: "wx", mode: 0o600 });
}
await chmod(join(directory, "04-readonly.md"), 0o400);
console.info(`F-015a 临时验收样本：${directory}`);
console.info("保存会真实修改这些文件；请勿使用重要文档验收。");
console.info("01：保存/再次编辑；02：BOM 与混合换行；03：外部修改冲突。");
console.info("04：只读权限（预期拒绝保存）；05：空文件保存。");
