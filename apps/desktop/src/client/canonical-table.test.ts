import { expect, test } from "bun:test";

import { parseCanonicalMarkdown } from "./canonical-parser";

type Tree = ReturnType<typeof parseCanonicalMarkdown>;
type Node = Tree | Tree["children"][number];
function nodes(root: Node): Node[] {
  return [root, ...("children" in root ? root.children.flatMap(nodes) : [])];
}
function text(node: Node): string {
  return "value" in node
    ? node.value
    : "children" in node
      ? node.children.map(text).join("")
      : "";
}

test("official tables retain raw cells while alignment and short/extra rows are explicit", () => {
  const raw =
    "a | b | c | d\n:--- | :---: | ---: | ---\nx\ny | z | q | r | extra";
  const tree = parseCanonicalMarkdown(raw);
  const table = tree.children[0];
  expect(table.type).toBe("table");
  if (table.type !== "table") throw Error("expected table");
  expect(table.align).toEqual(["left", "center", "right", null]);
  expect(table.children.map((row) => row.children.map(text))).toEqual([
    ["a", "b", "c", "d"],
    ["x"],
    ["y", "z", "q", "r", "extra"],
  ]);
  expect(
    raw.slice(
      table.children[0].children[0].position!.start.offset,
      table.children[0].children[0].position!.end.offset
    )
  ).toBe("a ");
  for (const node of nodes(tree)) {
    expect(node.position).toBeDefined();
    expect(node.position!.start.offset!).toBeGreaterThanOrEqual(0);
    expect(node.position!.end.offset!).toBeLessThanOrEqual(raw.length);
  }
});

test("table delimiters, escaped pipes, empty cells and container boundaries use official grammar", () => {
  for (const [raw, count] of [
    ["| a | b |\n| - | - |\n| c | d |", 1],
    ["a | b\n- | -\nc | d", 0],
    ["a | b\n--- | --- | ---\nc | d", 0],
    ["> a | b\n> --- | ---\n> c | d", 1],
    ["- a | b\n  --- | ---\n  c | d", 1],
    ["- [x] done\n\n  a | b\n  --- | ---\n  c | d", 1],
  ] as const)
    expect(
      nodes(parseCanonicalMarkdown(raw)).filter((n) => n.type === "table")
    ).toHaveLength(count);
  const raw = "before\na | b\n--- | ---\nx\\|y | `a\\|b`\n| | |\n\nafter";
  const tree = parseCanonicalMarkdown(raw);
  expect(tree.children.map((n) => n.type)).toEqual([
    "paragraph",
    "table",
    "paragraph",
  ]);
  const table = tree.children[1];
  if (table.type !== "table") throw Error("expected table");
  expect(table.children.map((row) => row.children.map(text))).toEqual([
    ["a", "b"],
    ["x|y", "a|b"],
    ["", ""],
  ]);
  expect(
    raw.slice(table.position!.start.offset, table.position!.end.offset)
  ).toBe("a | b\n--- | ---\nx\\|y | `a\\|b`\n| | |");
});

test("tables preserve BOM/EOL offsets and missing autolink positions without fabricating ranges", () => {
  const raw = "\uFEFFa | b\r\n--- | ---\r~~done~~ | www&#46;example.com\n";
  const tree = parseCanonicalMarkdown(raw);
  const table = tree.children[0];
  expect(table.type).toBe("table");
  expect(table.position!.start.offset).toBe(1);
  expect(table.position!.end.offset).toBe(raw.length - 1);
  const all = nodes(tree);
  expect(all.filter((n) => n.type === "delete")).toHaveLength(1);
  const links = all.filter((n) => n.type === "link");
  expect(links.map((n) => n.url)).toEqual(["http://www.example.com"]);
  expect(links[0].position).toBeUndefined();
  expect(text(table)).toBe("abdonewww.example.com");
});
