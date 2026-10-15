import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "../client/canonical-parser";

import {
  commonmarkContent,
  isControlledReadingElement,
} from "./commonmark-content";
import { prepareReadingHtml } from "./reading-html";

const left = "border-border border px-3 py-2 text-left align-top";
const right = "border-border border px-3 py-2 text-right align-top";
const tableOpen =
  '<div class="my-4 max-w-full overflow-x-auto"><table class="w-full border-collapse text-sm">';
const th = (value: string, align = left) =>
  `<th scope="col" class="${align}">${value}</th>`;
const td = (value: string, align = left) =>
  `<td class="${align}">${value}</td>`;
const link = (value: string) =>
  `<span class="underline decoration-dotted" title="链接打开尚未接入">${value}</span>`;
const reading = (raw: string) =>
  renderToStaticMarkup(commonmarkContent(parseCanonicalMarkdown(raw), raw));

test("controlled tables render exact complete mixed content with fixed columns and inert links", () => {
  const raw =
    "前\n\na | b\n--- | ---:\n**粗** ~~删~~ | www&#46;example.com\nx\ny | z | hidden-extra\n\n后";
  const start = raw.indexOf("a |"),
    end = raw.indexOf("\n\n后");
  expect(reading(raw)).toBe(
    '<div data-reading-from="0" data-reading-to="1"><p class="my-3 leading-7">前</p></div>' +
      `<div data-reading-from="${start}" data-reading-to="${end}">${tableOpen}<thead><tr>${th("a")}${th("b", right)}</tr></thead><tbody>` +
      `<tr>${td("<strong>粗</strong> <del>删</del>")}${td(link("www.example.com"), right)}</tr>` +
      `<tr>${td("x")}${td("", right)}</tr><tr>${td("y")}${td("z", right)}</tr>` +
      "</tbody></table></div></div>" +
      `<div data-reading-from="${raw.length - 1}" data-reading-to="${raw.length}"><p class="my-3 leading-7">后</p></div>`
  );
});

test("actual table-cell HTML stays literal and does not widen raw HTML preflight", () => {
  const raw =
    "| a | b |\n| --- | --- |\n| <b>x</b> | <img src=x onerror=alert(1)> |";
  const table = parseCanonicalMarkdown(raw).children[0];
  if (table.type !== "table") throw Error("expected table");
  expect(table.children[1].children[0].children.map((n) => n.type)).toEqual([
    "html",
    "text",
    "html",
  ]);
  expect(table.children[1].children[1].children[0].type).toBe("html");
  const html = reading(raw);
  expect(html).toContain("&lt;b&gt;");
  expect(html).toContain("&lt;/b&gt;");
  expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(html).not.toMatch(
    /<(?:b|img|script|a|input)\b|\s(?:href|src|onerror)="/
  );
  expect(html).not.toContain("阅读结构无法安全呈现");
  let calls = 0;
  expect(
    prepareReadingHtml("<table><tr><td>x</td></tr></table>", () => {
      calls++;
      throw Error("must not parse");
    }).mode
  ).toBe("source");
  expect(calls).toBe(0);
  const script = "a | b\n--- | ---\n<script>alert(1)</script>";
  expect(parseCanonicalMarkdown(script).children.map((n) => n.type)).toEqual([
    "table",
    "html",
  ]);
});

test("generated empty cells and multiple tables share the pre-allocation work budget", () => {
  const make = (columns: number, rows: number) =>
    Array(columns).fill("h").join(" | ") +
    "\n" +
    Array(columns).fill("---").join(" | ") +
    "\n" +
    Array(rows).fill("x").join("\n");
  for (const raw of [
    make(400, 300),
    `${make(250, 240)}\n\n${make(250, 240)}`,
  ]) {
    const html = reading(raw);
    expect(html).toContain("阅读结构无法安全呈现，已保留完整原文。");
    expect(html).not.toContain("<table");
    expect(html).toContain(raw);
  }
  const raw = "a | b\n--- | ---\nx";
  const tree = parseCanonicalMarkdown(raw);
  const table = tree.children[0];
  if (table.type !== "table") throw Error("expected table");
  let nested: Extract<
    (typeof tree.children)[number],
    { type: "table" | "blockquote" }
  > = table;
  for (let i = 0; i < 125; i++)
    nested = { type: "blockquote", children: [nested] };
  tree.children = [nested];
  expect(renderToStaticMarkup(commonmarkContent(tree, raw))).toContain(
    "阅读结构无法安全呈现"
  );
  expect(reading(make(10, 10))).not.toContain("阅读结构无法安全呈现");
});

test("table audit accepts only fixed generated classes and exact header scope", () => {
  const audit = (localName: string, attrs: Record<string, string>) =>
    isControlledReadingElement({
      namespaceURI: "http://www.w3.org/1999/xhtml",
      localName,
      attributes: Object.entries(attrs).map(([name, value]) => ({
        name,
        value,
      })),
    });
  expect(audit("table", { class: "w-full border-collapse text-sm" })).toBe(
    true
  );
  for (const name of ["thead", "tbody", "tr"]) {
    expect(audit(name, {})).toBe(true);
    expect(audit(name, { onclick: "x" })).toBe(false);
  }
  expect(audit("th", { class: left, scope: "col" })).toBe(true);
  expect(audit("td", { class: right })).toBe(true);
  const rejected: Record<string, string>[] = [
    { class: left, scope: "row" },
    { class: left },
    { class: left, scope: "col", style: "color:red" },
    { class: left, scope: "col", align: "left" },
    { class: "unexpected", scope: "col" },
  ];
  for (const attrs of rejected) expect(audit("th", attrs)).toBe(false);
  expect(audit("td", { class: left, scope: "col" })).toBe(false);
});
