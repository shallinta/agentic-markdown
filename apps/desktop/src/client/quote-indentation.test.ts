import { expect, test } from "bun:test";

import { isolateHistory, redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { switchEditorMode } from "./editor-mode";
import { QUOTE_INDENT_BUDGET } from "./quote-indentation";
import { createRawEditorState, rawText } from "./raw-buffer";
import { planSourceIndentation } from "./source-indentation";

function state(raw: string, positions: number[], source = false) {
  let s = createRawEditorState(raw);
  if (source) s = s.update({ effects: switchEditorMode("source") }).state;
  return s.update({
    selection: EditorSelection.create(
      positions.map((p) => EditorSelection.cursor(p)),
      positions.length - 1
    ),
  }).state;
}
function apply(s: EditorState, more: boolean) {
  const plan = planSourceIndentation(s, more);
  expect(plan.reason).toBeUndefined();
  const tx = s.update({
    changes: plan.changes,
    annotations: isolateHistory.of("full"),
  });
  expect(tx.state.selection.eq(s.selection.map(tx.changes))).toBe(true);
  let current = tx.state;
  const target = {
    get state() {
      return current;
    },
    dispatch(t: typeof tx) {
      current = t.state;
    },
  };
  expect(undo(target)).toBe(true);
  expect(current.field(rawText)).toBe(s.field(rawText));
  expect(current.selection.eq(s.selection)).toBe(true);
  expect(redo(target)).toBe(true);
  expect(current.field(rawText)).toBe(tx.state.field(rawText));
  return tx.state;
}
function paragraphs(raw: string) {
  const out: { text: string; depth: number }[] = [];
  type Node =
    | ReturnType<typeof parseCanonicalMarkdown>
    | ReturnType<typeof parseCanonicalMarkdown>["children"][number];
  const visit = (node: Node, d: number) => {
    if (node.type === "blockquote") d++;
    if (node.type === "paragraph")
      out.push({
        text: node.children.map((c) => ("value" in c ? c.value : "")).join(""),
        depth: d,
      });
    if ("children" in node) for (const c of node.children) visit(c, d);
  };
  visit(parseCanonicalMarkdown(raw), 0);
  return out;
}
test("whole paragraph changes keep unrelated paragraphs and exact raw history in both modes", () => {
  for (const mode of [false, true])
    for (const more of [false, true]) {
      const raw = "> A\n> continuation\n>\n> B",
        next = apply(state(raw, [2], mode), more).field(rawText);
      expect(next).toBe(
        more ? "> > A\n> > continuation\n>\n> B" : "A\ncontinuation\n>\n> B"
      );
      expect(paragraphs(next)).toEqual([
        { text: "A\ncontinuation", depth: more ? 2 : 0 },
        { text: "B", depth: 1 },
      ]);
    }
});
test("nested outdent repairs paragraph separation without swallowing unselected A", () => {
  const next = apply(state("> A\n> > B\n> > C", [8]), false).field(rawText);
  expect(next).toBe("> A\n> \n> B\n> C");
  expect(paragraphs(next)).toEqual([
    { text: "A", depth: 1 },
    { text: "B\nC", depth: 1 },
  ]);
  const middle = apply(state("> A\n>\n> B\n>\n> C", [8]), false).field(rawText);
  expect(paragraphs(middle)).toEqual([
    { text: "A", depth: 1 },
    { text: "B", depth: 0 },
    { text: "C", depth: 1 },
  ]);
});
test("multiple ranges dedupe paragraph, preserve main and reverse endpoint", () => {
  const raw = "> A\n> continuation\n>\n> B";
  const s = state(raw, [2, 6], true),
    next = apply(s, true);
  expect(next.selection.mainIndex).toBe(1);
  expect(next.field(rawText)).toBe("> > A\n> > continuation\n>\n> B");
  const reverse = state(raw, [2]).update({
    selection: EditorSelection.single(20, 2),
  }).state;
  const out = apply(reverse, true);
  expect(out.selection.main.anchor).toBeGreaterThan(out.selection.main.head);
  expect(out.field(rawText)).toBe(next.field(rawText));
  expect(apply(state("> A\n>\n> B", [2, 8], true), true).field(rawText)).toBe(
    "> > A\n>\n> > B"
  );
});
test("compact prefix, BOM mixed EOL and adjacent code preserve original content", () => {
  for (const [raw, pos] of [
    [">A", 1],
    ["   > A\n   > continuation", 5],
    ["\ufeff> A\r\n> continuation\n>\r> B", 3],
    ["> A\n>\n> ```js\n>  x\n> ```", 2],
  ] as const) {
    const out = apply(state(raw, [pos]), true).field(rawText);
    expect(paragraphs(out)[0].depth).toBe(2);
  }
});
test("unsupported lazy, empty, code, list and mixed targets reject atomically", () => {
  for (const [raw, pos] of [
    [">\n> A", 0],
    ["> A\ncontinuation", 2],
    [">\tA", 2],
    ["> ```\n> x\n> ```", 8],
    ["> <div>\n> x\n> </div>", 10],
    ["- > A", 4],
  ] as const) {
    const s = state(raw, [pos]);
    expect(planSourceIndentation(s, true).reason).toBeDefined();
    expect(s.field(rawText)).toBe(raw);
  }
  const mixed = state("> A\n\nPLAIN", [2]).update({
    selection: EditorSelection.single(2, 10),
  }).state;
  expect(planSourceIndentation(mixed, true).reason).toBeDefined();
  expect(
    planSourceIndentation(state("> A\n>\n> B", [2, 4], true), true).reason
  ).toBeDefined();
});
test("aggregate input and candidate growth are bounded", () => {
  const raw = "> " + "a".repeat(9997);
  const s = state(raw, [2]);
  ensureSyntaxTree(s, s.doc.length, 1000);
  expect(planSourceIndentation(s, true).reason).toBe(QUOTE_INDENT_BUDGET);
  const over = state("> " + "a".repeat(10001), [2]);
  expect(planSourceIndentation(over, true).reason).toBeDefined();
});
test("necessary repair avoids existing blank, preserves BOM and unselected leaf blocks", () => {
  for (const raw of [
    "\ufeff> A\n> > B\n> > C",
    "> A\n>\n> > B\n> > C\n>\n> D",
  ]) {
    const position = raw.indexOf("B");
    const out = apply(state(raw, [position]), false).field(rawText);
    expect(out.startsWith("\ufeff")).toBe(raw.startsWith("\ufeff"));
    expect(paragraphs(out)).toEqual(
      paragraphs(raw).map((p) => ({
        ...p,
        depth: p.text === "B\nC" ? 1 : p.depth,
      }))
    );
    if (!raw.startsWith("\ufeff")) expect(out).toBe("> A\n>\n> B\n> C\n>\n> D");
  }
  for (const tail of [
    "> ```js\n>  x\n> ```",
    "> <div>\n> x\n> </div>",
    "> - item\n>   continuation",
    "> ## Title",
  ]) {
    const raw = "> A\n>\n" + tail;
    const output = apply(state(raw, [2]), true).field(rawText);
    expect(output.endsWith(tail)).toBe(true);
    const old = parseCanonicalMarkdown(raw),
      next = parseCanonicalMarkdown(output);
    // Exact unchanged raw plus canonical shape, excluding source positions.
    const clean = (node: unknown): unknown =>
      JSON.parse(
        JSON.stringify(node, (key, value: unknown) =>
          key === "position" ? undefined : value
        )
      );
    const ob = old.children[0],
      nb = next.children[0];
    expect(ob.type).toBe("blockquote");
    expect(nb.type).toBe("blockquote");
    if (ob.type === "blockquote" && nb.type === "blockquote")
      expect(clean(nb.children.slice(1))).toEqual(clean(ob.children.slice(1)));
  }
});

test("quote-looking code content remains owned by the existing fence consumer", () => {
  for (const content of [">", "> >", "> A"]) {
    const raw = "```\n" + content + "\n```";
    const output = apply(state(raw, [4]), true).field(rawText);
    expect(output).toBe("```\n  " + content + "\n```");
  }
});

test("paragraph-end caret resolves left content without losing quote ownership", () => {
  for (const raw of ["> A", "> **A**", "> A\n> continuation"]) {
    const output = apply(state(raw, [raw.length]), true).field(rawText);
    expect(paragraphs(output)[0].depth).toBe(2);
  }
});

test("independent windows collect every repair boundary before one atomic candidate", () => {
  const raw = "> A\n> > B\n\np1\n\np2\n\np3\n\n> C\n> > D";
  const s = state(raw, [8, 31], true);
  const output = apply(s, false);
  expect(output.field(rawText)).toBe(
    "> A\n> \n> B\n\np1\n\np2\n\np3\n\n> C\n> \n> D"
  );
  expect(output.selection.mainIndex).toBe(1);
  expect(paragraphs(output.field(rawText))).toEqual(
    paragraphs(raw).map((p) => ({
      ...p,
      depth: p.text === "B" || p.text === "D" ? 1 : p.depth,
    }))
  );
});
