import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentic-markdown-f013c-"));
const text =
  '# CommonMark 源码颜色\n\n---\n\n\\* 转义 &amp; &#123; 实体\n\n> 引用正文\n\n- 无序列表\n1. 有序列表\n\n**粗体原文** *斜体原文* `inline code`\n\n[链接](https://invalid.example "标题")\n\n[id]: local.md "定义标题"\n\n<!-- 注释只作为源码 -->\n\n<div onclick="alert(1)">原始 HTML 不执行</div>\n\n```typescript\nconst 中文 = "代码正文无语言细分高亮";\n```\n';
await writeFile(join(directory, "01-source-colors.md"), text, {
  flag: "wx",
  mode: 0o600,
});
await writeFile(
  join(directory, "02-mixed.markdown"),
  "\uFEFF---\r\n\n\\* &amp;\r\n```js\n中文🙂\n```",
  { flag: "wx", mode: 0o600 }
);
console.info(`F-013c 一次性验收目录：${directory}`);
