import { expect, test } from "bun:test";

import { undoDepth } from "@codemirror/commands";
import { Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type { Command } from "../shared/commands";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController } from "./documents";
import { editorFaultSession, type EditorFaultSession } from "./editor-fault";
import {
  createRawEditorState,
  rawText,
  sourceSearchPresentation,
} from "./raw-buffer";
import { createSearchEngine } from "./source-search-engine";
import { searchDecorations, routeSearchQueryKey } from "./source-search-view";

test("dense current match kept within bounded viewport decorations without changing state", () => {
  const engine = createSearchEngine();
  engine({
    kind: "scan",
    epoch: "e",
    id: 1,
    text: "a".repeat(5000),
    position: 4999,
    options: { query: "a", caseSensitive: true, wholeWord: false },
  });
  const result = engine({
    kind: "viewport",
    epoch: "e",
    id: 2,
    from: 0,
    to: 5000,
  });
  expect(result.limited).toBe(true);
  const marks = searchDecorations(result, [{ from: 0, to: 5000 }]);
  expect(marks.size).toBe(2048);
  let current = 0;
  for (let cursor = marks.iter(); cursor.value; cursor.next())
    if (
      (cursor.value.spec as { class?: string }).class ===
      "cm-sourceSearch-current"
    ) {
      current++;
      expect(cursor.from).toBe(4999);
    }
  expect(current).toBe(1);
  const state = createRawEditorState("a\r\nb");
  const before = state.field(rawText);
  const next = state.update({
    selection: { anchor: 0, head: 1 },
    annotations: Transaction.addToHistory.of(false),
  }).state;
  expect(next.field(rawText)).toBe(before);
  expect(undoDepth(next)).toBe(0);
});
test("query keys leave composing/229 untouched and dispatch unified navigation", () => {
  const commands: Command[] = [];
  let prevented = 0;
  const event = {
    key: "Enter",
    shiftKey: false,
    isComposing: false,
    keyCode: 13,
    preventDefault: () => {
      prevented++;
    },
    stopPropagation: () => undefined,
  };
  expect(routeSearchQueryKey(event, true, (c) => commands.push(c))).toBe(false);
  expect(
    routeSearchQueryKey({ ...event, isComposing: true }, false, (c) =>
      commands.push(c)
    )
  ).toBe(false);
  expect(
    routeSearchQueryKey({ ...event, keyCode: 229 }, false, (c) =>
      commands.push(c)
    )
  ).toBe(false);
  expect(prevented).toBe(0);
  routeSearchQueryKey(event, false, (c) => commands.push(c));
  routeSearchQueryKey({ ...event, shiftKey: true }, false, (c) =>
    commands.push(c)
  );
  routeSearchQueryKey({ ...event, key: "Escape" }, false, (c) =>
    commands.push(c)
  );
  expect(commands.map((c) => c.type)).toEqual([
    "nextSourceMatch",
    "previousSourceMatch",
    "closeSourceSearch",
  ]);
  expect(prevented).toBe(3);
});
test("controller conditions release on close/clear; readonly selection preserves raw/history", async () => {
  const text = "\ufeffa\r\na",
    snapshot = {
      documentId: crypto.randomUUID(),
      handle: crypto.randomUUID(),
      fileName: "search.md",
      revision: 1,
      hash: "a".repeat(64),
      text,
      byteLength: new TextEncoder().encode(text).length,
      fidelity: analyzeTextFidelity(text),
      writeCapability: {
        writable: false as const,
        reason: "readonly" as const,
      },
    };
  const controller = createDocumentController(
    {
      selectDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
      readDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
      cancelDocument: () => Promise.resolve(),
      releaseDocument: () => Promise.resolve(),
    },
    () => Promise.resolve(true)
  );
  await controller.select();
  const id = snapshot.documentId;
  expect(controller.getEditor(id)).toBeDefined();
  expect(controller.canWrite(id)).toBe(false);
  controller.search.set(id, { query: "a", open: true });
  const editor = controller.getEditor(id)!;
  expect(
    controller.updateEditor(
      id,
      editor.state.update({
        selection: { anchor: 1, head: 2 },
        annotations: Transaction.addToHistory.of(false),
      })
    )
  ).toBe(true);
  expect(controller.getEditor(id)!.state.field(rawText)).toBe(text);
  expect(controller.isDirty(id)).toBe(false);
  expect(undoDepth(controller.getEditor(id)!.state)).toBe(0);
  await controller.closeActive();
  expect(controller.search.get(id).query).toBe("");
  controller.search.set(id, { query: "late" });
  expect(controller.search.get(id).query).toBe("");
  await controller.select();
  controller.search.set(id, { query: "again", open: true });
  await controller.clear();
  expect(controller.search.get(id).open).toBe(false);
  controller.dispose();
});
test("unmounted source presentation is removed from retained reading state even while frozen", async () => {
  const text = "abc",
    snapshot = {
      documentId: crypto.randomUUID(),
      handle: crypto.randomUUID(),
      fileName: "search.md",
      revision: 1,
      hash: "a".repeat(64),
      text,
      byteLength: 3,
      fidelity: analyzeTextFidelity(text),
      writeCapability: {
        writable: false as const,
        reason: "readonly" as const,
      },
    };
  const controller = createDocumentController(
    {
      selectDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
      readDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
      cancelDocument: () => Promise.resolve(),
      releaseDocument: () => Promise.resolve(),
    },
    () => Promise.resolve(true)
  );
  await controller.select();
  const id = snapshot.documentId;
  controller.toggleReadingMode();
  controller.toggleSourceMode();
  expect(controller.getMode(id)).toBe("source");
  const retainedView = { sentinel: true };
  const extension: Extension = [
    EditorView.updateListener.of(() => {
      void retainedView.sentinel;
    }),
  ];
  const initial = controller.getEditor(id)!;
  controller.updateEditor(
    id,
    initial.state.update({
      effects: sourceSearchPresentation.reconfigure(extension),
      selection: { anchor: 1, head: 2 },
      annotations: Transaction.addToHistory.of(false),
    })
  );
  controller.toggleSourceMode();
  expect(controller.getMode(id)).toBe("reading");
  let finish!: () => void;
  const closing = controller.clear(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await Promise.resolve();
  expect(controller.getSnapshot().frozen).toBe(true);
  const before = controller.getEditor(id)!,
    session = before.state.field(editorFaultSession);
  expect(
    controller.updateEditor(
      id,
      before.state.update({ effects: sourceSearchPresentation.reconfigure([]) })
    )
  ).toBe(false);
  // Models child teardown after its parent destroyed the view; no live dispatch exists.
  expect(
    controller.releaseSearchPresentation(
      id,
      {} as EditorFaultSession,
      extension
    )
  ).toBeUndefined();
  expect(controller.releaseSearchPresentation(id, session, [])).toBeUndefined();
  expect(sourceSearchPresentation.get(controller.getEditor(id)!.state)).toBe(
    extension
  );
  controller.releaseSearchPresentation(id, session, extension);
  expect(sourceSearchPresentation.get(controller.getEditor(id)!.state)).toEqual(
    []
  );
  expect(controller.getEditor(id)!.revision).toBe(before.revision);
  expect(controller.getEditor(id)!.state.field(rawText)).toBe(text);
  expect(
    controller.getEditor(id)!.state.selection.eq(before.state.selection)
  ).toBe(true);
  expect(undoDepth(controller.getEditor(id)!.state)).toBe(
    undoDepth(before.state)
  );
  finish();
  await closing;
  controller.dispose();
});
