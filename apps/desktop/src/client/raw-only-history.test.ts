import { expect, test } from "bun:test";

import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { createRawEditorState, rawText } from "./raw-buffer";
import { requestText, savedReply } from "./save-test-helper";

test("raw-only CRLF join has one reversible history event without changing logical selection", () => {
  for (const raw of ["\r", "\ufeffa\r\nb\nc\r"]) {
    let state = createRawEditorState(raw);
    state = state.update({
      changes: { from: 0, insert: "X" },
      annotations: isolateHistory.of("full"),
    }).state;
    const before = state.field(rawText);
    state = state.update({
      selection: EditorSelection.cursor(state.doc.length),
    }).state;
    const selection = state.selection;
    const tx = state.update({
      changes: { from: state.doc.length, insert: "\n" },
      annotations: isolateHistory.of("full"),
    });
    expect(tx.docChanged).toBe(false);
    state = tx.state;
    expect(state.field(rawText)).toBe(before + "\n");
    expect(state.selection.eq(selection)).toBe(true);
    expect(undoDepth(state)).toBe(2);
    const target = () => ({
      state,
      dispatch: (t: Transaction) => {
        state = t.state;
      },
    });
    expect(undo(target())).toBe(true);
    expect(state.field(rawText)).toBe(before);
    expect(redo(target())).toBe(true);
    expect(state.field(rawText)).toBe(before + "\n");
    expect(undo(target())).toBe(true);
    expect(undo(target())).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  }
});

async function setup(text: string, writable = true) {
  const snapshot: DocumentSnapshot = {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: writable
      ? { writable: true, reason: "writable" }
      : { writable: false, reason: "readonly" },
  };
  const transport: DocumentTransport = {
    selectDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    readDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
  };
  const c = createDocumentController(transport);
  await c.select();
  return { c, snapshot, id: snapshot.documentId, transport };
}

test("controller publishes raw-only edit and undo/redo, but not selection-only", async () => {
  const { c, id, snapshot } = await setup("\r");
  let publications = 0;
  const release = c.subscribe(() => {
    publications++;
  });
  const original = c.getEditor(id)!;
  const tx = original.state.update({
    changes: { from: 1, insert: "\n" },
    annotations: isolateHistory.of("full"),
  });
  expect(tx.docChanged).toBe(false);
  expect(c.updateEditor(id, tx)).toBe(true);
  expect(publications).toBe(1);
  expect(c.getEditor(id)!.revision).toBe(original.revision + 1);
  expect(c.isDirty(id)).toBe(true);
  expect(c.getSnapshot().snapshot).toBe(snapshot);
  expect(c.runHistory("undo")).toBe(true);
  expect(c.getEditor(id)!.state.field(rawText)).toBe("\r");
  expect(c.isDirty(id)).toBe(false);
  expect(publications).toBe(2);
  expect(c.runHistory("redo")).toBe(true);
  expect(publications).toBe(3);
  const current = c.getEditor(id)!;
  expect(
    c.updateEditor(id, current.state.update({ selection: { anchor: 0 } }))
  ).toBe(true);
  expect(c.getEditor(id)!.revision).toBe(current.revision);
  expect(publications).toBe(3);
  expect(c.updateEditor(id, tx)).toBe(false);
  release();
  c.dispose();
});

test("raw-only growth obeys UTF8 limit atomically, including exact boundary", async () => {
  for (const bytes of [1024 * 1024 - 1, 1024 * 1024]) {
    const { c, id } = await setup("a".repeat(bytes - 1) + "\r");
    const before = c.getEditor(id)!;
    const tx = before.state.update({
      changes: { from: before.state.doc.length, insert: "\n" },
    });
    expect(tx.docChanged).toBe(false);
    expect(c.updateEditor(id, tx)).toBe(bytes < 1024 * 1024);
    if (bytes === 1024 * 1024) {
      expect(c.getEditor(id)).toBe(before);
      expect(c.isDirty(id)).toBe(false);
      expect(undoDepth(c.getEditor(id)!.state)).toBe(0);
      expect(c.getSnapshot().error).toContain("1 MiB");
    } else {
      expect(
        new TextEncoder().encode(c.getEditor(id)!.state.field(rawText)).length
      ).toBe(1024 * 1024);
    }
    c.dispose();
  }
});

test("raw-only writes retain readonly and input-blocked guards", async () => {
  for (const writable of [false, true]) {
    const { c, id } = await setup("\r", writable);
    if (writable) c.setEditorInputBlocked(true);
    const before = c.getEditor(id)!;
    const tx = before.state.update({ changes: { from: 1, insert: "\n" } });
    expect(c.updateEditor(id, tx)).toBe(false);
    expect(c.getEditor(id)).toBe(before);
    c.dispose();
  }
});

test("raw-only changes cannot bypass reading or discard freeze", async () => {
  for (const mode of ["reading", "frozen"] as const) {
    const { c, id } = await setup("\r");
    if (mode === "reading") expect(c.toggleReadingMode()).toBe(true);
    else expect(c.beginDiscard()).toBe(true);
    const before = c.getEditor(id)!;
    expect(
      c.updateEditor(
        id,
        before.state.update({ changes: { from: 1, insert: "\n" } })
      )
    ).toBe(false);
    expect(c.getEditor(id)).toBe(before);
    if (mode === "frozen") c.endDiscard();
    c.dispose();
  }
});

test("raw-only history between text edits preserves reversed ranges and mainIndex", () => {
  let state = createRawEditorState(
    "ab\r",
    EditorState.allowMultipleSelections.of(true)
  );
  state = state.update({
    selection: EditorSelection.create(
      [EditorSelection.range(2, 0), EditorSelection.cursor(3)],
      1
    ),
  }).state;
  const selected = state.selection;
  state = state.update({
    changes: { from: 3, insert: "\n" },
    annotations: isolateHistory.of("full"),
  }).state;
  expect(state.selection.eq(selected)).toBe(true);
  state = state.update({
    changes: { from: 0, insert: "X" },
    annotations: isolateHistory.of("full"),
  }).state;
  const target = () => ({
    state,
    dispatch: (t: Transaction) => {
      state = t.state;
    },
  });
  expect(undo(target())).toBe(true);
  expect(state.field(rawText)).toBe("ab\r\n");
  expect(undo(target())).toBe(true);
  expect(state.field(rawText)).toBe("ab\r");
  expect(state.selection.eq(selected)).toBe(true);
  expect(state.selection.mainIndex).toBe(1);
  expect(redo(target())).toBe(true);
  expect(redo(target())).toBe(true);
  expect(state.field(rawText)).toBe("Xab\r\n");
});

test("controller save captures raw-only bytes without clearing history", async () => {
  const { c, id, snapshot, transport } = await setup("\r");
  let captured: string | undefined;
  transport.saveDocument = (request) => {
    captured = requestText(request, snapshot);
    return Promise.resolve(savedReply(request, snapshot));
  };
  const before = c.getEditor(id)!;
  expect(
    c.updateEditor(
      id,
      before.state.update({
        changes: { from: 1, insert: "\n" },
        annotations: isolateHistory.of("full"),
      })
    )
  ).toBe(true);
  await c.save();
  expect(captured).toBe("\r\n");
  expect(c.isDirty(id)).toBe(false);
  expect(c.runHistory("undo")).toBe(true);
  expect(c.getEditor(id)!.state.field(rawText)).toBe("\r");
  expect(c.isDirty(id)).toBe(true);
  c.dispose();
});

test("three original randomized CR seam failures undo to exact original bytes", () => {
  for (const [raw, at] of [
    ["\n😀\ufeffa\ufeff\r\nab😀\n\r\ufeff\rb\r\ufeffaba\ufeff😀b", 17],
    ["😀ba\ufeff😀\ufeffa\n\rb", 11],
    ["\ufeff😀\ufeffab\rb\rb", 7],
  ] as const) {
    let state = createRawEditorState(raw);
    state = state.update({ changes: { from: at, insert: "\n" } }).state;
    const after = state.field(rawText);
    expect(after).not.toBe(raw);
    const target = () => ({
      state,
      dispatch: (t: Transaction) => {
        state = t.state;
      },
    });
    expect(undo(target())).toBe(true);
    expect(state.field(rawText)).toBe(raw);
    expect(redo(target())).toBe(true);
    expect(state.field(rawText)).toBe(after);
  }
});
