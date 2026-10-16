import { expect, test } from "bun:test";

import {
  CANONICAL_PROFILE,
  MARKDOWN_GRAMMAR,
} from "../shared/markdown-profile";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { markdownGrammar } from "./markdown-grammar";

type Tree = ReturnType<typeof parseCanonicalMarkdown>;
type Node = Tree | Tree["children"][number];
function nodes(tree: Tree) {
  const result: Node[] = [];
  const visit = (node: Node) => {
    result.push(node);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(tree);
  return result;
}

test("official autolink path punctuation determines strike interaction", () => {
  for (const [suffix, deletes, target] of [
    ["。", 0, "https://a.b~~。"],
    [".", 1, "https://a.b"],
    ["", 1, "https://a.b"],
  ] as const) {
    const raw = `~~https://a.b~~${suffix}`;
    const all = nodes(parseCanonicalMarkdown(raw));
    expect(all.filter((node) => node.type === "delete")).toHaveLength(deletes);
    const links = all.filter((node) => node.type === "link");
    expect(links.map((node) => node.url)).toEqual([target]);
    expect(
      links.map((node) =>
        raw.slice(node.position!.start.offset, node.position!.end.offset)
      )
    ).toEqual([target]);
    expect(
      all
        .filter((node) => node.type === "text")
        .map((node) => node.value)
        .join("")
    ).toBe(suffix === "。" ? raw : `https://a.b${suffix}`);
  }
});

test("canonical autolinks keep official transform semantics without inventing positions", () => {
  const cases: [string, string[], number][] = [
    ["www&#46;example.com，中", ["http://www.example.com，中"], 1],
    [
      "www&#46;example.com contact&#64;example.com",
      ["http://www.example.com", "mailto:contact@example.com"],
      2,
    ],
    [
      "www\\.example.com https\\://example.com contact\\@example.com",
      [
        "http://www.example.com",
        "https://example.com",
        "mailto:contact@example.com",
      ],
      3,
    ],
    [
      "abcwww.example.com [https://example.com] /www.example.com",
      ["https://example.com", "http://www.example.com"],
      2,
    ],
    [
      "<span>www.example.com</span>\n\n<div>https://example.com</div>",
      ["http://www.example.com"],
      1,
    ],
    ["&#104;ttps://example.com", ["https://example.com"], 1],
    [
      "\\www.example.com \\https://example.com",
      ["http://www.example.com", "https://example.com"],
      1,
    ],
  ];
  for (const [raw, targets, missing] of cases) {
    const tree = parseCanonicalMarkdown(raw);
    const all = nodes(tree);
    const links = all.filter((node) => node.type === "link");
    expect(links.map((node) => node.url)).toEqual(targets);
    expect(links.filter((node) => !node.position)).toHaveLength(missing);
    expect(all.some((node) => node.type === "text" && !node.position)).toBe(
      true
    );
    for (const node of all) {
      if (!node.position) continue;
      const from = node.position.start.offset!,
        to = node.position.end.offset!;
      expect(from).toBeGreaterThanOrEqual(0);
      expect(to).toBeGreaterThanOrEqual(from);
      expect(to).toBeLessThanOrEqual(raw.length);
    }
    expect(tree.children.every((node) => !!node.position)).toBe(true);
  }
});

test("canonical recognizes literal autolinks while editor grammar excludes them", () => {
  expect(MARKDOWN_GRAMMAR).toBe(
    "commonmark-gfm-strike-task-table-frontmatter-highlight-5"
  );
  expect(CANONICAL_PROFILE).toBe(
    "commonmark-gfm-strike-task-autolink-table-callout-5"
  );
  const raw =
    "WWW.EXAMPLE.COM HTTPS://EXAMPLE.COM mailto:a@example.com xmpp:a@example.com/resource";
  const editorNodes: string[] = [];
  markdownGrammar.parse(raw).iterate({
    enter(node) {
      editorNodes.push(node.name);
    },
  });
  expect(editorNodes).not.toContain("Autolink");
  expect(editorNodes).not.toContain("URL");
  expect(
    nodes(parseCanonicalMarkdown(raw))
      .filter((n) => n.type === "link")
      .map((n) => n.url)
  ).toEqual([
    "http://WWW.EXAMPLE.COM",
    "HTTPS://EXAMPLE.COM",
    "mailto:a@example.com",
    "mailto:a@example.com",
  ]);
  const nested = nodes(
    parseCanonicalMarkdown(
      "[www.example.com](https://target.example) ![www.example.com](image.png) `a@example.com`"
    )
  );
  expect(nested.filter((n) => n.type === "link").map((n) => n.url)).toEqual([
    "https://target.example",
  ]);
  expect(nested.filter((n) => n.type === "image").map((n) => n.alt)).toEqual([
    "www.example.com",
  ]);
});

test("canonical autolink missing inline ranges do not remove BOM/EOL block ranges", () => {
  const raw = "\uFEFFwww&#46;example.com\r\n\r\ncontact\\@example.com";
  const tree = parseCanonicalMarkdown(raw);
  expect(
    tree.children.map((n) => [n.position?.start.offset, n.position?.end.offset])
  ).toEqual([
    [1, 20],
    [24, 44],
  ]);
  expect(
    tree.children.map((n) =>
      raw.slice(n.position!.start.offset, n.position!.end.offset)
    )
  ).toEqual(["www&#46;example.com", "contact\\@example.com"]);
  const cr = parseCanonicalMarkdown(
    "www&#46;example.com\rcontact\\@example.com"
  );
  expect(cr.children).toHaveLength(1);
  expect(cr.children[0].position?.end.offset).toBe(40);
  expect(
    nodes(cr)
      .filter((n) => n.type === "text")
      .map((n) => n.value)
      .join("")
  ).toBe("www.example.com\rcontact@example.com");
});
