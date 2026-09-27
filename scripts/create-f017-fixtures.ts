import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f017-"));
for (const name of ["01-first.md", "02-second.md"]) {
  await writeFile(
    join(directory, name),
    `# ${name}\n关闭确认验收样本。请仅在 App 中添加测试文字，验证放弃不会写盘。\n`,
    { flag: "wx", mode: 0o600 }
  );
}
console.info(`F-017a 一次性验收目录：${directory}`);
console.info(
  "两份文件均可写；仅使用本次临时样本验证放弃，不操作真实工作文档。"
);
