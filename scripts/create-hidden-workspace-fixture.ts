import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-f026a-"));
for (const root of ["根甲", "根乙"]) {
  for (const branch of [".secret", ".git", "empty"])
    await mkdir(join(directory, root, branch), { recursive: true });
  for (const [name, body] of Object.entries({
    "normal.md": `# ${root} 普通文档\n`,
    ".hidden.md": `# ${root} 显式隐藏文档\n\n可输入临时内容，切换隐藏开关应保留 dirty 和撤销。\n`,
    ".secret/nested.md": `# ${root} 目录派生隐藏文档\n\n关闭隐藏显示仍保留本标签，不新增顶层独立入口。\n`,
    ".git/bad.md": "# 不得扫描或打开\n",
  })) {
    const path = join(directory, root, name);
    await writeFile(path, body, { flag: "wx", mode: 0o600 });
    console.info(`${createHash("sha256").update(body).digest("hex")}  ${path}`);
  }
  await symlink(".hidden.md", join(directory, root, "hidden-alias.md"));
  await symlink(".git/bad.md", join(directory, root, "git-alias.md"));
  await symlink(
    root === "根甲" ? "../根乙/normal.md" : "../根甲/normal.md",
    join(directory, root, "outside-alias.md")
  );
}
console.info(`F-026a 合成样本目录：${directory}`);
console.info(
  "先显式打开 根甲/.hidden.md，再加入两根；只开甲隐藏，树中打开甲/.secret/nested.md。关甲隐藏：前者恢复独立入口、后者仅保留标签；保持dirty/模式。清空重新加入及新进程显式授权验证偏好，不断网。"
);
