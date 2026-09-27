import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f016-"));
await writeFile(
  join(directory, "01-writable.md"),
  "# 可写样本\n用于编辑后切为只读，再恢复权限；已有修改不应丢失。\n",
  { flag: "wx", mode: 0o600 }
);
await writeFile(
  join(directory, "02-readonly.md"),
  "# 只读样本\n可以选择和复制，不能输入、剪切、粘贴、撤销或保存。\n",
  { flag: "wx", mode: 0o400 }
);
const parent = join(directory, "readonly-parent");
await mkdir(parent, { mode: 0o700 });
await writeFile(
  join(parent, "03-parent-readonly.md"),
  "# 父目录只读\n文件可写，但父目录无法执行安全原子替换，应禁写。\n",
  { flag: "wx", mode: 0o600 }
);
await chmod(parent, 0o500);
console.info(`F-016a 一次性验收目录：${directory}`);
console.info("只对本次生成的样本测试权限变化，切勿对真实工作文件执行。");
console.info(`切为只读：chmod 400 '${join(directory, "01-writable.md")}'`);
console.info(`恢复可写：chmod 600 '${join(directory, "01-writable.md")}'`);
console.info(`恢复父目录可写：chmod 700 '${parent}'`);
