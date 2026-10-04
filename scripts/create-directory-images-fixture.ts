import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

// Fully synthetic RGB PNGs: no external assets, downloads, or network changes.
function png(rgb: number[]) {
  const chunk = (type: string, bytes: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), bytes]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([size, body, checksum]);
  };
  const width = 160,
    height = 90,
    header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const scan = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++)
        scan[y * (width * 3 + 1) + x * 3 + c + 1] = rgb[c]!;
    }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scan)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const directory = await mkdtemp(join(tmpdir(), "agentic-f022b-"));
for (const path of ["root/notes", "root/assets", "other/notes", "other/assets"])
  await mkdir(join(directory, path), { recursive: true });
const text =
  "# 目录图片 A\n\n可在这里输入临时文字，切阅读观察后撤销；不要保存原始样本。\n\n![根内橙图](../assets/a.png)\n\n![引用式橙图][same]\n\n[same]: ../assets/a.png\n\n![外部拒绝](../../outside.png)\n\n![越界符号链接拒绝](../assets/escape.png)\n";
const files: Record<string, string | Buffer> = {
  "root/notes/a.md": text,
  "root/notes/.hidden.md":
    "# 显式隐藏文件\n\n![不随普通根覆盖扩权](../assets/a.png)\n",
  "other/notes/b.md": "# 目录图片 B\n\n![另一根同名蓝图](../assets/a.png)\n",
  "root/assets/a.png": png([235, 120, 40]),
  "other/assets/a.png": png([40, 130, 235]),
  "outside.png": png([210, 30, 60]),
};
for (const [relative, data] of Object.entries(files)) {
  const path = join(directory, relative);
  await writeFile(path, data, { flag: "wx", mode: 0o600 });
  console.info(`${createHash("sha256").update(data).digest("hex")}  ${path}`);
}
await symlink("../../outside.png", join(directory, "root/assets/escape.png"));
console.info(`验收目录：${directory}`);
console.info(
  "路径一：单独打开 root/notes/a.md → 阅读橙图失败 → 加入 root → 橙图及引用式成功，外部两图继续失败。"
);
console.info(
  "路径二：清空后加入 root/notes → 打开 a.md → 加入 root 吸收子根 → 橙图成功；加入 other 后 b.md 为蓝图。"
);
console.info(
  "隐藏例外：先单独打开 root/notes/.hidden.md，再加入 root，图片仍不得扩权。不执行断网。"
);
