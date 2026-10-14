import { expect, test } from "bun:test";

import { fromMarkdown } from "mdast-util-from-markdown";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import {
  annotateCallouts,
  CALLOUT_TYPES,
  readCallout,
} from "./callout-extension";
import { parseCanonicalMarkdown } from "./canonical-parser";

function quote(raw: string) {
  const node = parseCanonicalMarkdown(raw).children[0];
  if (node.type !== "blockquote") throw Error("Expected quote");
  return node;
}

test("callout annotation preserves all source AST values and positions except its data", () => {
  for (const type of CALLOUT_TYPES)
    for (const eol of ["\n", "\r", "\r\n"]) {
      const raw = `> [!${type}]${eol}> body`;
      const tree = fromMarkdown(raw),
        original = structuredClone(tree);
      annotateCallouts(tree, raw);
      const node = tree.children[0];
      if (node.type !== "blockquote") throw Error("Expected quote");
      const data = readCallout(node, raw)!;
      expect(data.type).toBe(type);
      expect(raw.slice(data.markerFrom, data.markerTo)).toBe(`[!${type}]`);
      expect(data.textPrefix).toBe(type.length + 3 + eol.length);
      delete node.data;
      expect(tree).toEqual(original);
    }
});

test("callout BOM, mixed EOL and official transform without child positions keep exact marker", () => {
  for (const prefix of ["", "\uFEFF"])
    for (const eol of ["\n", "\r", "\r\n"]) {
      const raw = `${prefix}> [!NOTE]${eol}> visit www&#46;example.com\r> tail\n> final`;
      const node = quote(raw),
        data = readCallout(node, raw)!;
      expect(data.markerFrom).toBe(prefix.length + 2);
      expect(data.textPrefix).toBe(7 + eol.length);
      const paragraph = node.children[0];
      if (paragraph.type !== "paragraph") throw Error("Expected paragraph");
      expect(paragraph.children[0].position).toBeUndefined();
      expect(paragraph.position?.start.offset).toBe(prefix.length + 2);
    }
});

test("only exact top-level first-line markers with body qualify", () => {
  const rejected = [
    "> [!note]\n> body",
    "> [!OTHER]\n> body",
    "> [!NOTE]",
    "> [!NOTE]\n>",
    "> [!NOTE] \n> body",
    "> [!NOTE]\t\n> body",
    "> [!NOTE] custom\n> body",
    "> [!NOTE]+\n> body",
    "> [!NOTE]-\n> body",
    ">\n> [!NOTE]\n> body",
    "> [a]: /url\n> [!NOTE]\n> body",
    "> [!NOTE]\n> body\n\n[!note]: /url",
    "> \\[!NOTE]\n> body",
    "> [\\!NOTE]\n> body",
    "> &#91;!NOTE]\n> body",
    "> &lbrack;!NOTE]\n> body",
    "> `[!NOTE]`\n> body",
    "> [!NOTE](/url)\n> body",
    "> ![!NOTE](/url)\n> body",
    "> [!NOTE]\n>\n> [a]: /url",
    "> [!NOTE]\n>\n> >",
    "> &#91;!NOTE]\n> visit www&#46;example.com",
  ];
  for (const raw of rejected)
    expect(readCallout(quote(raw), raw)).toBeUndefined();
  for (const raw of ["- > [!NOTE]\n  > body", "> > [!NOTE]\n> > body"]) {
    expect(JSON.stringify(parseCanonicalMarkdown(raw))).not.toContain(
      "agenticCallout"
    );
  }
  for (const raw of [
    "> [!NOTE]\nbody",
    "> [!NOTE]\n>\n> body",
    "> [!NOTE]\n>\n> ```\n> ```",
    "> [!NOTE]\n>\n> <div></div>",
  ]) {
    expect(readCallout(quote(raw), raw)?.type).toBe("NOTE");
  }
});

test("metadata reader rejects changed fixed fields or contradictory existing child positions", () => {
  const raw = "> [!NOTE]\n> body";
  for (const field of ["type", "markerFrom", "markerTo", "textPrefix"]) {
    const node = quote(raw);
    node.data = {
      ...node.data,
      agenticCallout: { ...readCallout(node, raw), [field]: "invalid" },
    };
    expect(readCallout(node, raw)).toBeUndefined();
  }
  const node = quote(raw);
  const paragraph = node.children[0];
  if (paragraph.type !== "paragraph") throw Error("Expected paragraph");
  paragraph.children[0].position!.start.offset!++;
  expect(readCallout(node, raw)).toBeUndefined();
});

test("legal near-limit text and many candidate whitespace prefixes do not get new character limits", () => {
  const plain = "x".repeat(MAX_DOCUMENT_BYTES);
  expect(parseCanonicalMarkdown(plain).children).toHaveLength(1);
  const raw = "> [!NOTE]\n> " + "x".repeat(MAX_DOCUMENT_BYTES - 20);
  expect(readCallout(quote(raw), raw)?.type).toBe("NOTE");
  const whitespace =
    "> [!NOTE]\n> " + " ".repeat(MAX_DOCUMENT_BYTES - 30) + "body";
  expect(readCallout(quote(whitespace), whitespace)?.type).toBe("NOTE");
  const tree = fromMarkdown("> [!NOTE]\n> body");
  const node = tree.children[0];
  if (
    node.type !== "blockquote" ||
    node.children[0].type !== "paragraph" ||
    node.children[0].children[0].type !== "text"
  )
    throw Error("Expected text");
  node.children[0].children[0].value =
    "[!NOTE]\n" + " ".repeat(MAX_DOCUMENT_BYTES - 20) + "x";
  annotateCallouts(tree, "> [!NOTE]\n> body");
  expect(readCallout(node, "> [!NOTE]\n> body")?.type).toBe("NOTE");
  const many = Array.from({ length: 1000 }, () => "> [!TIP]\n> body").join(
    "\n\n"
  );
  expect(
    parseCanonicalMarkdown(many).children.every(
      (node) => node.type === "blockquote" && readCallout(node, many)
    )
  ).toBe(true);
});

test("budget refusal publishes no earlier planned annotation", () => {
  const raw = "> [!NOTE]\n> body",
    tree = fromMarkdown(raw);
  const plain = fromMarkdown("x").children[0];
  tree.children.push(...Array.from({ length: 100000 }, () => plain));
  expect(() => annotateCallouts(tree, raw)).toThrow("Callout budget");
  expect(tree.children[0].data).toBeUndefined();
});

test("character budgets aggregate candidates and reject atomically beyond document allowance", () => {
  const raw = "> [!NOTE]\n> first\n\n> [!TIP]\n> second";
  const tree = fromMarkdown(raw);
  const second = tree.children[1];
  if (
    second.type !== "blockquote" ||
    second.children[0].type !== "paragraph" ||
    second.children[0].children[0].type !== "text"
  )
    throw Error("Expected text");
  // Controlled malformed tree seam: legal parser output cannot exceed source bytes.
  second.children[0].children[0].value =
    "[!TIP]\n" + " ".repeat(MAX_DOCUMENT_BYTES) + "x";
  expect(() => annotateCallouts(tree, raw)).toThrow("Callout budget");
  expect(tree.children.every((node) => node.data === undefined)).toBe(true);
});
