import { expect, test } from "bun:test";

import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

import type {
  DocumentRequest,
  DocumentResponse,
  DocumentSnapshot,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import {
  createDocumentController,
  isDocumentResponse,
  type DocumentTransport,
} from "./documents";
import { rawText } from "./raw-buffer";

function snapshot(text = "# 中文 <script>alert(1)</script>"): DocumentSnapshot {
  return {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    hash: "a".repeat(64),
    byteLength: new TextEncoder().encode(text).length,
    text,
    fidelity: analyzeTextFidelity(text),
  };
}
function result(
  request: DocumentRequest,
  value: DocumentSnapshot | null
): DocumentResponse {
  return { ...request, ok: true, snapshot: value };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const value = snapshot();
  const released: string[] = [];
  const cancelled: string[] = [];
  const transport: DocumentTransport = {
    cancelDocument: (request) => {
      cancelled.push(request.requestId);
      return Promise.resolve(result(request, null));
    },
    selectDocument: (request) => Promise.resolve(result(request, value)),
    readDocument: (request) => Promise.resolve(result(request, value)),
    releaseDocument: (request) => {
      released.push(request.handle);
      return Promise.resolve(result(request, null));
    },
  };
  return {
    value,
    transport,
    released,
    cancelled,
    controller: createDocumentController(transport),
  };
}

test("runtime scroll effects follow identical document state and clear on reload/close", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  const doc = controller.getEditor(value.documentId)!.state.doc;
  const effect = EditorView.scrollIntoView(2, { y: "start" });
  controller.setScrollSnapshot(value.documentId, doc, effect);
  const second = snapshot("second");
  transport.selectDocument = (req) => Promise.resolve(result(req, second));
  await controller.select();
  controller.activateTab(value.documentId);
  expect(controller.getScrollSnapshot(value.documentId)).toBe(effect);
  await controller.reload();
  expect(controller.getScrollSnapshot(value.documentId)).toBeUndefined();
  // A view disposed after a reload must not reintroduce the old document anchor.
  controller.setScrollSnapshot(value.documentId, doc, effect);
  expect(controller.getScrollSnapshot(value.documentId)).toBeUndefined();
  const current = controller.getEditor(value.documentId)!.state.doc;
  controller.setScrollSnapshot(value.documentId, current, effect);
  await controller.closeActive();
  expect(controller.getScrollSnapshot(value.documentId)).toBeUndefined();
  controller.setScrollSnapshot(value.documentId, current, effect);
  expect(controller.getScrollSnapshot(value.documentId)).toBeUndefined();
});

test("per-document buffer, selection, history and baseline survive switching and reselect", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  const initial = controller.getEditor(value.documentId)!.state;
  const edit = initial.update({
    changes: { from: 0, insert: "\uFEFF改\n" },
    selection: { anchor: 2 },
  });
  expect(controller.updateEditor(value.documentId, edit)).toBe(true);
  expect(controller.isDirty(value.documentId)).toBe(true);
  const second = snapshot("B\r\n");
  transport.selectDocument = (req) => Promise.resolve(result(req, second));
  await controller.select();
  controller.activateTab(value.documentId);
  expect(controller.getEditor(value.documentId)!.state).toBe(edit.state);
  transport.selectDocument = (req) => Promise.resolve(result(req, value));
  await controller.select();
  expect(controller.getEditor(value.documentId)!.state).toBe(edit.state);
  expect(
    controller.getEditor(value.documentId)!.state.selection.main.anchor
  ).toBe(2);
  undo({
    state: edit.state,
    dispatch: (tr) => {
      controller.updateEditor(value.documentId, tr);
    },
  });
  expect(controller.getEditor(value.documentId)!.state.field(rawText)).toBe(
    value.text
  );
  expect(controller.isDirty(value.documentId)).toBe(false);
});

test("selection-only noncollapsed range survives A to B to A without a text edit", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  const initial = controller.getEditor(value.documentId)!.state;
  const selected = initial.update({ selection: { anchor: 2, head: 8 } });
  expect(selected.docChanged).toBe(false);
  expect(controller.updateEditor(value.documentId, selected)).toBe(true);
  const second = snapshot("second document");
  transport.selectDocument = (req) => Promise.resolve(result(req, second));
  await controller.select();
  controller.activateTab(value.documentId);
  const restored = controller.getEditor(value.documentId)!.state;
  expect(restored).toBe(selected.state);
  expect(restored.selection.main.from).toBe(2);
  expect(restored.selection.main.to).toBe(8);
  expect(restored.selection.main.empty).toBe(false);
});

test("dirty close/clear cancelled preserves state; reload freezes until completed and failed read retains buffer", async () => {
  const { transport, value } = setup();
  let choice = deferred<boolean>();
  const controller = createDocumentController(transport, () => choice.promise);
  await controller.select();
  const edit = controller
    .getEditor(value.documentId)!
    .state.update({ changes: { from: 0, insert: "changed" } });
  controller.updateEditor(value.documentId, edit);
  for (const operation of [controller.closeActive, controller.clear]) {
    choice = deferred<boolean>();
    const promise = operation();
    expect(controller.getSnapshot().frozen).toBe(true);
    expect(
      controller.updateEditor(
        value.documentId,
        edit.state.update({ changes: { from: 0, insert: "lost?" } })
      )
    ).toBe(false);
    choice.resolve(false);
    await promise;
    expect(controller.getEditor(value.documentId)!.state).toBe(edit.state);
    expect(controller.getSnapshot().frozen).toBe(false);
  }
  const response = deferred<unknown>();
  transport.readDocument = () => response.promise;
  choice = deferred<boolean>();
  const reading = controller.reload();
  choice.resolve(true);
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.getSnapshot().frozen).toBe(true);
  expect(
    controller.updateEditor(
      value.documentId,
      edit.state.update({ changes: { from: 0, insert: "lost?" } })
    )
  ).toBe(false);
  response.resolve({ invalid: true });
  await reading;
  expect(controller.getEditor(value.documentId)!.state).toBe(edit.state);
  expect(controller.isDirty(value.documentId)).toBe(true);
  expect(controller.getSnapshot().frozen).toBe(false);
});

test("same-location replacement cannot discard dirty old identity without confirmation", async () => {
  const { transport, value } = setup();
  value.locationId = crypto.randomUUID();
  let approve = false;
  const controller = createDocumentController(transport, () =>
    Promise.resolve(approve)
  );
  await controller.select();
  const edit = controller
    .getEditor(value.documentId)!
    .state.update({ changes: { from: 0, insert: "draft" } });
  controller.updateEditor(value.documentId, edit);
  const replacement = {
    ...snapshot("replacement"),
    locationId: value.locationId,
  };
  transport.selectDocument = (req) => Promise.resolve(result(req, replacement));
  await controller.select();
  expect(controller.getSnapshot().snapshot!.documentId).toBe(value.documentId);
  expect(controller.getEditor(value.documentId)!.state).toBe(edit.state);
  approve = true;
  await controller.select();
  expect(controller.getSnapshot().snapshot!.documentId).toBe(
    replacement.documentId
  );
  expect(controller.getEditor(value.documentId)).toBeUndefined();
});

test("oversized editing is rejected intact; composition prevents destructive transitions", async () => {
  const { controller, value } = setup();
  await controller.select();
  const initial = controller.getEditor(value.documentId)!.state;
  expect(
    controller.updateEditor(
      value.documentId,
      initial.update({ changes: { from: 0, insert: "x".repeat(1024 * 1024) } })
    )
  ).toBe(false);
  expect(controller.getEditor(value.documentId)!.state).toBe(initial);
  controller.setInteractionCheck(() => false);
  await controller.clear();
  await controller.closeActive();
  expect(controller.beginDiscard()).toBe(false);
  expect(controller.getSnapshot().tabs.length).toBe(1);
});

test("selection, unchanged reload and clear preserve raw text and release capability", async () => {
  const { controller, value, released } = setup();
  await controller.select();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  await controller.reload();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  await controller.clear();
  expect(controller.getSnapshot().snapshot).toBeNull();
  expect(released).toEqual([value.handle]);
});

test("cancel and selection errors preserve current document; read error marks old snapshot", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, null));
  await controller.select();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  transport.selectDocument = (request) =>
    Promise.resolve({ ...request, ok: false, error: "TOO_LARGE" });
  await controller.select();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  expect(controller.getSnapshot().error).toContain("1 MiB");
  transport.readDocument = (request) =>
    Promise.resolve({ ...request, ok: false, error: "FILE_CHANGED" });
  await controller.reload();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  expect(controller.getSnapshot().stale).toBe(true);
  await controller.select();
  expect(controller.getSnapshot().stale).toBe(true);
  transport.selectDocument = () =>
    Promise.reject(new Error("connection failed"));
  await controller.select();
  expect(controller.getSnapshot().stale).toBe(true);
});

test("late reads cannot overwrite a newer selection", async () => {
  const { controller, transport, cancelled } = setup();
  await controller.select();
  const delayed = deferred<unknown>();
  let pending!: DocumentRequest;
  transport.readDocument = (request) => {
    pending = request;
    return delayed.promise;
  };
  const reload = controller.reload();
  const next = snapshot("new");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, next));
  await controller.select();
  expect(cancelled).toContain(pending.requestId);
  delayed.resolve(result(pending, snapshot("old")));
  await reload;
  expect(controller.getSnapshot().snapshot).toEqual(next);
});

test("clearing during selection discards result and releases its capability", async () => {
  const { controller, transport, value, released, cancelled } = setup();
  const delayed = deferred<unknown>();
  let pending!: DocumentRequest;
  transport.selectDocument = (request) => {
    pending = request;
    return delayed.promise;
  };
  const select = controller.select();
  await controller.clear();
  expect(cancelled).toEqual([pending.requestId]);
  delayed.resolve(result(pending, value));
  await select;
  expect(controller.getSnapshot().snapshot).toBeNull();
  expect(released).toContain(value.handle);
});

test("version regression, identity mismatch and malformed replies are rejected", async () => {
  const { controller, transport, value } = setup();
  value.revision = 2;
  await controller.select();
  for (const next of [
    { ...value, revision: 1 },
    { ...value, documentId: crypto.randomUUID() },
    { ...value, hash: "b".repeat(64) },
  ]) {
    transport.readDocument = (request) =>
      Promise.resolve(result(request, next));
    await controller.reload();
    expect(controller.getSnapshot().snapshot).toEqual(value);
    expect(controller.getSnapshot().error).not.toBeNull();
  }
  transport.readDocument = () => Promise.reject(new Error("secret path"));
  await controller.reload();
  expect(controller.getSnapshot().error).not.toContain("secret");
  const request: DocumentRequest = { protocolVersion: 1, requestId: "test" };
  expect(isDocumentResponse(result(request, value), "wrong")).toBe(false);
  expect(
    isDocumentResponse(result(request, { ...value, byteLength: 0 }), "test")
  ).toBe(false);
  expect(
    isDocumentResponse({ ...request, ok: false, error: "toString" }, "test")
  ).toBe(false);
});

test("standalone list accumulates lightweight leaves, switches by handle and deduplicates canonical location", async () => {
  const { controller, transport, value, released } = setup();
  value.locationId = crypto.randomUUID();
  await controller.select();
  const second = {
    ...snapshot("second"),
    locationId: crypto.randomUUID(),
    fileName: "other.markdown",
  };
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, second));
  await controller.select();
  expect(controller.getSnapshot().entries).toHaveLength(2);
  expect(controller.getSnapshot().entries[0]).not.toHaveProperty("text");
  expect(released).toEqual([]);
  transport.readDocument = (request) => Promise.resolve(result(request, value));
  await controller.activate(controller.getSnapshot().entries[0]);
  expect(controller.getSnapshot().snapshot).toEqual(value);
  const replaced = { ...snapshot("replaced"), locationId: value.locationId };
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, replaced));
  await controller.select();
  expect(controller.getSnapshot().entries).toHaveLength(2);
  expect(controller.getSnapshot().entries[0]?.handle).toBe(replaced.handle);
  await controller.clear();
  expect(controller.getSnapshot().entries).toEqual([]);
  expect(released).toEqual([value.handle, replaced.handle, second.handle]);
});

test("tabs retain stale markers independently and repeated close/reopen releases scroll state", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  const second = snapshot("second");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, second));
  await controller.select();
  transport.readDocument = (request) =>
    Promise.resolve({ ...request, ok: false, error: "READ_FAILED" });
  await controller.reload();
  expect(controller.getSnapshot().stale).toBe(true);
  controller.activateTab(value.documentId);
  expect(controller.getSnapshot().stale).toBe(false);
  controller.activateTab(second.documentId);
  expect(controller.getSnapshot().stale).toBe(true);
  await controller.closeActive();
  expect(controller.getSnapshot().snapshot?.documentId).toBe(value.documentId);
  expect(controller.getSnapshot().stale).toBe(false);
  let reads = 0;
  transport.readDocument = (request) => {
    reads++;
    return Promise.resolve(result(request, second));
  };
  for (let i = 0; i < 20; i++) {
    await controller.activate(controller.getSnapshot().entries[1]);
    expect(controller.getSnapshot().tabs).toHaveLength(2);
    controller.setScrollPosition(second.documentId, 50);
    await controller.closeActive();
    expect(controller.getSnapshot().tabs).toHaveLength(1);
    expect(controller.getScrollPosition(second.documentId)).toBe(0);
    expect(controller.getSnapshot().entries).toHaveLength(2);
  }
  expect(reads).toBe(20);
});

test("failed or cancelled addition never changes standalone leaves", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  const entries = controller.getSnapshot().entries;
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, null));
  await controller.select();
  expect(controller.getSnapshot().entries).toBe(entries);
  transport.selectDocument = (request) =>
    Promise.resolve({ ...request, ok: false, error: "TOO_LARGE" });
  await controller.select();
  expect(controller.getSnapshot().entries).toBe(entries);
  expect(controller.getSnapshot().snapshot).toBe(value);
});

test("fidelity follows selection, activation and reload atomically; malformed facts keep the old snapshot", async () => {
  const { controller, transport } = setup();
  const first = snapshot("\ufeffA\r\n");
  const second = snapshot("B\n\r");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, first));
  await controller.select();
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, second));
  await controller.select();
  expect(controller.getSnapshot().snapshot?.fidelity).toEqual(
    analyzeTextFidelity(second.text)
  );
  transport.readDocument = (request) => Promise.resolve(result(request, first));
  await controller.activate(controller.getSnapshot().entries[0]);
  expect(controller.getSnapshot().snapshot?.fidelity).toEqual(
    analyzeTextFidelity(first.text)
  );
  const changed = {
    ...first,
    text: "A\n",
    byteLength: 2,
    hash: "b".repeat(64),
    revision: 2,
    fidelity: analyzeTextFidelity("A\n"),
  };
  transport.readDocument = (request) =>
    Promise.resolve(result(request, changed));
  await controller.reload();
  expect(controller.getSnapshot().snapshot).toEqual(changed);
  transport.readDocument = (request) =>
    Promise.resolve(
      result(request, { ...changed, fidelity: analyzeTextFidelity("plain") })
    );
  await controller.reload();
  expect(controller.getSnapshot().snapshot).toBe(changed);
  expect(controller.getSnapshot().stale).toBe(true);
  transport.selectDocument = (request) =>
    Promise.resolve({ ...request, ok: false, error: "INVALID_UTF8" });
  await controller.select();
  expect(controller.getSnapshot().error).toContain("外部工具");
  expect(controller.getSnapshot().snapshot).toBe(changed);
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, null));
  await controller.select();
  expect(controller.getSnapshot().snapshot).toBe(changed);
  expect(controller.getSnapshot().entries).toHaveLength(2);
});
