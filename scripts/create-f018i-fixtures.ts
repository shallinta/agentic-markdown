import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openProbeText } from "../apps/desktop/src/shared/open-probe";

const samples = [
  ["01-small.md", "普通小文档，用于打开、编辑和保存对照。"],
  [
    "02-large-paragraph.md",
    "四万行普通短行组成一个大段落；重点在末尾追加文字，保存后重新读取，检查没有丢失或错误分段。",
  ],
  [
    "03-dense-multiline.md",
    "多行密集 Markdown，包含加粗、斜体、链接及实体。链接目标不属于本次样本。",
  ],
  ["04-closed-fence.md", "四万行代码的闭合围栏。"],
  [
    "05-unclosed-fence.md",
    "四万行代码的未闭合围栏；未闭合是刻意设计，并非文件损坏。",
  ],
  ["06-mixed-blocks.md", "标题、引用、列表、加粗与代码围栏混合文档。"],
] as const;
const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f018i-"));
const descriptions = [
  "F-018i 一次性人工验收样本",
  "六份文件均含 UTF-8 BOM 和混合 LF/CRLF，均小于 1 MiB。可自由编辑、保存；不包含用户文档。",
  "建议先打开小样本，再逐个打开大样本，在末尾输入、撤销/重做、保存和重新读取。留意输入响应、最终样式与正文保真；这不是性能数值门禁。",
  "",
];
for (const [index, [name, description]] of samples.entries()) {
  const text = openProbeText(index);
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length > 1024 * 1024) throw new Error("Fixture exceeds 1 MiB");
  const path = join(directory, name);
  await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  if (!(await readFile(path)).equals(bytes))
    throw new Error("Fixture verification failed");
  descriptions.push(`${name}：${bytes.length} 字节。${description}`);
  console.info(`${path}\t${bytes.length} bytes`);
}
await writeFile(join(directory, "README.txt"), descriptions.join("\n") + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.info(`一次性验收目录：${directory}`);
