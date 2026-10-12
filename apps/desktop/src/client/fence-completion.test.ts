import { expect, test } from "bun:test";

import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { parseCanonicalMarkdown } from "./canonical-parser";
import { createDocumentController } from "./documents";
import { editorFaultSession } from "./editor-fault";
import { switchEditorMode } from "./editor-mode";
import {
  fenceCompletionTransaction,
  isCurrentFenceCompletion,
} from "./fence-completion";
import { listContinuationTransaction } from "./list-continuation";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";

function lastNode(raw: string) {
  const children = parseCanonicalMarkdown(raw).children;
  return children[children.length - 1];
}

function ready(raw: string, source = false) {
  let state = createRawEditorState(raw);
  if (source)
    state = state.update({ effects: switchEditorMode("source") }).state;
  return state.update({ selection: { anchor: state.doc.length } }).state;
}
test("EOF completion preserves marker/info, baseline, raw and first caret in both modes", () => {
  for (const source of [false, true])
    for (const [raw, prefix, marker, eol] of [
      ["```", "", "```", "\n"],
      ["````ts", "", "````", "\n"],
      [" ~~~~~ js meta", " ", "~~~~~", "\n"],
      ["  ~~~js", "  ", "~~~", "\n"],
      ["   ``` js", "   ", "```", "\n"],
      ["\ufeff```js", "", "```", "\n"],
      ["head\r\n\r\n~~~js", "", "~~~", "\r\n"],
      ["head\nnext\r\n\r\n```js", "", "```", "\r\n"],
      ["head\r\r~~~js", "", "~~~", "\n"],
    ]) {
      const initial = ready(raw, source),
        tx = fenceCompletionTransaction(initial, false);
      expect(tx).toBeDefined();
      if (!tx) continue;
      let state = tx.state;
      expect(state.field(rawText)).toBe(
        raw + eol + prefix + eol + prefix + marker
      );
      expect(state.selection.main.head).toBe(
        initial.doc.length + 1 + prefix.length
      );
      expect(state.doc.lineAt(state.selection.main.head).text).toBe(prefix);
      const old = lastNode(raw),
        node = lastNode(state.field(rawText));
      expect(old?.type).toBe("code");
      expect(node?.type).toBe("code");
      if (old?.type === "code" && node?.type === "code") {
        expect(node.value).toBe("");
        expect(node.lang).toBe(old.lang);
        expect(node.meta).toBe(old.meta);
      }
      const typing = ready(state.field(rawText)).update({
        selection: state.selection,
      }).state;
      const after = typing.update({
        changes: { from: typing.selection.main.head, insert: "VALUE" },
      }).state;
      const value = lastNode(after.field(rawText));
      expect(value?.type === "code" ? value.value : undefined).toBe("VALUE");
      const target = {
        get state() {
          return state;
        },
        dispatch(t: typeof tx) {
          state = t.state;
        },
      };
      expect(undoDepth(state)).toBe(1);
      expect(undo(target)).toBe(true);
      expect(state.field(rawText)).toBe(raw);
      expect(state.selection.eq(initial.selection)).toBe(true);
      expect(redo(target)).toBe(true);
      expect(state.field(rawText)).toBe(tx.state.field(rawText));
      // Existing CM redo places the caret at the insertion's end, not the initial content line.
      expect(state.selection.main.head).toBe(state.doc.length);
    }
});
test("incrementally typed opening is ready without forcing parsing", () => {
  for (const source of [false, true])
    for (const raw of ["```", "````js", "~~~", "  ~~~~js"]) {
      let state = ready("", source);
      for (const char of raw)
        state = state.update({
          changes: { from: state.doc.length, insert: char },
          selection: { anchor: state.doc.length + char.length },
        }).state;
      expect(fenceCompletionTransaction(state, false)).toBeDefined();
    }
});
test("unsupported contexts delegate to exactly the existing Enter transaction", () => {
  for (const raw of [
    "```\nx\n```",
    "```\nline",
    "```\n~~~",
    "```a`b",
    "    ```",
    "\t```",
    "> ```",
    "- ```",
    "<div>\n```",
    "```\nPLAIN",
  ]) {
    const state = ready(raw);
    expect(fenceCompletionTransaction(state, false)).toBeUndefined();
    const original = listContinuationTransaction(state, false),
      composed =
        fenceCompletionTransaction(state, false) ??
        listContinuationTransaction(state, false);
    expect(composed.state.field(rawText)).toBe(original.state.field(rawText));
    expect(composed.state.selection.eq(original.state.selection)).toBe(true);
  }
  const state = ready("```", true);
  for (const selection of [
    EditorSelection.single(0, 3),
    EditorSelection.single(1),
    EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(3)],
      1
    ),
  ])
    expect(
      fenceCompletionTransaction(state.update({ selection }).state, false)
    ).toBeUndefined();
  expect(fenceCompletionTransaction(state, true)).toBeUndefined();
});
test("history isolates prior input, completion and subsequent typing", () => {
  let state = ready("```");
  state = state.update({
    changes: { from: 3, insert: "js" },
    selection: { anchor: 5 },
    annotations: isolateHistory.of("full"),
  }).state;
  const completion = fenceCompletionTransaction(state, false);
  expect(completion).toBeDefined();
  if (!completion) return;
  state = completion.state;
  state = state.update({
    changes: { from: state.selection.main.head, insert: "x" },
    annotations: isolateHistory.of("full"),
  }).state;
  const target = {
    get state() {
      return state;
    },
    dispatch(t: typeof completion) {
      state = t.state;
    },
  };
  for (const raw of ["```js\n\n```", "```js", "```"]) {
    expect(undo(target)).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
  for (const raw of ["```js", "```js\n\n```", "```js\nx\n```"]) {
    expect(redo(target)).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
});
test("strong new-path ownership, permission and bounded planning guards", () => {
  const state = ready("```"),
    session = state.field(editorFaultSession);
  expect(isCurrentFenceCompletion(state, state, session, true)).toBe(true);
  expect(
    isCurrentFenceCompletion(
      state,
      state.update({ selection: { anchor: 2 } }).state,
      session,
      true
    )
  ).toBe(false);
  expect(
    isCurrentFenceCompletion(
      state,
      state,
      ready("```").field(editorFaultSession),
      true
    )
  ).toBe(false);
  expect(isCurrentFenceCompletion(state, state, session, false)).toBe(false);
  expect(isCurrentFenceCompletion(state, undefined, session, true)).toBe(false);
  expect(
    fenceCompletionTransaction(
      state.update({
        effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
      }).state,
      false
    )
  ).toBeUndefined();
  expect(
    fenceCompletionTransaction(
      EditorState.create({ doc: "```", selection: { anchor: 3 } }),
      false
    )
  ).toBeUndefined();
  expect(
    fenceCompletionTransaction(ready("```" + "x".repeat(10000)), false)
  ).toBeUndefined();
  session.fault = "presentation";
  expect(isCurrentFenceCompletion(state, state, session, true)).toBe(false);
});
test("completion constructs exactly one transaction through installed filters", () => {
  let calls = 0;
  const state = ready("```").update({
    effects: StateEffect.appendConfig.of(
      EditorState.transactionFilter.of((tx) => {
        calls++;
        return tx;
      })
    ),
  }).state;
  calls = 0;
  const tx = fenceCompletionTransaction(state, false);
  expect(tx).toBeDefined();
  expect(calls).toBe(1);
});

test("actual controller rejects completion exceeding 1 MiB without changing raw or history", async () => {
  const raw =
    ("a".repeat(1022) + "\n\n").repeat(1023) + "a".repeat(1019) + "\n\n```";
  const snapshot: DocumentSnapshot = {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "limit.md",
    revision: 1,
    hash: "a".repeat(64),
    text: raw,
    byteLength: new TextEncoder().encode(raw).length,
    fidelity: analyzeTextFidelity(raw),
    writeCapability: { writable: true, reason: "writable" },
  };
  const controller = createDocumentController({
    selectDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    readDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
  });
  try {
    await controller.select();
    const id = snapshot.documentId;
    let editor = controller.getEditor(id)!;
    expect(
      controller.updateEditor(
        id,
        editor.state.update({ selection: { anchor: editor.state.doc.length } })
      )
    ).toBe(true);
    editor = controller.getEditor(id)!;
    expect(editor.state.readOnly).toBe(false);
    expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
    // Test-only readiness of a large loaded fixture; production never forces parsing.
    expect(
      ensureSyntaxTree(editor.state, editor.state.doc.length, 2000)
    ).not.toBeNull();
    expect(controller.updateEditor(id, editor.state.update({}))).toBe(true);
    editor = controller.getEditor(id)!;
    const tx = fenceCompletionTransaction(editor.state, false);
    expect(tx).toBeDefined();
    if (!tx) return;
    expect(controller.updateEditor(id, tx)).toBe(false);
    expect(controller.getEditor(id)!.state).toBe(editor.state);
    expect(controller.getEditor(id)!.state.field(rawText)).toBe(raw);
    expect(controller.getEditor(id)!.revision).toBe(editor.revision);
    expect(controller.isDirty(id)).toBe(false);
    expect(undoDepth(controller.getEditor(id)!.state)).toBe(0);
  } finally {
    controller.dispose();
  }
});
