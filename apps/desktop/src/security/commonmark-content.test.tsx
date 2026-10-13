import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { parseCanonicalMarkdown } from "../client/canonical-parser";
import { editorOffset, rawOffset } from "../client/raw-buffer";

import {
  commonmarkContent,
  isControlledReadingElement,
} from "./commonmark-content";

test("reading preserves official strike and autolink punctuation interaction", () => {
  for (const suffix of ["。", ".", ""]) {
    const raw = `~~https://a.b~~${suffix}`;
    const html = renderToStaticMarkup(
      commonmarkContent(parseCanonicalMarkdown(raw), raw)
    );
    const target = suffix === "。" ? "https://a.b~~。" : "https://a.b";
    const span = `<span class="underline decoration-dotted" title="链接打开尚未接入">${target}</span>`;
    const content =
      suffix === "。" ? `~~${span}` : `<del>${span}</del>${suffix}`;
    expect(html).toBe(
      `<div data-reading-from="0" data-reading-to="${raw.length}"><p class="my-3 leading-7">${content}</p></div>`
    );
    expect(html).not.toMatch(/<a\b|\shref=/);
  }
});

test("reading literal autolinks preserve complete mixed text in inert spans", () => {
  const raw =
    "前 www&#46;example.com，中 **粗体** 后 contact\\@example.com。\n\n- [x] ~~done~~ www.example.com";
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(raw), raw)
  );
  const link = (value: string) =>
    `<span class="underline decoration-dotted" title="链接打开尚未接入">${value}</span>`;
  expect(html).toBe(
    `<div data-reading-from="0" data-reading-to="${raw.indexOf("\n\n")}"><p class="my-3 leading-7">前 ${link("www.example.com，中")} <strong>粗体</strong> 后 ${link("contact@example.com")}。</p></div>` +
      `<div data-reading-from="${raw.indexOf("- [x]")}" data-reading-to="${raw.length}"><ul class="my-3 list-disc pl-7"><li><span class="reading-task-status">☑ 已完成：</span><p class="my-3 leading-7"><del>done</del> ${link("www.example.com")}</p></li></ul></div>`
  );
  expect(html).not.toMatch(
    /<(?:a|input|button|script|iframe)\b|\s(?:href|src|on\w+|tabindex)=/i
  );
  expect(html).not.toContain("阅读结构无法安全呈现");
  expect(html.match(/☑ 已完成：/g)).toHaveLength(1);
});

test("autolinks do not grant HTML or code an active reading path", () => {
  const raw =
    '<span>www.example.com</span>\n\n<div onclick="bad()">https://example.com</div>\n\n`www.example.com`\n\n```\na@example.com\n```\n\njavascript:alert(1) file:///tmp/a data:text/html,x';
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(raw), raw)
  );
  expect(html.match(/title="链接打开尚未接入"/g)).toHaveLength(1);
  expect(html).toContain("&lt;span&gt;");
  expect(html).toContain("HTML 浏览器呈现环境不可用，保留原文");
  expect(html).toContain(
    "&lt;div onclick=&quot;bad()&quot;&gt;https://example.com&lt;/div&gt;"
  );
  expect(html).toContain(
    'class="bg-muted rounded px-1 font-mono">www.example.com</code>'
  );
  expect(html).toContain("```\na@example.com\n```");
  expect(html).not.toContain("阅读结构无法安全呈现");
  expect(html).not.toMatch(
    /<(?:a|input|button|script|iframe)\b|<[^>]*\s(?:href|src|on\w+|tabindex)=/i
  );
});

test("task reading status is inert and raw HTML does not gain input powers", () => {
  const raw =
    '- [x] **done**\n- [ ] <input type="checkbox" onclick="bad()"> [bad](javascript:bad)';
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(raw), raw)
  );
  expect(html).toContain("☑ 已完成：");
  expect(html).toContain("☐ 未完成：");
  expect(html).toContain("<strong>done</strong>");
  expect(html).not.toMatch(/<(?:input|button|script|a)(?:\s|>)/);
  expect(html).not.toMatch(/<[^>]*\s(?:href|onclick|tabindex)=/);
  expect(
    isControlledReadingElement({
      localName: "span",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      attributes: [{ name: "class", value: "reading-task-status" }],
    })
  ).toBe(true);
  expect(
    isControlledReadingElement({
      localName: "input",
      namespaceURI: "http://www.w3.org/1999/xhtml",
      attributes: [],
    })
  ).toBe(false);
});

test("fixed delete node renders controlled del without widening raw HTML or URL powers", () => {
  const raw =
    "~~中文 **bold** [link](javascript:alert)~~\n\n`~~code~~`\n\n~single~\n\n~~~long~~~";
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(raw), raw)
  );
  expect(html).toContain("<del>中文 <strong>bold</strong>");
  expect(html).toContain("<code");
  expect(html).toContain("~~code~~");
  expect(html).toContain("~single~");
  expect(html).toContain("~~~long~~~");
  expect(html).not.toMatch(/\s(?:href|src|on\w+)=/);
  const hostile =
    '~~<img src="https://example.invalid/x" onerror="bad()"> <script>bad()</script>~~';
  const inert = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(hostile), hostile)
  );
  expect(inert).toContain("<del>");
  expect(inert).not.toMatch(/<(?:img|script|iframe|a)(?:\s|>)/);
  expect(inert).toContain("&lt;img");
  const element = {
    localName: "del",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    attributes: [],
  };
  expect(isControlledReadingElement(element)).toBe(true);
  expect(
    isControlledReadingElement({
      ...element,
      attributes: [{ name: "onclick", value: "bad" }],
    })
  ).toBe(false);
});

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
