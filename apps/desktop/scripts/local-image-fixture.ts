import { mkdtemp, mkdir, copyFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "agentic-local-images-"));
await mkdir(join(root, "a"));
await mkdir(join(root, "b"));
const source = join(import.meta.dir, "../icon.iconset/icon_128x128.png");
await copyFile(source, join(root, "outside.png"));
for (const name of ["a", "b"])
  await copyFile(source, join(root, name, "图 像.png"));
await copyFile(
  join(import.meta.dir, "../icon.iconset/icon_128x128@2x.png"),
  join(root, "b/图 像.png")
);
const converted = Bun.spawnSync([
  "/usr/bin/sips",
  "-s",
  "format",
  "jpeg",
  source,
  "--out",
  join(root, "a/photo.jpg"),
]);
if (converted.exitCode !== 0) throw Error("JPEG fixture conversion failed");
await symlink("图 像.png", join(root, "a/alias.png"));
await symlink("../outside.png", join(root, "a/escape.png"));
await writeFile(join(root, "a/fake.png"), "<svg onload='alert(1)'/>");
await writeFile(
  join(root, "a/sample.md"),
  "# 本地图片验收\n\n![中文 PNG](图%20像.png)\n\n![JPEG](photo.jpg)\n\n![重复引用][same]\n\n[same]: 图%20像.png\n\n![范围内符号链接](alias.png)\n\n![拒绝越界](../outside.png)\n\n![拒绝逃逸链接](escape.png)\n\n![伪装 SVG](fake.png)\n\n![远程默认阻止](https://example.com/image.png)\n\n" +
    Array.from(
      { length: 50 },
      (_, i) => `段落 ${i}：滚动到末尾再观察远处图片。\n\n`
    ).join("") +
    "![末尾 JPEG](photo.jpg)\n"
);
await writeFile(
  join(root, "b/sample.md"),
  "# 第二文档\n\n![同名图片](图%20像.png)\n"
);
console.info(root);
