import { expect, test } from "bun:test";

import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseReadingMarkdown } from "../client/canonical-parser";
import type { ReadingHeadingProjection } from "../client/reading-heading-structure";
import { createReadingSearchRegistry } from "../client/reading-search-registry";

import { commonmarkContent } from "./commonmark-content";

function project(source: string) {
  const tree = parseReadingMarkdown(source);
  const before = JSON.stringify(tree);
  const projection: ReadingHeadingProjection = { blocks: [], sections: [] };
  const registry = createReadingSearchRegistry();
  const nodes = commonmarkContent(
    tree,
    source,
    undefined,
    undefined,
    registry,
    undefined,
    projection
  );
  const html = renderToStaticMarkup(nodes);
  if (!Array.isArray(nodes)) throw Error("Expected root block array");
  for (const node of nodes as readonly unknown[]) {
    if (!isValidElement<{ ref: (element: HTMLElement) => unknown }>(node))
      continue;
    // Exercise the exact renderer registration callback; no DOM/layout claim.
    node.props.ref({ parentElement: null } as HTMLElement);
  }
  expect(registry.blocks().map(([, value]) => value.id)).toEqual(
    projection.blocks.map((block) => block.id)
  );
  const offsets = [
    ...html.matchAll(/data-reading-from="(\d+)" data-reading-to="(\d+)"/g),
  ].map((match) => [Number(match[1]), Number(match[2])]);
  expect(offsets).toEqual(
    projection.blocks.map((block) => [block.from, block.to])
  );
  expect(JSON.stringify(tree)).toBe(before);
  expect(renderToStaticMarkup(commonmarkContent(tree, source))).toBe(html);
  registry.dispose();
  return { tree, projection, html };
}

test("canonical BOM CRLF sections match actual root wrappers and search ids without hidden definitions", () => {
  const source =
    "\uFEFF" +
    [
      "# A",
      "intro",
      "[unused]: /x",
      "### Child",
      "body",
      "## Empty",
      "## Peer",
      "> # quoted\r\n> text",
      "```md\r\n# fake\r\n```",
      "<div>\r\n# html\r\n</div>",
      "Next\r\n====",
      "end",
      "# Tail",
    ].join("\r\n\r\n");
  const { projection } = project(source);
  expect(projection.blocks.map((block) => block.id)).toEqual([
    0, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
  ]);
  expect(projection.blocks[0].from).toBe(1);
  expect(
    projection.sections.map((section) => [
      section.headingId,
      section.depth,
      section.parentHeadingId,
      section.bodyStart,
      section.end,
    ])
  ).toEqual([
    [0, 1, null, 1, 9],
    [3, 3, 0, 3, 4],
    [6, 2, 0, 6, 9],
    [10, 1, null, 10, 11],
  ]);
  for (const section of projection.sections) {
    expect(section.from).toBe(projection.blocks[section.headingBlock].from);
    expect(section.to).toBe(projection.blocks[section.end - 1].to);
    expect(section.bodyStart).toBe(section.headingBlock + 1);
  }
  expect(
    source.slice(projection.sections[1].from, projection.sections[1].to)
  ).toBe("### Child\r\n\r\nbody");
});

test("a child heading itself is hideable content, while trailing headings and definitions alone are not", () => {
  expect(
    project("# Parent\n\n## Empty child").projection.sections.map((section) => [
      section.headingId,
      section.bodyStart,
      section.end,
    ])
  ).toEqual([[0, 1, 2]]);
  expect(project("# Empty\n\n[ref]: /target").projection.sections).toEqual([]);
  expect(
    project("> # nested\n> text\n\n```\n# fenced\n```\n\n<div>\n# html\n</div>")
      .projection.sections
  ).toEqual([]);
});

test("safe fallback clears a previously populated projection and leaves the full source visible", () => {
  const source = "# Good\n\ntext";
  const { tree, projection } = project(source);
  expect(projection.sections).toHaveLength(1);
  delete tree.children[1].position;
  const content = commonmarkContent(
    tree,
    source,
    undefined,
    undefined,
    undefined,
    undefined,
    projection
  );
  expect(renderToStaticMarkup(content)).toContain("阅读结构无法安全呈现");
  expect(renderToStaticMarkup(content)).toContain(source);
  expect(projection).toEqual({ blocks: [], sections: [] });
});

test("invalid optional block coordinates clear the receipt without changing ordinary rendering", () => {
  const source = "# Heading\n\nbody";
  for (const start of [NaN, 1.5, 0]) {
    const { tree, projection } = project(source);
    expect(projection.sections).toHaveLength(1);
    tree.children[1].position!.start.offset = start;
    const ordinary = renderToStaticMarkup(commonmarkContent(tree, source));
    const projected = renderToStaticMarkup(
      commonmarkContent(
        tree,
        source,
        undefined,
        undefined,
        undefined,
        undefined,
        projection
      )
    );
    expect(projected).toBe(ordinary);
    expect(projection).toEqual({ blocks: [], sections: [] });
  }
});

test("representative long canonical document keeps section ranges ordered and nested, not crossing", () => {
  const source = Array.from(
    { length: 1000 },
    (_, index) =>
      `# Chapter ${index}\n\nbody\n\n### Child ${index}\n\nchild body\n\n[ref${index}]: /x`
  ).join("\n\n");
  const { projection } = project(source);
  expect(projection.blocks).toHaveLength(4000);
  expect(projection.sections).toHaveLength(2000);
  for (let index = 0; index < 1000; index++) {
    const parent = projection.sections[index * 2],
      child = projection.sections[index * 2 + 1];
    expect([parent.headingBlock, parent.bodyStart, parent.end]).toEqual([
      index * 4,
      index * 4 + 1,
      index * 4 + 4,
    ]);
    expect(child.parentHeadingId).toBe(parent.headingId);
    expect(child.end).toBe(parent.end);
  }
});
