import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import {
  CALLOUT_PRESENTATION,
  CALLOUT_TYPES,
} from "../client/callout-extension";
import { parseCanonicalMarkdown } from "../client/canonical-parser";

import {
  commonmarkContent,
  isControlledReadingElement,
} from "./commonmark-content";

const html = (raw: string) =>
  renderToStaticMarkup(commonmarkContent(parseCanonicalMarkdown(raw), raw));
test("reading callouts use fixed titles and exact body without rewriting canonical nodes", () => {
  for (const type of CALLOUT_TYPES) {
    const raw = `> [!${type}]\r\n> **body** &amp; tail\n\nafter`;
    const tree = parseCanonicalMarkdown(raw),
      before = JSON.stringify(tree);
    const output = renderToStaticMarkup(commonmarkContent(tree, raw));
    const view = CALLOUT_PRESENTATION[type];
    expect(output).toContain(
      `<blockquote class="${view.className}"><p class="reading-callout-title"><span class="reading-callout-icon">${view.icon}</span> ${view.title}</p><p class="my-3 leading-7"><strong>body</strong> &amp; tail</p></blockquote>`
    );
    expect(output).toContain(">after</p>");
    expect(output).not.toContain(`[!${type}]`);
    expect(JSON.stringify(tree)).toBe(before);
  }
});

test("callout projection preserves later blocks, missing-position autolinks and ordinary nested markers", () => {
  const output = html(
    "> [!NOTE]\n> visit www&#46;example.com\n>\n> > [!TIP]\n> > inner\n>\n> | a | b |\n> | - | - |\n> | x | y |"
  );
  expect(output).toContain(
    'visit <span class="underline decoration-dotted" title="链接打开尚未接入">www.example.com</span>'
  );
  expect(output).toContain("[!TIP]\ninner");
  expect(output.match(/reading-callout-title/g)).toHaveLength(1);
  expect(output).toContain("<table");
  expect(output).not.toMatch(/<a\b|href=/);
  const next = html("> [!TIP]\n>\n> body");
  expect(next).not.toContain('<p class="my-3 leading-7"></p>');
  expect(next).toContain(">body</p>");
});

test("unknown or invalid metadata keeps ordinary quote marker and no active HTML capability", () => {
  expect(html("> [!OTHER]\n> body")).toContain("[!OTHER]\nbody");
  const raw = "> [!NOTE]\n> body",
    tree = parseCanonicalMarkdown(raw);
  tree.children[0].data = {
    agenticCallout: {
      type: "NOTE",
      markerFrom: 2,
      markerTo: 9,
      textPrefix: 1000,
    },
  };
  const output = renderToStaticMarkup(commonmarkContent(tree, raw));
  expect(output).toContain("[!NOTE]\nbody");
  expect(output).not.toContain("reading-callout-title");
  const unsafe = html("> [!NOTE]\n> <script>alert(1)</script>");
  expect(unsafe).not.toContain("<script>");
  expect(unsafe).not.toContain("href=");
});

test("callout DOM audit accepts only fixed static classes and rejects attributes", () => {
  const element = (
    tag: string,
    className: string,
    extra: { name: string; value: string }[] = []
  ) => ({
    namespaceURI: "http://www.w3.org/1999/xhtml",
    localName: tag,
    attributes: [{ name: "class", value: className }, ...extra],
  });
  for (const view of Object.values(CALLOUT_PRESENTATION)) {
    expect(
      isControlledReadingElement(element("blockquote", view.className))
    ).toBe(true);
    expect(
      isControlledReadingElement(
        element("blockquote", view.className, [{ name: "onclick", value: "x" }])
      )
    ).toBe(false);
    expect(
      isControlledReadingElement(
        element("blockquote", view.className, [
          { name: "style", value: "color:red" },
        ])
      )
    ).toBe(false);
  }
  expect(
    isControlledReadingElement(element("p", "reading-callout-title"))
  ).toBe(true);
  expect(
    isControlledReadingElement(element("span", "reading-callout-icon"))
  ).toBe(true);
  expect(
    isControlledReadingElement(
      element("blockquote", "reading-callout reading-callout-custom")
    )
  ).toBe(false);
  expect(
    isControlledReadingElement(
      element("p", "reading-callout-title", [
        { name: "aria-live", value: "assertive" },
      ])
    )
  ).toBe(false);
});

test("paper and ink define every callout color independently of App appearance", async () => {
  for (const theme of ["paper", "ink"]) {
    const css = await Bun.file(
      new URL(`../reading-themes/${theme}/theme.css`, import.meta.url)
    ).text();
    for (const type of CALLOUT_TYPES)
      expect(css).toContain(`--reading-callout-${type.toLowerCase()}:`);
  }
});
