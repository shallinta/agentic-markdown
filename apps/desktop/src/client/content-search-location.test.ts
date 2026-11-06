import { expect, test } from "bun:test";

import { foldEffect } from "@codemirror/language";

import type { DocumentRequest, DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import {
  contentSearchEditorRange,
  type ContentSearchLocation,
} from "./content-search-location";
import { createDocumentController } from "./documents";
import { createRawEditorState, rawText } from "./raw-buffer";

test("location maps exact UTF-16 offsets through BOM and CRLF without clamping", () => {
  const state = createRawEditorState("\uFEFFa\r\n😀中文\r\n");
  expect(contentSearchEditorRange(state, { query: "😀中文", from: 4, to: 8 }))
    .toEqual({ from: 3, to: 7 });
  expect(contentSearchEditorRange(state, { query: "a\r\n😀", from: 1, to: 6 }))
    .toEqual({ from: 1, to: 5 });
  expect(contentSearchEditorRange(state, { query: "\n😀", from: 3, to: 6 }))
    .toBeUndefined();
  expect(contentSearchEditorRange(state, { query: "a\r", from: 1, to: 3 }))
    .toBeUndefined();
  expect(contentSearchEditorRange(state, { query: "😀中文", from: 5, to: 9 }))
    .toBeUndefined();
});

test("a location inside a fold leaves that fold intact", () => {
  const state = createRawEditorState("# Fold\ntext below\n").update({
    effects: foldEffect.of({ from: 6, to: 17 }),
  }).state;
  expect(contentSearchEditorRange(state, { query: "Fold", from: 2, to: 6 }))
    .toEqual({ from: 2, to: 6 });
  expect(contentSearchEditorRange(state, { query: "text", from: 7, to: 11 }))
    .toBeUndefined();
});

const hash = "b".repeat(64);
function fixture(text = "text", locationId: string = crypto.randomUUID()): DocumentSnapshot {
  return {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    locationId,
    fileName: "sample.md",
    revision: 1,
    hash,
    byteLength: new TextEncoder().encode(text).length,
    text,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
}

const respond = (request: DocumentRequest, snapshot: DocumentSnapshot | null) =>
  ({ ...request, ok: true, snapshot });

function setup(files: DocumentSnapshot[]) {
  const released: string[] = [];
  const documents = createDocumentController({
    cancelDocument: (request) => Promise.resolve(respond(request, null)),
    readDocument: (request) => Promise.resolve(respond(request, null)),
    releaseDocument: (request) => {
      released.push(request.handle);
      return Promise.resolve(respond(request, null));
    },
    selectDocument: (request) =>
      Promise.resolve(respond(request, files.shift() ?? null)),
  });
  return { documents, released };
}

function locateMemory(
  documents: ReturnType<typeof createDocumentController>,
  documentId: string
): ContentSearchLocation {
  const captured = documents.captureContentSearch();
  if (!captured.ok) throw Error("Missing search capture");
  const version = captured.documents.find((entry) => entry.documentId === documentId);
  if (!version) throw Error("Missing search document version");
  return { query: "😀中文", from: 4, to: 8, source: "memory", diskHash: hash, version };
}

test("search activation retains buffer, waits for the target, and selects once without autofocus", async () => {
  const a = fixture("\uFEFFa\r\n");
  const b = fixture();
  const { documents } = setup([a, b]);
  try {
    await documents.select();
    await documents.select();
    const before = documents.getEditor(a.documentId)!;
    expect(documents.updateEditor(a.documentId, before.state.update({
      changes: { from: before.state.doc.length, insert: "😀中文" },
    }))).toBe(true);
    const location = locateMemory(documents, a.documentId);
    let ready = false;
    const selections: { from: number; to: number }[] = [];
    documents.registerContentSearchTarget({
      documentId: a.documentId,
      ready: () => ready,
      select: (range, state) => {
        expect(state.field(rawText)).toBe("\uFEFFa\r\n😀中文");
        selections.push(range);
        documents.notifyInteraction();
        return true;
      },
    });
    const pending = documents.activateContentSearchLocation(location, () => true);
    expect(documents.getSnapshot().snapshot).toBe(a);
    expect(documents.shouldAutoFocusEditor(a.documentId)).toBe(false);
    await Promise.resolve();
    expect(selections).toEqual([]);
    ready = true;
    documents.notifyContentSearchTargetReady();
    expect(await pending).toBe(true);
    documents.notifyContentSearchTargetReady();
    await Promise.resolve();
    expect(selections).toEqual([{ from: 3, to: 7 }]);
    documents.activateTab(a.documentId);
    expect(documents.shouldAutoFocusEditor(a.documentId)).toBe(true);
  } finally {
    documents.dispose();
  }
});

test("an edit and undo while waiting for the view cannot revive the old locator", async () => {
  const a = fixture("\uFEFFa\r\n");
  const { documents } = setup([a]);
  try {
    await documents.select();
    const initial = documents.getEditor(a.documentId)!.state;
    documents.updateEditor(a.documentId, initial.update({
      changes: { from: initial.doc.length, insert: "😀中文" },
    }));
    const location = locateMemory(documents, a.documentId);
    const pending = documents.activateContentSearchLocation(location, () => true);
    const active = documents.getEditor(a.documentId)!.state;
    documents.updateEditor(a.documentId, active.update({
      changes: { from: 0, insert: "change" },
    }));
    expect(documents.runHistory("undo", a.documentId)).toBe(true);
    expect(documents.getEditor(a.documentId)!.state.field(rawText))
      .toBe("\uFEFFa\r\n😀中文");
    expect(await pending).toBe(false);
  } finally {
    documents.dispose();
  }
});

test("a temporary editor input guard consumes a pending locator", async () => {
  const snapshot = fixture();
  const { documents } = setup([snapshot]);
  try {
    await documents.select();
    const capture = documents.captureContentSearch();
    if (!capture.ok) throw Error("Missing search capture");
    const pending = documents.activateContentSearchLocation({
      query: "text", from: 0, to: 4, source: "disk",
      diskHash: hash, version: capture.documents[0],
    }, () => true);
    documents.setEditorInputBlocked(true);
    documents.setEditorInputBlocked(false);
    let selections = 0;
    documents.registerContentSearchTarget({
      documentId: snapshot.documentId,
      ready: () => true,
      select: () => { selections++; return true; },
    });
    expect(await pending).toBe(false);
    expect(selections).toBe(0);
  } finally {
    documents.dispose();
  }
});

test("late and colliding prepared grants are released without replacing a tab", async () => {
  const incumbent = fixture();
  const incoming = fixture("text", incumbent.locationId);
  const late = fixture();
  const { documents, released } = setup([incumbent]);
  const location: ContentSearchLocation = {
    query: "text", from: 0, to: 4, source: "disk", diskHash: hash,
  };
  try {
    await documents.select();
    const before = documents.getEditor(incumbent.documentId)!.state;
    expect(await documents.openContentSearchLocation(
      (request) => Promise.resolve(respond(request, incoming)),
      location,
      () => true
    )).toBe(false);
    expect(documents.getSnapshot().tabs).toEqual([incumbent]);
    expect(documents.getEditor(incumbent.documentId)!.state).toBe(before);

    let current = true;
    let complete: (() => void) | undefined;
    const pending = documents.openContentSearchLocation(
      (request) => new Promise((resolve) => {
        complete = () => resolve(respond(request, late));
      }),
      location,
      () => current
    );
    current = false;
    complete?.();
    expect(await pending).toBe(false);
    expect(released).toEqual([incoming.handle, late.handle]);
    expect(documents.getSnapshot().tabs).toEqual([incumbent]);
  } finally {
    documents.dispose();
  }
});

test("preparing an unopened hit leaves the current editor available and does not override newer activation", async () => {
  const incumbent = fixture();
  const incoming = fixture();
  const { documents, released } = setup([incumbent]);
  try {
    await documents.select();
    const prepared = Promise.withResolvers<unknown>();
    const pending = documents.openContentSearchLocation(
      (request) => {
        queueMicrotask(() => prepared.resolve(respond(request, incoming)));
        return prepared.promise;
      },
      { query: "text", from: 0, to: 4, source: "disk", diskHash: hash },
      () => true
    );
    expect(documents.getSnapshot().busy).toBe(false);
    const before = documents.getEditor(incumbent.documentId)!.state;
    expect(documents.updateEditor(incumbent.documentId, before.update({
      changes: { from: 0, insert: "new " },
    }))).toBe(true);
    documents.activateTab(incumbent.documentId);
    expect(await pending).toBe(false);
    expect(documents.getSnapshot().tabs).toEqual([incumbent]);
    expect(documents.getEditor(incumbent.documentId)!.state.field(rawText))
      .toBe("new text");
    expect(released).toEqual([incoming.handle]);
  } finally {
    documents.dispose();
  }
});

test("a fresh read-only grant opens as a persistent tab and allows only selection", async () => {
  const snapshot: DocumentSnapshot = {
    ...fixture(), writeCapability: { writable: false, reason: "readonly" },
  };
  const { documents, released } = setup([]);
  try {
    documents.registerContentSearchTarget({
      documentId: snapshot.documentId,
      ready: () => true,
      select: ({ from, to }, state) => documents.updateEditor(
        snapshot.documentId,
        state.update({ selection: { anchor: from, head: to } })
      ),
    });
    expect(await documents.openContentSearchLocation(
      (request) => Promise.resolve(respond(request, snapshot)),
      { query: "ext", from: 1, to: 4, source: "disk", diskHash: hash },
      () => true
    )).toBe(true);
    expect(documents.getSnapshot().tabs).toEqual([snapshot]);
    const editor = documents.getEditor(snapshot.documentId)!;
    expect(documents.canWrite(snapshot.documentId)).toBe(false);
    expect(editor.revision).toBe(0);
    expect(editor.state.selection.main.from).toBe(1);
    expect(editor.state.selection.main.to).toBe(4);
    expect(documents.shouldAutoFocusEditor(snapshot.documentId)).toBe(false);
    expect(released).toEqual([]);
  } finally {
    documents.dispose();
  }
});
