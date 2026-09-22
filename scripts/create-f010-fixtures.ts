import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Creates disposable samples without touching user documents. */
const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f010-"));
const samples = [
  {
    name: "01-lf.md",
    text: "# LF\n中文 🙂\n",
    expected: "无 BOM；LF 2；末尾 LF",
  },
  {
    name: "02-bom-mixed.markdown",
    text: "\uFEFF# Mixed\r\n中文 🙂\n末行",
    expected: "有 BOM；LF 1 / CRLF 1；混合、并列；末尾无换行",
  },
  {
    name: "03-crlf.md",
    text: "# CRLF\r\n正文\r\n",
    expected: "无 BOM；CRLF 2；末尾 CRLF",
  },
  {
    name: "04-isolated-cr.md",
    text: "正文\r",
    expected: "孤立 CR 1；无 LF/CRLF；末尾孤立 CR",
  },
  { name: "05-empty.md", text: "", expected: "空文件；无 BOM、无换行" },
  { name: "06-bom-only.md", text: "\uFEFF", expected: "仅 BOM；无换行" },
];
for (const sample of samples) {
  await writeFile(join(directory, sample.name), sample.text, { flag: "wx" });
}
await writeFile(join(directory, "07-invalid-utf8.md"), new Uint8Array([0xff]), {
  flag: "wx",
});
console.info(`验收样本目录：${directory}`);
for (const sample of samples)
  console.info(`${sample.name}：${sample.expected}`);
console.info("07-invalid-utf8.md：拒绝读取，保留已有正文，提示外部转换。");
