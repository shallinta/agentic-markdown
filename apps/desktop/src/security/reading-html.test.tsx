import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { parseCanonicalMarkdown } from "../client/canonical-parser";

import { commonmarkContent } from "./commonmark-content";
import {
  MAX_HTML_BLOCK_SOURCE,
  MAX_HTML_DEPTH,
  MAX_HTML_DOCUMENT_SOURCE,
  MAX_HTML_DOCUMENT_BLOCKS,
  MAX_HTML_NODES,
  preflightReadingHtml,
  prepareReadingHtml,
} from "./reading-html";

test("pure gate accepts only paired lower-case zero-attribute finite vocabulary", () => {
  for (const source of [
    "<p>中文 &lt;img&gt; 😀</p>",
    "<ul><li>一</li><li><strong>二</strong></li></ul>",
    "<p>a<br>b</p><hr>",
    "<blockquote><pre><code>x</code></pre></blockquote>",
  ])
    expect(preflightReadingHtml(source)).toBeNull();
});
test("malicious and malformed inputs never enter the sanitizer", () => {
  let calls = 0;
  const sanitizer = () => {
    calls++;
    throw Error("must not parse");
  };
  for (const source of [
    '<img src="http://127.0.0.1/asset">',
    '<iframe src="http://127.0.0.1/asset"></iframe>',
    '<p onclick="bad()">x</p>',
    '<p style="background:url(x)">x</p>',
    "<script>bad()</script>",
    "<svg><a></a></svg>",
    "<math><mtext>x</mtext></math>",
    "<form><input></form>",
    '<a href="javascript:bad()">x</a>',
    "<!-- x -->",
    "<!DOCTYPE html>",
    "<P>x</P>",
    "<p >x</p>",
    "<p/>",
    "<br/>",
    "<p>x",
    "</p>",
    "<p><em>x</p></em>",
    "<p>x<",
    "<p\0>x</p>",
    "x".repeat(MAX_HTML_BLOCK_SOURCE + 1),
    "<span>".repeat(MAX_HTML_DEPTH + 1) + "</span>".repeat(MAX_HTML_DEPTH + 1),
    "<br>".repeat(MAX_HTML_NODES + 1),
  ]) {
    expect(prepareReadingHtml(source, sanitizer).mode).toBe("source");
  }
  expect(calls).toBe(0);
  expect(prepareReadingHtml("<p>x</p>", sanitizer).mode).toBe("source");
  expect(calls).toBe(1);
});
test("Canonical flow qualification keeps inline and multiline quote raw rather than stitching HTML", () => {
  const source =
    "before <strong>inline</strong> after\n\n> <p>一\n> 二</p>\n\n```unknown\n<em>围栏原文</em>\n```";
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(source), source)
  );
  expect(html).toContain('title="行内 HTML 保留原文"');
  expect(html).toContain("HTML 块范围需要规范化，本片保留原文");
  expect(html).toContain("&gt; 二&lt;/p&gt;");
  expect(html).toContain("```unknown");
  expect(source).toContain("> 二</p>");
});
test("document HTML source budget falls back locally while preserving following Markdown", () => {
  const block = `<p>${"x".repeat(16000)}</p>\n\n`;
  const source =
    block.repeat(Math.ceil(MAX_HTML_DOCUMENT_SOURCE / block.length) + 1) +
    "# 后续标题";
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(source), source)
  );
  expect(html).toContain("HTML 正文累计超过安全源长限制，保留原文");
  expect(html).toContain("后续标题</h1>");
});

test("document HTML block-count budget preserves the 257th complete source", () => {
  const source = Array.from(
    { length: MAX_HTML_DOCUMENT_BLOCKS + 1 },
    (_, i) => `<p>块 ${i}</p>`
  ).join("\n\n");
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(source), source)
  );
  expect(html.match(/HTML 正文累计超过安全块数限制/g)?.length).toBe(1);
  expect(html).toContain("&lt;p&gt;块 256&lt;/p&gt;");
});
