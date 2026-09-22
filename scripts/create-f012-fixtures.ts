import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Disposable editing samples. The manifest lets users check that editing in
// the application never wrote the in-memory buffer back to disk.
const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f012-"));
const samples = [
  {
    name: "01-mixed.markdown",
    text: "\uFEFF# 混合换行\r\n第二行 LF\n第三行孤立 CR\r末行无换行",
  },
  {
    name: "02-long.md",
    text: Array.from(
      { length: 160 },
      (_, index) => `第 ${index + 1} 行：用于验证滚动位置与选区保持。🙂`
    ).join("\n"),
  },
  { name: "03-crlf.md", text: "# CRLF\r\n在这行末尾按 Enter\r\n末行\r\n" },
  { name: "04-empty.md", text: "" },
  { name: "05-bom-only.md", text: "\uFEFF" },
];
const manifest: string[] = [];
for (const { name, text } of samples) {
  await writeFile(join(directory, name), text, { flag: "wx" });
  manifest.push(`${createHash("sha256").update(text).digest("hex")}  ${name}`);
}
await writeFile(join(directory, "SHA256SUMS"), manifest.join("\n") + "\n", {
  flag: "wx",
});
console.info(`F-012a 临时验收样本：${directory}`);
console.info(
  "仅用于内存编辑；尚不支持保存，不要使用真实工作文档测试放弃操作。"
);
console.info("01：BOM；LF 1 / CRLF 1 / 孤立 CR 1；无末尾换行。");
console.info("02：160 行，验证切换标签后的滚动、选区及未保存内容。");
console.info("03：CRLF 3；04：空文件；05：仅 BOM。");
console.info(`验证磁盘未变：cd '${directory}' && shasum -a 256 -c SHA256SUMS`);
