import { expect, test } from "bun:test";

import { undo, redo, insertNewlineAndIndent } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";

import { switchEditorMode } from "./editor-mode";
import { listContinuationTransaction } from "./list-continuation";
import { createRawEditorState, rawText } from "./raw-buffer";

function run(raw: string, ranges: number[][], soft = false) {
  let state = createRawEditorState(raw).update({
    effects: switchEditorMode("source"),
  }).state;
  state = state.update({
    selection: EditorSelection.create(
      ranges.map((r) => EditorSelection.range(r[0], r[1] ?? r[0])),
      ranges.length - 1
    ),
  }).state;
  const tx = listContinuationTransaction(state, soft);
  state = tx.state;
  const out = state.field(rawText),
    selected = state.selection;
  const target = {
    get state() {
      return state;
    },
    dispatch(tr: typeof tx) {
      state = tr.state;
    },
  };
  expect(undo(target)).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(redo(target)).toBe(true);
  expect(state.field(rawText)).toBe(out);
  return { out, selected, state, tx };
}
test("basic markers, midline, empty and nested list continuation", () => {
  for (const marker of ["-", "+", "*", "1.", "1)"]) {
    expect(run(marker + " abc", [[marker.length + 4]]).out).toBe(
      marker +
        " abc\n" +
        (marker.startsWith("1") ? "2" + marker[1] : marker) +
        " "
    );
  }
  expect(run("- abcd", [[4]]).out).toBe("- ab\n- cd");
  expect(run("- ", [[2]]).out).toBe("");
  expect(run("- a\n- ", [[6]]).out).toBe("- a\n");
  expect(run("- top\n  - ", [[10]]).out).toBe("- top\n- ");
  expect(run("- top\n  + child", [[15]]).out).toBe("- top\n  + child\n  + ");
});
test("continuous numbering and mixed ranges share one transaction", () => {
  expect(run("1. a\n2. b\n3. c", [[4]]).out).toBe("1. a\n2. \n3. b\n4. c");
  expect(run("1. a\n7. b\n12. c", [[4]]).out).toBe("1. a\n2. \n7. b\n12. c");
  expect(run("1. a\n2. b\n3. c", [[4], [9]]).out).toBe(
    "1. a\n2. \n3. b\n4. \n5. c"
  );
  expect(run("- a\n\nplain", [[3], [10]]).out).toBe("- a\n- \n\nplain\n");
  expect(run("1. a\n2. \n3. c", [[8]]).out).toBe("1. a\n\n2. c");
});
test("soft continuation remains in same item after further text", () => {
  const result = run("- top\n  - child", [[15]], true);
  expect(result.out).toBe("- top\n  - child\n    ");
  const state = result.state.update({
    changes: { from: result.selected.main.head, insert: "next" },
  }).state;
  const items: string[] = [];
  syntaxTree(state).iterate({
    enter: (n) => {
      if (n.name === "ListItem") items.push(state.sliceDoc(n.from, n.to));
    },
  });
  expect(items).toHaveLength(2);
  expect(items[1]).toBe("- child\n    next");
  expect(run("\ufeff- 中文😀\r\nplain\n尾", [[7]], true).out).toBe(
    "\ufeff- 中文😀\r\n  \r\nplain\n尾"
  );
});
test("renumber width preserves child and continuation indentation", () => {
  const raw = "8. a\n9. b\n   continuation\n   - child";
  expect(run(raw, [[4]]).out).toBe(
    "8. a\n9. \n10. b\n    continuation\n    - child"
  );
  expect(run("9. a\n   - child", [[4]]).out).toBe("9. a\n10. \n    - child");
  expect(run("08. a\n09. b", [[5]]).out).toBe("08. a\n09. \n10. b");
});
test("tab marker gap uses its actual content column and preserves tree membership", () => {
  const result = run("-\ttext", [[6]], true);
  expect(result.out).toBe("-\ttext\n    ");
  const next = result.state.update({
    changes: { from: result.selected.main.head, insert: "more" },
  }).state;
  const nodes: string[] = [];
  syntaxTree(next).iterate({
    enter: (n) => {
      if (n.name === "ListItem") nodes.push(next.sliceDoc(n.from, n.to));
    },
  });
  expect(nodes).toEqual(["-\ttext\n    more"]);
  const width = run("8. a\n9.\tb\n    - child", [[4]]);
  expect(width.out).toBe("8. a\n9. \n10.\tb\n    - child");
  const items: string[] = [];
  syntaxTree(width.state).iterate({
    enter: (n) => {
      if (n.name === "ListItem") items.push(width.state.sliceDoc(n.from, n.to));
    },
  });
  expect(items).toHaveLength(4);
  expect(items[2]).toBe("10.\tb\n    - child");
});
test("multiple selection coordinates and one target transaction are exact", () => {
  const result = run("1. a\n2. b\n3. c", [[4], [9]]);
  expect(result.selected.mainIndex).toBe(1);
  expect(result.selected.ranges.map((r) => [r.anchor, r.head])).toEqual([
    [8, 8],
    [17, 17],
  ]);
  let calls = 0;
  let state = createRawEditorState(
    "- a\n- b",
    EditorState.transactionFilter.of((tx) => {
      calls++;
      return tx;
    })
  );
  state = state.update({ effects: switchEditorMode("source") }).state;
  state = state.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(3),
      EditorSelection.cursor(7),
    ]),
  }).state;
  calls = 0;
  listContinuationTransaction(state, false);
  expect(calls).toBe(1);
});
test("mixed ordinary whitespace and brackets agree with public default newline", () => {
  for (const [plain, pos] of [
    ["text   tail", 4],
    ["   ", 2],
    ["{}", 1],
    ["```\n  {}\n```", 7],
  ] as const) {
    const raw = "- a\n\n" + plain,
      point = 5 + pos;
    let state = createRawEditorState(raw).update({
      effects: switchEditorMode("source"),
    }).state;
    state = state.update({ selection: EditorSelection.single(point) }).state;
    insertNewlineAndIndent({
      state,
      dispatch: (tx) => {
        state = tx.state;
      },
    });
    const result = run(raw, [[3], [point]]);
    expect(result.out).toBe(state.field(rawText).replace("- a\n", "- a\n- \n"));
    expect(result.selected.main.head).toBe(state.selection.main.head + 3);
  }
});

test("overlapping ordinary whitespace does not corrupt an independent list", () => {
  const result = run("- a\n\n    ", [[3], [6], [8]]);
  let state=createRawEditorState("- a\n\n    ").update({effects:switchEditorMode("source")}).state;
  state=state.update({selection:EditorSelection.create([EditorSelection.cursor(6),EditorSelection.cursor(8)])}).state;
  insertNewlineAndIndent({state,dispatch:tx=>{state=tx.state}});
  expect(result.out).toBe(state.field(rawText).replace("- a\n","- a\n- \n"));
  expect(result.selected.ranges.map(r=>r.head)).toEqual([6,13,18]);
  expect(result.selected.mainIndex).toBe(2);
});
test("empty-item deltas merge with insertions without duplicate numeric writes", () => {
  expect(run("1. a\n2. \n3. c", [[4], [8]]).out).toBe("1. a\n2. \n\n3. c");
  expect(run("1. ab\n2. c", [[4], [5]]).out).toBe("1. a\n2. b\n3. \n4. c");
  expect(run("\ufeff- ", [[3]]).out).toBe("\ufeff");
});
test("nested code and task syntax do not invoke the outer list", () => {
  expect(run("- a\n  ```\n  code\n  ```", [[16]]).out).not.toContain("\n- ");
  expect(run("- [x] a", [[7]]).out).toBe("- [x] a\n");
  const large = "paragraph\n\n".repeat(50000) + "- tail";
  expect(run(large, [[large.length]]).out).toBe(large + "\n");
  const long = "- " + "a".repeat(20000);
  expect(run(long, [[long.length]]).out).toBe(long + "\n");
});
