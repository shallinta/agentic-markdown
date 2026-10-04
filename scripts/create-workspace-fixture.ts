import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = await mkdtemp(join(tmpdir(), "agentic-workspace-"));
for (const directory of [
  "根甲/子目录",
  "根甲/空目录",
  "根甲/非文档枝",
  "根甲/.隐藏目录",
  "根甲/.git",
  "根乙",
])
  await mkdir(join(fixture, directory), { recursive: true });
for (const [path, text] of Object.entries({
  "根甲/欢迎.md": "# 目录甲\n\n可编辑的合成样本。\n",
  "根甲/子目录/中文.markdown": "# 子目录文档\n",
  "根甲/.隐藏.md": "# 显式隐藏独立文档\n",
  "根甲/.隐藏目录/隐含.md": "# 默认不发现\n",
  "根甲/.git/禁止.md": "# 不允许打开\n",
  "根甲/非文档枝/text.txt": "不是 Markdown",
  "根乙/第二根.md": "# 目录乙\n",
  "外部.md": "# 尚未授权外部\n",
}))
  await writeFile(join(fixture, path), text);
for (const [name, target] of Object.entries({
  目录链接: "子目录",
  "内部链接.md": "欢迎.md",
  "跨根链接.md": "../根乙/第二根.md",
  "外部链接.md": "../外部.md",
  "失效.md": "missing.md",
  "循环甲.md": "循环乙.md",
  "循环乙.md": "循环甲.md",
}))
  await symlink(target, join(fixture, "根甲", name));
console.info(
  JSON.stringify(
    {
      fixture,
      order: [
        "先打开 根甲/欢迎.md，编辑保持未保存并切换模式",
        "打开 根甲/.隐藏.md 作为显式隐藏独立文件",
        "加入 根甲/子目录，再加入 根甲，检查覆盖、dirty和隐藏独立项",
        "加入 根乙，检查两根、链接唯一性及展开/单击选择/双击和Enter打开",
        "检查扫描态/空枝排除/命令及外观；.git/禁止.md必须拒绝",
        "完成后清空窗口须先保护未保存变更；样本可由主线确认后清理",
      ],
      roots: [join(fixture, "根甲"), join(fixture, "根乙")],
    },
    null,
    2
  )
);
