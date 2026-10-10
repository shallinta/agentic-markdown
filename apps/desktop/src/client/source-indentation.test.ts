import { expect, test } from "bun:test";

import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import { syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";

import { parseCanonicalMarkdown } from "./canonical-parser";
import { switchEditorMode } from "./editor-mode";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";
import {
  INDENT_BOUNDARY_CHANGE,
  planSourceIndentation,
} from "./source-indentation";

function source(raw: string, ranges?: number[][]) {
  let state = createRawEditorState(raw).update({
    effects: switchEditorMode("source"),
  }).state;
  const choices = ranges ?? [[state.doc.line(2).from]];
  state = state.update({
    selection: EditorSelection.create(
      choices.map((r) => EditorSelection.range(r[0], r[1] ?? r[0])),
      choices.length - 1
    ),
  }).state;
  return state;
}
function apply(state: EditorState, more: boolean) {
  const plan = planSourceIndentation(state, more);
  expect(plan.reason).toBeUndefined();
  return state.update({
    changes: plan.changes,
    annotations: isolateHistory.of("full"),
  });
}
test("fence baselines preserve semantic indentation and exact history", () => {
  for (let baseline = 0; baseline <= 3; baseline++)
    for (const prefix of ["", " ", "   ", "\t", " \t", "\t\t"])
      for (const marker of ["```ts", "~~~~js"]) {
        const raw =
          " ".repeat(baseline) +
          marker +
          "\r\n" +
          prefix +
          "word\n" +
          marker.slice(0, marker.startsWith("`") ? 3 : 4);
        const state = source(raw),
          tx = apply(state, true);
        const oldCode = parseCanonicalMarkdown(raw).children[0],
          code = parseCanonicalMarkdown(tx.state.field(rawText)).children[0];
        expect(oldCode.type).toBe("code");
        expect(code.type).toBe("code");
        if (oldCode.type !== "code" || code.type !== "code")
          throw Error("not code");
        const columns = (s: string) => {
          let col = 0;
          for (const c of /^[ \t]*/.exec(s)![0])
            col += c === "\t" ? 4 - (col % 4) : 1;
          return col;
        };
        expect(columns(code.value) - columns(oldCode.value)).toBe(2);
        expect(code.value.trimStart()).toBe(oldCode.value.trimStart());
        let current = tx.state;
        const target = {
          get state() {
            return current;
          },
          dispatch: (t: typeof tx) => {
            current = t.state;
          },
        };
        expect(undo(target)).toBe(true);
        expect(current.field(rawText)).toBe(raw);
        expect(current.selection.eq(state.selection)).toBe(true);
        expect(redo(target)).toBe(true);
        expect(current.field(rawText)).toBe(tx.state.field(rawText));
      }
});
test("empty content, zero-indent no-op and plain paragraphs do not invent history", () => {
  expect(apply(source("```\n\n```"), true).state.field(rawText)).toBe(
    "```\n  \n```"
  );
  const state = source("   ```\n   word\n   ```");
  const plan = planSourceIndentation(state, false);
  expect(plan).toEqual({ changes: [] });
  expect(undoDepth(state)).toBe(0);
  expect(planSourceIndentation(source("hello", [[3]]), true)).toEqual({
    changes: [],
  });
  expect(planSourceIndentation(source("", [[0]]), false)).toEqual({
    changes: [],
  });
});

test("structure tabs stay four columns while code indentation follows editor tabSize", () => {
  for (const tabSize of [2, 8]) {
    const state = createRawEditorState(
      "   ```\n\t\tword\n   ```",
      EditorState.tabSize.of(tabSize)
    ).update({
      effects: switchEditorMode("source"),
      selection: { anchor: 7 },
    }).state;
    const tx = apply(state, false);
    // The first tab crosses the three-column structure baseline; the second
    // remains actual code indentation, measured using the public editor facet.
    expect(tx.state.field(rawText)).toBe(
      "   ```\n" + " ".repeat(3 + Math.max(0, tabSize - 2)) + "word\n   ```"
    );
  }
});

test("a background/partial tree does not force a synchronous full parse", () => {
  const raw = "```\n" + "word\n".repeat(110000) + "```";
  const state = source(raw, [[raw.length - 5]]);
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
  expect(planSourceIndentation(state, true).reason).toBeDefined();
  expect(undoDepth(state)).toBe(0);
});
test("whole operation rejects structural/mixed/readonly/protected selections", () => {
  for (const [raw, ranges] of [
    ["```\nx\n```", [[0, 6]]],
    ["```\nx\n```\nplain", [[4], [10]]],
    ["> ```\n> x\n> ```", [[8]]],
    ["- hi", [[3]]],
    ["```\nx", [[4]]],
    ["```\n" + "x".repeat(10001) + "\n```", [[4]]],
  ] as [string, number[][]][]) {
    const state = source(raw, ranges);
    expect(planSourceIndentation(state, true).reason).toBeDefined();
    expect(undoDepth(state)).toBe(0);
  }
  const state = source("```\nx\n```").update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(planSourceIndentation(state, true).reason).toBeDefined();
});
test("actual opener length/type: shortening indent cannot create an early closer", () => {
  for (const opener of ["```", "````", "`````", "~~~", "~~~~~"]) {
    const raw = opener + " info\n    " + opener + "\t \nword\n" + opener;
    expect(planSourceIndentation(source(raw), false).reason).toBe(
      INDENT_BOUNDARY_CHANGE
    );
    const shorter = opener.slice(1);
    expect(
      planSourceIndentation(
        source(opener + "\n    " + shorter + "\n" + opener),
        false
      ).reason
    ).toBeUndefined();
    expect(
      planSourceIndentation(
        source(opener + "\n    " + opener + "text\n" + opener),
        false
      ).reason
    ).toBeUndefined();
    expect(
      planSourceIndentation(
        source(opener + "\n    " + opener + opener[0] + "\n" + opener),
        false
      ).reason
    ).toBe(INDENT_BOUNDARY_CHANGE);
  }
});
test("multiple fences dedupe logical lines, preserve direction/main and exclude next line start", () => {
  const raw = "\ufeff```\r\none\r\ntwo\n```\n\n~~~~\nthree\n~~~~";
  let state = source(raw);
  const a = state.doc.line(2),
    b = state.doc.line(4),
    c = state.doc.line(7);
  state = state.update({
    selection: EditorSelection.create(
      [EditorSelection.range(b.from, a.from), EditorSelection.cursor(c.from)],
      1
    ),
  }).state;
  const tx = apply(state, true);
  expect(tx.state.field(rawText)).toBe(
    "\ufeff```\r\n  one\r\n  two\n```\n\n~~~~\n  three\n~~~~"
  );
  expect(tx.state.selection.eq(state.selection.map(tx.changes))).toBe(true);
  expect(tx.state.selection.mainIndex).toBe(1);
  state = source("```\nabc\n```", [[4], [6]]);
  const plan = planSourceIndentation(state, true);
  expect(plan.changes?.length).toBe(1);
});
