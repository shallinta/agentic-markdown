import { expect, test } from "bun:test";

import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { TreeFragment, type Tree } from "@lezer/common";

import { openProbeText } from "../shared/open-probe";

import { BomAwareParser } from "./bom-aware-parser";
import { createRawEditorState, rawText } from "./raw-buffer";

function nodes(tree: Tree) {
  const result: [string, number, number][] = [];
  const cursor = tree.cursor();
  do {
    result.push([cursor.name, cursor.from, cursor.to]);
  } while (cursor.next());
  return result;
}

test("BOM projection preserves the open fragment tail on a 64-line paragraph", () => {
  const parser = new BomAwareParser();
  for (const raw of ["\uFEFF" + "x\n".repeat(64), openProbeText(1)]) {
    const original = parser.parse(raw);
    const next = raw + "!";
    const fragments = TreeFragment.applyChanges(
      TreeFragment.addTree(original),
      [
        {
          fromA: raw.length,
          toA: raw.length,
          fromB: raw.length,
          toB: next.length,
        },
      ]
    );
    expect(fragments[0]?.openEnd).toBe(true);
    expect(nodes(parser.parse(next, fragments))).toEqual(
      nodes(parser.parse(next))
    );
    let state = createRawEditorState(raw);
    state = state.update({
      changes: { from: state.doc.length, insert: "!" },
    }).state;
    expect(state.field(rawText)).toBe(next);
    expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
    expect(nodes(syntaxTree(state))).toEqual(
      nodes(parser.parse(state.doc.toString()))
    );
  }
});

test("BOM fragment projection preserves insert, delete and BOM transition semantics", () => {
  const parser = new BomAwareParser();
  let text = "\uFEFF" + "**bold**\n\nordinary\n".repeat(80);
  let tree = parser.parse(text);
  for (const [from, to, insert] of [
    [10, 12, "new"],
    [100, 103, ""],
    [0, 1, ""],
    [0, 0, "\uFEFF"],
    [20, 20, "\n\n"],
  ] as const) {
    const next = text.slice(0, from) + insert + text.slice(to);
    const fragments = TreeFragment.applyChanges(TreeFragment.addTree(tree), [
      { fromA: from, toA: to, fromB: from, toB: from + insert.length },
    ]);
    tree = parser.parse(next, fragments);
    expect(nodes(tree)).toEqual(nodes(parser.parse(next)));
    text = next;
  }
});

test("BOM projection retains partial/open fragments after multiple offset-changing edits", () => {
  const parser = new BomAwareParser();
  const original = "\uFEFF" + "line\n\n".repeat(100);
  let fragments = TreeFragment.addTree(parser.parse(original), [], true);
  let text = original;
  for (const [from, to, insert] of [
    [12, 12, "extra\n\n"],
    [200, 208, "q"],
    [0, 4, "\uFEFFnew"],
    [1, 1, "!\n"],
  ] as const) {
    const next = text.slice(0, from) + insert + text.slice(to);
    fragments = TreeFragment.applyChanges(fragments, [
      { fromA: from, toA: to, fromB: from, toB: from + insert.length },
    ]);
    expect(nodes(parser.parse(next, fragments))).toEqual(
      nodes(parser.parse(next))
    );
    text = next;
  }
});
