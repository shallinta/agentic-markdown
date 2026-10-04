// Temporary acceptance corpus only. Does not modify existing user documents.
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const directory = await mkdtemp(join(tmpdir(), "agentic-html-acceptance-"));
const source = `# F-023a HTML 阅读样本

前面的普通 Markdown，**粗体** 和 *斜体*。

## 安全独立块

<p>安全段落：<strong>粗体</strong>、<em>斜体</em>、<code>代码</code>。</p>

<ul><li>第一项</li><li>第二项</li></ul>

<blockquote><p>安全引用</p></blockquote>

<pre><code>安全代码 &lt;tag&gt;</code></pre>

## 保守降级块

<script>globalThis.__htmlExecuted = true</script>

<img src="http://127.0.0.1:9/never-load.png">

<iframe src="http://127.0.0.1:9/never-load"></iframe>

<p onclick="bad()">事件属性保留原文</p>

<p><p>结构规范化应整块保留</p></p>

行内 <strong>仍为原文</strong>，不拼接标签。

> <p>跨行引用
> 不删除原文前缀</p>

\`\`\`unknown
<strong>未知围栏仍为原文</strong>
\`\`\`

## 结束

本轮不保存或改写此文档。
`;
await writeFile(join(directory, "F-023a-sample.md"), source);
console.info(
  JSON.stringify({
    directory,
    path: join(directory, "F-023a-sample.md"),
    bytes: Buffer.byteLength(source),
  })
);
