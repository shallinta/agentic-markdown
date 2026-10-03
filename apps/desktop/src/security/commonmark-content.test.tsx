import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { parseCanonicalMarkdown } from "../client/canonical-parser";
import { editorOffset, rawOffset } from "../client/raw-buffer";

import {
  commonmarkContent,
  isControlledReadingElement,
} from "./commonmark-content";

test("controlled CommonMark renders structure but no active content/URL attributes", () => {
  const source =
    '# 标题\r\n\r\n> **粗体** 和 *斜体* `code`\r\n\r\n- 一\n- 二\n\n---\n\n[链接](javascript:alert) ![图片](https://example.invalid/a.png)\n\n<script>globalThis.bad=true</script>\n<iframe src="data:text/html,bad"></iframe>\n\n[定义]: https://example.invalid\n\n```js\nalert(1)\n```';
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(source), source)
  );
  for (const tag of [
    "h1",
    "blockquote",
    "strong",
    "em",
    "code",
    "ul",
    "li",
    "hr",
    "pre",
  ])
    expect(html).toContain(`<${tag}`);
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("图片尚未加载");
  expect(html).not.toMatch(/<(script|img|iframe|svg|math|form|a)(\s|>)/);
  for (const tag of html.match(/<[^>]*>/g) ?? [])
    expect(tag).not.toMatch(/\s(href|src|download|target|style|on\w+)=/);
  expect(html).not.toContain("[定义]");
});

test("unknown nodes preserve original range and excessive recursion keeps full source", () => {
  const source = "未知原文";
  const tree = parseCanonicalMarkdown(source);
  Object.assign(tree.children[0], { type: "future" });
  expect(renderToStaticMarkup(commonmarkContent(tree, source))).toContain(
    source
  );
  const nested = parseCanonicalMarkdown("> ".repeat(150) + "deep");
  const full = "> ".repeat(150) + "deep";
  const html = renderToStaticMarkup(commonmarkContent(nested, full));
  expect(html).toContain("完整原文");
  expect(html).toContain("&gt; ".repeat(150) + "deep");
});

test("BOM CRLF lone CR emoji positions round-trip from editor to original text", () => {
  const raw = "\uFEFF# 中文😀\r\n\r\n段落\r行\n";
  const normalized = raw.replace(/\r\n?/g, "\n");
  for (let offset = 0; offset <= normalized.length; offset++)
    expect(editorOffset(raw, rawOffset(raw, offset))).toBe(offset);
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(raw), raw)
  );
  expect(html).toContain('data-reading-from="1"');
});

test("mounted element audit restricts class, attribute owner, namespace and active properties", () => {
  const node = (
    localName: string,
    name: string,
    value: string,
    namespaceURI = "http://www.w3.org/1999/xhtml"
  ) => ({ localName, namespaceURI, attributes: [{ name, value }] });
  expect(isControlledReadingElement(node("p", "class", "my-3 leading-7"))).toBe(
    true
  );
  expect(
    isControlledReadingElement(node("div", "data-reading-from", "123"))
  ).toBe(true);
  for (const value of [
    node("p", "class", "bg-[url(evil)]"),
    node("span", "role", "status"),
    node("div", "title", "链接打开尚未接入"),
    node("p", "class", "my-3 leading-7", "http://www.w3.org/2000/svg"),
    node("span", "href", "https://example.invalid"),
    node("div", "onclick", "bad()"),
    node("img", "src", "data:bad"),
    node("div", "data-reading-from", "-1"),
    node("ol", "start", "Infinity"),
  ])
    expect(isControlledReadingElement(value)).toBe(false);
});
