import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReadonlyMarkdownText } from "./readonly-markdown-text";

test.each([
  "<script>window.__executed = true</script>",
  '<img src="https://attacker.test/secret" onerror="alert(1)">',
  '<iframe src="file:///etc/passwd"></iframe>',
  '<a download href="data:text/plain,secret">download</a>',
  '<a target="_blank" href="javascript:alert(1)">open</a>',
  '<form action="https://attacker.test"><input name="secret"></form>',
  "[run](javascript:alert(1)) ![secret](file:///etc/passwd)",
  "```sh\nrm -rf /fictional-path\n```",
])("untrusted Markdown remains literal text: %s", (text) => {
  const html = renderToStaticMarkup(<ReadonlyMarkdownText text={text} />);
  expect(html).toStartWith('<pre aria-label="Markdown 原文（只读）"');
  expect(html).not.toMatch(/<(script|img|iframe|a|form|input)\b/);
  const body = html.slice(html.indexOf(">") + 1, html.lastIndexOf("</pre>"));
  const decoded = body
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  expect(decoded).toBe(text);
});
