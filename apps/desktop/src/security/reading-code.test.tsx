import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "../client/canonical-parser";
import { retainReadingCode } from "../client/reading-code-ownership";
import { ReadingCode } from "../components/reading-code";

import {
  commonmarkContent,
  isControlledReadingElement,
  auditReadingContent,
} from "./commonmark-content";

test("mounted audit seam rejects forged copy structure and retains exact ownership", () => {
  function element(
    localName: string,
    className = "",
    extra: Record<string, string> = {}
  ) {
    const values = { ...(className ? { class: className } : {}), ...extra };
    return {
      localName,
      className,
      namespaceURI: "http://www.w3.org/1999/xhtml",
      attributes: Object.entries(values).map(([name, value]) => ({
        name,
        value,
      })),
      parentElement: null as unknown,
      children: [] as unknown[],
      childElementCount: 0,
      firstElementChild: null as unknown,
    };
  }
  const owner = element("div", "reading-code"),
    language = element("span", "reading-code-language"),
    button = element("button", "reading-code-copy", {
      type: "button",
      "aria-label": "复制代码正文",
    }),
    pre = element("pre", "reading-code-body"),
    code = element("code"),
    status = element("p", "reading-code-status", {
      role: "status",
      "aria-live": "polite",
    });
  owner.children = [language, button, pre, status];
  for (const child of [language, button, pre, status])
    child.parentElement = owner;
  pre.childElementCount = 1;
  pre.firstElementChild = code;
  code.parentElement = pre;
  const root = {
    querySelectorAll: () => [owner, language, button, pre, code, status],
  } as unknown as Element;
  expect(auditReadingContent(root).safe).toBe(false);
  const release = retainReadingCode(owner as unknown as Element);
  expect(auditReadingContent(root)).toEqual({ safe: true, elements: 6 });
  button.attributes.push({ name: "formaction", value: "https://example.com" });
  expect(auditReadingContent(root).safe).toBe(false);
  button.attributes.pop();
  owner.children = [language, pre, button, status];
  expect(auditReadingContent(root).safe).toBe(false);
  release();
});

for (const [raw, value] of [
  ["```js meta\nx  \n```", "x  "],
  ["~~~unknown\na\n\n~~~", "a\n"],
  ["```\n```", ""],
  ["```\nx", "x"],
  ["    x\n    y", "x\ny"],
  ["> ```\n> x\n> ```", "x"],
  ["- ```\n  x\n  ```", "x"],
  ["\ufeff```\r\nx\r\n```", "x"],
  ["```\rx\ry\r```", "x\ry"],
])
  test(`reading semantic code ${JSON.stringify(raw)}`, () => {
    const tree = parseCanonicalMarkdown(raw);
    const before = JSON.stringify(tree);
    const output = renderToStaticMarkup(commonmarkContent(tree, raw));
    const expected = renderToStaticMarkup(<ReadingCode value={value} />);
    const code = /<pre[^>]*>.*?<\/pre>/s.exec(expected)![0];
    expect(output).toContain(code);
    expect(output).not.toContain("代码块原文");
    expect(output).not.toContain("阅读结构无法安全呈现");
    expect(JSON.stringify(tree)).toBe(before);
  });

test("code escapes HTML and language text; only exact own button attributes pass", () => {
  const raw = '```"><img\n<script>bad()</script>\n```';
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(raw), raw)
  );
  expect(html).toContain("&lt;script&gt;bad()&lt;/script&gt;");
  expect(html).not.toMatch(/<(?:script|img)\b/);
  const node = {
    localName: "button",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    attributes: [
      { name: "class", value: "reading-code-copy" },
      { name: "type", value: "button" },
      { name: "aria-label", value: "复制代码正文" },
    ],
  };
  expect(isControlledReadingElement(node)).toBe(true);
  expect(
    isControlledReadingElement({
      ...node,
      attributes: [...node.attributes, { name: "onclick", value: "bad()" }],
    })
  ).toBe(false);
  expect(isControlledReadingElement({ ...node, attributes: [] })).toBe(false);
  expect(
    isControlledReadingElement({
      ...node,
      namespaceURI: "http://www.w3.org/2000/svg",
    })
  ).toBe(false);
});
