import { expect, test } from "bun:test";

import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";

import { parseCanonicalMarkdown } from "./canonical-parser";
import { switchEditorMode } from "./editor-mode";
import { LIST_INDENT_BUDGET } from "./list-indentation";
import { longLineProtection } from "./long-line-protection";
import { createRawEditorState, rawText } from "./raw-buffer";
import { planSourceIndentation } from "./source-indentation";

function source(raw: string, positions: number[], sourceMode = true) {
  let state = createRawEditorState(raw);
  if (sourceMode)
    state = state.update({ effects: switchEditorMode("source") }).state;
  return state.update({
    selection: EditorSelection.create(
      positions.map((p) => EditorSelection.cursor(p)),
      positions.length - 1
    ),
  }).state;
}
function lineage(raw: string) {
  const result: [string, string | null][] = [];
  function visit(
    node:
      | ReturnType<typeof parseCanonicalMarkdown>
      | ReturnType<typeof parseCanonicalMarkdown>["children"][number],
    parent: string | null
  ) {
    if (node.type === "listItem") {
      const first = node.children[0];
      const label =
        first.type === "paragraph" && first.children[0]?.type === "text"
          ? first.children[0].value
          : "";
      result.push([label, parent]);
      parent = label;
    }
    if ("children" in node)
      for (const child of node.children) visit(child, parent);
  }
  visit(parseCanonicalMarkdown(raw), null);
  return result;
}
function apply(state: EditorState, more: boolean) {
  const plan = planSourceIndentation(state, more);
  expect(plan.reason).toBeUndefined();
  const tx = state.update({
    changes: plan.changes,
    annotations: isolateHistory.of("full"),
  });
  let current = tx.state;
  const target = {
    get state() {
      return current;
    },
    dispatch(t: typeof tx) {
      current = t.state;
    },
  };
  if (tx.docChanged) {
    expect(undo(target)).toBe(true);
    expect(current.field(rawText)).toBe(state.field(rawText));
    expect(current.selection.eq(state.selection)).toBe(true);
    expect(redo(target)).toBe(true);
    expect(current.field(rawText)).toBe(tx.state.field(rawText));
    expect(current.selection.eq(tx.state.selection)).toBe(true);
  }
  return tx.state;
}
test("user B retains physical order, original descendants and adopts following sibling subtree", () => {
  const raw = "- A\n  - B\n    - b\n  - C\n    - c";
  for (const mode of [true, false]) {
    const after = apply(source(raw, [8], mode), false);
    expect(after.field(rawText)).toBe("- A\n- B\n  - b\n  - C\n    - c");
    expect(lineage(after.field(rawText))).toEqual([
      ["A", null],
      ["B", null],
      ["b", "B"],
      ["C", "B"],
      ["c", "C"],
    ]);
  }
});
test("indent whole subtree and contiguous selections with exact raw/history/main", () => {
  for (const [raw, positions, expected] of [
    ["- A\n- B\n  - b", [6, 12], "- A\n  - B\n    - b"],
    ["- A\n- B\n- C", [6, 10], "- A\n  - B\n  - C"],
    ["\ufeff- A\r\n- B\n  - b", [7], "\ufeff- A\r\n  - B\n    - b"],
    [
      "- A\n- B\n  ```js\n  x\n  ```",
      [6],
      "- A\n  - B\n    ```js\n    x\n    ```",
    ],
  ] as const) {
    const state = source(raw, [...positions]);
    const after = apply(state, true);
    expect(after.field(rawText)).toBe(expected);
    expect(after.selection.mainIndex).toBe(positions.length - 1);
  }
});
test("ordered non-one marker gets necessary blank, retains number and code content", () => {
  const raw = "9. A\r\n10. B\n    ```js\n    x\n    ```";
  const after = apply(source(raw, [8]), true).field(rawText);
  expect(after).toBe("9. A\r\n\n   10. B\n       ```js\n       x\n       ```");
  expect(lineage(after)).toEqual([
    ["A", null],
    ["B", "A"],
  ]);
  const list = parseCanonicalMarkdown(after).children[0];
  expect(list.type).toBe("list");
  if (list.type !== "list") throw Error("list");
  expect(list.children[0].spread).toBe(true);
  const nested = list.children[0].children[1];
  if (nested.type !== "list") throw Error("nested");
  expect(nested.start).toBe(10);
  expect(nested.children[0].children[1]).toMatchObject({
    type: "code",
    value: "x",
  });
});
test("reverse range excludes next line start; no-op has no history", () => {
  const state = source("- A\n- B\n- C", [6]).update({
    selection: { anchor: 8, head: 4 },
  }).state;
  const after = apply(state, true);
  expect(after.field(rawText)).toBe("- A\n  - B\n- C");
  expect(after.selection.main.anchor).toBe(10);
  expect(after.selection.main.head).toBe(6);
  for (const more of [true, false]) {
    const s = source("- A", [2]);
    expect(planSourceIndentation(s, more)).toEqual({ changes: [] });
    expect(undoDepth(s)).toBe(0);
  }
});
test("unsupported mixed, noncontiguous, tab and protected contexts reject atomically", () => {
  for (const [raw, positions] of [
    ["- A\n- B\n- C\n- D", [6, 14]],
    ["- A\n- B\n\t- b", [6]],
    ["- A\n- B\n\nplain", [6, 13]],
    ["> - A\n> - B", [10]],
    ["- A\n- B\n  ```\n  x\n  ```", [17]],
    ["- A\n- [ ] B", [6]],
    ["- A\n- B\n  - [x] b", [6]],
  ] as const) {
    const state = source(raw, [...positions]);
    expect(planSourceIndentation(state, true).reason).toBeDefined();
    expect(state.field(rawText)).toBe(raw);
  }
  const read = source("- A\n- B", [6]).update({ effects: [] }).state;
  const readonly = EditorState.create({
    doc: read.doc,
    extensions: EditorState.readOnly.of(true),
  });
  expect(planSourceIndentation(readonly, true).reason).toBeDefined();
});
test("canonical code content survives fence baseline and lazy paragraph indentation", () => {
  for (let baseline = 0; baseline < 4; baseline++) {
    const prefix = " ".repeat(2 + baseline);
    const raw = `- A\n- B\n${prefix}\`\`\`js\n  x\n${prefix}  y\n${prefix}\`\`\``;
    const after = apply(source(raw, [6]), true).field(rawText);
    function codeValues(
      node: ReturnType<typeof parseCanonicalMarkdown>
    ): string[] {
      const out: string[] = [];
      const pending: unknown[] = [node];
      while (pending.length) {
        const n = pending.pop() as {
          type: string;
          value?: string;
          children?: unknown[];
        };
        if (n.type === "code") out.push(n.value!);
        if (n.children) pending.push(...n.children);
      }
      return out;
    }
    expect(codeValues(parseCanonicalMarkdown(after))).toEqual(
      codeValues(parseCanonicalMarkdown(raw))
    );
  }
  expect(
    apply(source("- A\n- B\ncontinuation", [6]), true).field(rawText)
  ).toBe("- A\n  - B\n  continuation");
  const lazy = source("- A\n  - B\ncontinuation", [8]);
  expect(planSourceIndentation(lazy, false).reason).toBeDefined();
});
test("existing blank, multi-item outdent, neighbors and aggregate windows", () => {
  const raw = "- A\n  - B\n  - C\n  - D\n    - d";
  const result = apply(source(raw, [8, 14]), false).field(rawText);
  expect(lineage(result)).toEqual([
    ["A", null],
    ["B", null],
    ["C", null],
    ["D", "C"],
    ["d", "D"],
  ]);
  const blank = "9. A\n\n10. B";
  expect(apply(source(blank, [10]), true).field(rawText)).toBe(
    "9. A\n\n   10. B"
  );
  const neighbors = "heading\n\n- A\n- B\n\nending";
  expect(apply(source(neighbors, [15]), true).field(rawText)).toBe(
    "heading\n\n- A\n  - B\n\nending"
  );
  const left = "- A\n- B" + "x".repeat(5100),
    right = "- C\n- D" + "y".repeat(5100);
  // Isolated complete public tree for the aggregate guard; production asynchronous
  // long-span parsing is intentionally not forced or bypassed by the command.
  let state = EditorState.create({
    doc: left + "\n\nseparator\n\n" + right,
    extensions: [
      commonmarkLanguage,
      longLineProtection,
      EditorState.allowMultipleSelections.of(true),
    ],
    selection: EditorSelection.create([
      EditorSelection.cursor(6),
      EditorSelection.cursor(left.length + "\n\nseparator\n\n".length + 6),
    ]),
  });
  expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
  state = state.update({}).state;
  expect(planSourceIndentation(state, true).reason).toBe(LIST_INDENT_BUDGET);
});
test("aggregate local computation guard refuses without changing original state", () => {
  const raw = "- A\n- B\n  " + "x".repeat(10_001);
  const state = source(raw, [6]);
  expect(planSourceIndentation(state, true).reason).toBe(LIST_INDENT_BUDGET);
  expect(state.field(rawText)).toBe(raw);
});
test("wide marker gap cannot allocate an amplified indentation plan before rejection", () => {
  const raw = "- " + " ".repeat(3000) + "A\n- B\n  c\n  d\n  e";
  let state = source(raw, [raw.indexOf("B")]);
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({}).state;
  expect(raw.length).toBeLessThan(10_000);
  expect(planSourceIndentation(state, true)).toEqual({
    reason: LIST_INDENT_BUDGET,
  });
  expect(state.field(rawText)).toBe(raw);
  expect(undoDepth(state)).toBe(0);
});
