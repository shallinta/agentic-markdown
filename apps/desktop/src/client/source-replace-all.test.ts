import { expect, test } from "bun:test";

import { redo, undo, undoDepth } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import { switchEditorMode } from "./editor-mode";
import {
  createRawEditorState,
  editorText,
  rawText,
  writePermission,
} from "./raw-buffer";
import { planReplaceAll } from "./source-replace-all";
import {
  ALL_RANGE_LIMIT,
  ALL_INSERTED_BREAK_LIMIT,
  validReplaceAllRequest,
  validReplaceAllResult,
} from "./source-replace-all-protocol";
import { prepareReplaceAll } from "./source-replacement";

function request(
  raw: string,
  query: string,
  replacement: string,
  sensitive = true,
  wholeWord = false
) {
  return {
    id: 7,
    raw,
    replacement,
    options: { query, caseSensitive: sensitive, wholeWord },
  };
}

test("complete batch raw contributions, mapped selections and isolated history", () => {
  const cases: [string, string, string, boolean, string, number][] = [
    ["a A", "a", "a", false, "a a", 1],
    ["aa", "a", "a", true, "aa", 0],
    ["\ufeffa\r\na\nEND", "a", "$1\\X", true, "\ufeff$1\\X\r\n$1\\X\nEND", 2],
    ["aa a", "a", "aa", true, "aaaa aa", 3],
    ["a\r\na\nZ", "a", "x\ny", true, "x\r\ny\r\nx\ny\nZ", 2],
    ["a\rXX\nb", "X", "", true, "a\r\nb", 2],
    ["a A", "a", "x\ry\r\nz", false, "x\ny\nz x\ny\nz", 2],
    ["字😀 字😀", "字😀", "好", true, "好 好", 2],
    ["a\r\na\na\r\na\n", "a\na\n", "a\na\n", true, "a\r\na\r\na\r\na\r\n", 2],
    ["\r\n\n", "\n", "\n", true, "\r\n\r\n", 1],
    ["a", "z", "b", true, "a", 0],
    ["a", "", "b", true, "a", 0],
  ];
  for (const [raw, query, replacement, sensitive, expected, changed] of cases) {
    let state = createRawEditorState(raw).update({
      effects: switchEditorMode("source"),
    }).state;
    state = state.update({
      changes: { from: state.doc.length, insert: "!" },
    }).state;
    state = state.update({
      selection: EditorSelection.create(
        [
          EditorSelection.range(Math.min(1, state.doc.length), 0),
          EditorSelection.cursor(state.doc.length),
        ],
        1
      ),
    }).state;
    const before = state.field(rawText),
      selection = state.selection,
      depth = undoDepth(state);
    const result = planReplaceAll(
      request(before, query, replacement, sensitive)
    );
    expect(validReplaceAllResult(result, 7, state.doc.length)).toBe(true);
    if (!changed) {
      expect(result.kind).toBe("noop");
      expect(state.field(rawText)).toBe(expected + "!");
      expect(undoDepth(state)).toBe(depth);
      continue;
    }
    expect(result.kind).toBe("plan");
    if (result.kind !== "plan") throw Error("expected plan");
    expect(result.changed).toBe(changed);
    const tx = prepareReplaceAll(state, before, replacement, result);
    expect(tx).not.toBeNull();
    if (!tx) throw Error("expected transaction");
    state = tx.state;
    expect(state.field(rawText)).toBe(expected + "!");
    expect(state.doc.toString()).toBe(editorText(expected + "!"));
    expect(state.selection.eq(selection.map(tx.changes))).toBe(true);
    expect(state.selection.mainIndex).toBe(1);
    expect(undoDepth(state)).toBe(depth + 1);
    const target = {
      get state() {
        return state;
      },
      dispatch(t: Transaction) {
        state = t.state;
      },
    };
    expect(undo(target)).toBe(true);
    expect(state.field(rawText)).toBe(before);
    expect(state.selection.eq(selection)).toBe(true);
    expect(redo(target)).toBe(true);
    expect(state.field(rawText)).toBe(expected + "!");
    expect(undo(target)).toBe(true);
    expect(undo(target)).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
});

test("surrogate and raw CR seams have exact output bytes", () => {
  for (const [raw, query, replacement, expected] of [
    ["aa", "a", "\uDC00\uD800", "\uDC00\uD800\uDC00\uD800"],
    ["\uD800a", "a", "\uDC00", "\uD800\uDC00"],
    ["a\uDC00", "a", "\uD800", "\uD800\uDC00"],
    ["\rX\n", "X", "", "\r\n"],
  ]) {
    const result = planReplaceAll(request(raw, query, replacement));
    if (result.kind !== "plan") throw Error("expected plan");
    expect(result.bytes).toBe(new TextEncoder().encode(expected).length);
    const state = createRawEditorState(raw);
    const tx = prepareReplaceAll(state, raw, replacement, result);
    expect(tx?.state.field(rawText)).toBe(expected);
  }
});

test("literal Unicode and whole-word search preserve unrelated text", () => {
  for (const [raw, query, wholeWord, pairs] of [
    ["cat scatter cat_ CAT", "cat", true, [0, 3, 17, 20]],
    ["ａaa", "aa", false, [1, 3]],
  ] as const) {
    const result = planReplaceAll(request(raw, query, "X", false, wholeWord));
    if (result.kind !== "plan") throw Error("expected plan");
    expect(Array.from(result.pairs)).toEqual([...pairs]);
  }
});

test("range budget rejects atomically but dense proven noop is allowed", () => {
  const raw = "a\n".repeat(ALL_RANGE_LIMIT + 1);
  expect(planReplaceAll(request(raw, "a", "b"))).toEqual({
    id: 7,
    kind: "rejected",
    reason: "cost",
  });
  expect(planReplaceAll(request(raw, "a", "a"))).toEqual({
    id: 7,
    kind: "noop",
    matched: ALL_RANGE_LIMIT + 1,
    changed: 0,
  });
  expect(
    planReplaceAll(request("a ".repeat(5000), "a", "x".repeat(10000)))
  ).toEqual({ id: 7, kind: "rejected", reason: "size" });
  const exact = "z".repeat(MAX_DOCUMENT_BYTES - 1) + "a";
  const result = planReplaceAll(request(exact, "a", "b"));
  expect(result.kind).toBe("plan");
  if (result.kind === "plan") expect(result.bytes).toBe(MAX_DOCUMENT_BYTES);
  expect(planReplaceAll(request(exact, "a", "字"))).toEqual({
    id: 7,
    kind: "rejected",
    reason: "size",
  });
});

test("prepare rejects readonly or inconsistent result without mutating input", () => {
  const raw = "a a",
    plan = planReplaceAll(request(raw, "a", "b"));
  if (plan.kind !== "plan") throw Error("expected plan");
  const readonly = createRawEditorState(raw).update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(readonly.readOnly).toBe(true);
  expect(prepareReplaceAll(readonly, raw, "b", plan)).toBeNull();
  const state = createRawEditorState(raw);
  expect(
    prepareReplaceAll(state, raw, "b", { ...plan, bytes: plan.bytes + 1 })
  ).toBeNull();
  expect(
    prepareReplaceAll(state, raw, "b", { ...plan, changed: 1 })
  ).toBeNull();
  expect(state.field(rawText)).toBe(raw);
  expect(undoDepth(state)).toBe(0);
});

test("strict protocol rejects malformed counts, ranges and identities", () => {
  expect(validReplaceAllRequest(request("abc", "a", "x"))).toBe(true);
  for (const bad of [
    null,
    {},
    { ...request("a", "a", "b"), id: NaN },
    { ...request("a", "a", "b"), extra: true },
  ])
    expect(validReplaceAllRequest(bad)).toBe(false);
  const plan = {
    id: 7,
    kind: "plan",
    matched: 2,
    changed: 2,
    bytes: 3,
    pairs: new Uint32Array([0, 1, 2, 3]),
  };
  expect(validReplaceAllResult(plan, 7, 3)).toBe(true);
  for (const bad of [
    { ...plan, id: 8 },
    { ...plan, changed: 3 },
    { ...plan, changed: 0 },
    { ...plan, pairs: [0, 1, 2, 3] },
    { ...plan, pairs: new Uint32Array([0, 2, 1, 3]) },
    { ...plan, pairs: new Uint32Array([0, 1, 2, 4]) },
    { ...plan, pairs: new Uint32Array([0, 0, 2, 3]) },
    { ...plan, extra: true },
    { id: 7, kind: "noop", matched: 1, changed: 1 },
  ])
    expect(validReplaceAllResult(bad, 7, 3)).toBe(false);
});

test("source and joined output line work accept the exact budget, reject one extra unit", () => {
  const source = "a ".repeat(50000);
  const sourceAt = planReplaceAll(request(source, "a", "b"));
  expect(sourceAt.kind).toBe("plan");
  expect(planReplaceAll(request(source + " ", "a", "b"))).toEqual({
    id: 7,
    kind: "rejected",
    reason: "cost",
  });
  const joined = "a\n".repeat(50000);
  const outputAt = planReplaceAll(request(joined, "\n", "b"));
  expect(outputAt.kind).toBe("plan");
  expect(planReplaceAll(request(joined + "x", "\n", "b"))).toEqual({
    id: 7,
    kind: "rejected",
    reason: "cost",
  });

  // Bare Text plus production raw field avoids unrelated parsing and never commits
  // either expensive transaction. A forged worker reply cannot bypass live checks.
  if (sourceAt.kind !== "plan" || outputAt.kind !== "plan")
    throw Error("boundary plan");
  const sourceOver = source + " ",
    outputOver = joined + "x";
  const sourceState = EditorState.create({
    doc: sourceOver,
    extensions: rawText.init(() => sourceOver),
  });
  const outputState = EditorState.create({
    doc: outputOver,
    extensions: rawText.init(() => outputOver),
  });
  expect(
    prepareReplaceAll(sourceState, sourceOver, "b", {
      ...sourceAt,
      bytes: sourceAt.bytes + 1,
    })
  ).toBeNull();
  expect(
    prepareReplaceAll(outputState, outputOver, "b", {
      ...outputAt,
      bytes: outputAt.bytes + 1,
    })
  ).toBeNull();
  expect(sourceState.field(rawText)).toBe(sourceOver);
  expect(outputState.field(rawText)).toBe(outputOver);
});

test("live raw snapshot mismatch rejects even with identical logical Text", () => {
  const captured = "a\r\na",
    current = "a\na";
  const plan = planReplaceAll(request(captured, "a", "b"));
  if (plan.kind !== "plan") throw Error("expected plan");
  const state = createRawEditorState(current);
  expect(state.doc.toString()).toBe(editorText(captured));
  expect(prepareReplaceAll(state, captured, "b", plan)).toBeNull();
  expect(state.field(rawText)).toBe(current);
  expect(undoDepth(state)).toBe(0);
});

test("inserted line structure is bounded before construction without limiting existing lines", () => {
  const raw = "a a",
    replacement = "\n".repeat(ALL_INSERTED_BREAK_LIMIT / 2);
  const at = planReplaceAll(request(raw, "a", replacement));
  expect(at.kind).toBe("plan");
  const over = replacement + "\n";
  expect(planReplaceAll(request(raw, "a", over))).toEqual({
    id: 7,
    kind: "rejected",
    reason: "cost",
  });
  if (at.kind !== "plan") throw Error("expected boundary plan");
  const state = createRawEditorState(raw);
  expect(
    prepareReplaceAll(state, raw, over, { ...at, bytes: at.bytes + 2 })
  ).toBeNull();
  expect(state.field(rawText)).toBe(raw);
  expect(undoDepth(state)).toBe(0);

  // Existing lines are not newly inserted Text structure; only a sparse edit is planned.
  const existing = "\n".repeat(ALL_INSERTED_BREAK_LIMIT + 1) + "a";
  expect(planReplaceAll(request(existing, "a", "b")).kind).toBe("plan");
});

test("output cost respects retained lone CR as a logical line boundary", () => {
  const raw = "a ".repeat(50000) + "\rEND";
  const at = planReplaceAll(request(raw, "a", "b"));
  expect(at.kind).toBe("plan");
  const over = "a ".repeat(50000) + "x\rEND";
  expect(planReplaceAll(request(over, "a", "b"))).toEqual({
    id: 7,
    kind: "rejected",
    reason: "cost",
  });
  if (at.kind !== "plan") throw Error("expected boundary plan");
  const state = EditorState.create({
    doc: editorText(over),
    extensions: rawText.init(() => over),
  });
  expect(
    prepareReplaceAll(state, over, "b", { ...at, bytes: at.bytes + 1 })
  ).toBeNull();
  expect(state.field(rawText)).toBe(over);
});
