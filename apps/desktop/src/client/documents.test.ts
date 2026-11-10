import { expect, test } from "bun:test";

import { CompletionContext } from "@codemirror/autocomplete";
import { undo, undoDepth } from "@codemirror/commands";
import {
  foldedRanges,
  ensureSyntaxTree,
  syntaxTreeAvailable,
  unfoldEffect,
  foldEffect,
} from "@codemirror/language";
import { Transaction, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import type {
  DocumentRequest,
  DocumentResponse,
  DocumentSnapshot,
} from "../shared/documents";
import { READER_SNAPSHOT_MAX_BYTES } from "../shared/reader-snapshot";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { documentCapabilitySuffix } from "./document-status-label";
import {
  createDocumentController,
  CLEAN_PRIMARY_TAB_CAPTURE_LIMIT,
  isDocumentResponse,
  type DocumentTransport,
} from "./documents";
import { createEditingImagePool } from "./editing-image-pool";
import { editingImageField, editingImagesEffect } from "./editing-images";
import { reportEditorFault } from "./editor-fault";
import { currentTypedFold, editorFoldEntries } from "./editor-fold-state";
import { prepareEditorViewState } from "./editor-view-sync";
import {
  EmojiCompletionSession,
  registerEmojiCompletion,
} from "./emoji-completion";
import { names, version } from "./emoji-completion-index";
import {
  currentFoldAtSelection,
  currentFoldTarget,
  headingStructureReady,
  headingToggleTransaction,
  codeToggleTransaction,
} from "./heading-folding";
import { headingStructureSteps } from "./heading-structure";
import { summarizeImages } from "./image-summary";
import { rawText } from "./raw-buffer";

test("Emoji completion uses actual controller dirty/history and refuses stale readonly apply", async () => {
  for (const readonly of [false, true]) {
    const { controller, value } = setup();
    value.text = "\uFEFFfirst\r\n:smi\r\nend";
    value.byteLength = new TextEncoder().encode(value.text).length;
    value.fidelity = analyzeTextFidelity(value.text);
    if (readonly)
      value.writeCapability = { writable: false, reason: "readonly" };
    await controller.select();
    prepareEditorViewState(controller, value.documentId);
    let state = controller.getEditor(value.documentId)!.state;
    ensureSyntaxTree(state, state.doc.length, 1000);
    controller.updateEditor(
      value.documentId,
      state.update({
        selection: { anchor: state.doc.toString().indexOf(":smi") + 4 },
      })
    );
    const view = {
      get state() {
        return controller.getEditor(value.documentId)!.state;
      },
      compositionStarted: false,
      composing: false,
      dispatch(spec: TransactionSpec | Transaction) {
        const tr =
          spec instanceof Transaction
            ? spec
            : controller.getEditor(value.documentId)!.state.update(spec);
        controller.updateEditor(value.documentId, tr);
      },
    } as unknown as EditorView;
    const session = new EmojiCompletionSession(view, () =>
      Promise.resolve({
        names,
        version,
      })
    );
    const remove = registerEmojiCompletion(
      view,
      () =>
        controller.canWrite(value.documentId) &&
        !controller.getSnapshot().frozen
    );
    try {
      state = view.state;
      expect(state.readOnly).toBe(readonly);
      const result = await session.query(
        new CompletionContext(state, state.selection.main.head, false, view)
      );
      if (readonly) {
        expect(result).toBeNull();
        expect(controller.isDirty(value.documentId)).toBe(false);
        continue;
      }
      const completion = result!.options.find((c) => c.label === ":smile:")!;
      if (typeof completion.apply !== "function")
        throw new Error("Expected guarded apply");
      completion.apply(view, completion, result!.from, result!.to!);
      expect(controller.isDirty(value.documentId)).toBe(true);
      expect(view.state.field(rawText)).toBe(
        value.text.replace(":smi", ":smile:")
      );
      expect(undo(view)).toBe(true);
      expect(view.state.field(rawText)).toBe(value.text);
      expect(controller.isDirty(value.documentId)).toBe(false);
      controller.beginDiscard();
      const before = view.state;
      completion.apply(view, completion, result!.from, result!.to!);
      expect(view.state).toBe(before);
      controller.endDiscard();
    } finally {
      remove();
      session.destroy();
    }
  }
});

test("safe source preserves dirty revision and transfer, waits for interaction, and stays isolated on reload", async () => {
  const { controller, value } = setup();
  await controller.select();
  let editor = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    editor.state.update({ changes: { from: 0, insert: "未保存" } })
  );
  editor = controller.getEditor(value.documentId)!;
  const transfer = controller.getSaveTransfer(value.documentId);
  const session = controller.getEditorFault(value.documentId)!;
  reportEditorFault(session, "presentation");
  controller.setInteractionCheck(() => false);
  expect(controller.enterSafeSource(value.documentId, session)).toBe(false);
  controller.setInteractionCheck(() => true);
  controller.beginDiscard();
  expect(controller.enterSafeSource(value.documentId, session)).toBe(false);
  controller.endDiscard();
  expect(controller.enterSafeSource(value.documentId, session)).toBe(true);
  expect(controller.isSafeSource(value.documentId)).toBe(true);
  expect(controller.canToggleSourceMode()).toBe(false);
  expect(controller.getEditor(value.documentId)!.revision).toBe(
    editor.revision
  );
  expect(controller.getEditor(value.documentId)!.state.field(rawText)).toBe(
    editor.state.field(rawText)
  );
  expect(controller.getSaveTransfer(value.documentId)).toBe(transfer);
  expect(controller.isDirty(value.documentId)).toBe(true);
  expect(controller.runHistory("undo")).toBe(true);
  expect(controller.getEditor(value.documentId)!.state.field(rawText)).toBe(
    value.text
  );
  await controller.reload();
  expect(controller.isSafeSource(value.documentId)).toBe(true);
  expect(controller.toggleSourceMode()).toBe(false);
  expect(controller.enterSafeSource(value.documentId, session)).toBe(false);
});

test("parser injection preserves current text and safe source respects read-only", async () => {
  const { controller, value } = setup();
  value.writeCapability = { writable: false, reason: "readonly" };
  await controller.select();
  expect(controller.injectEditorFault("parser")).toBe(true);
  const fault = controller.getEditorFault(value.documentId)!;
  expect(fault.fault).toBe("parser");
  expect(controller.enterSafeSource(value.documentId, fault)).toBe(true);
  const editor = controller.getEditor(value.documentId)!;
  expect(
    controller.updateEditor(
      value.documentId,
      editor.state.update({ changes: { from: 0, insert: "x" } })
    )
  ).toBe(false);
  expect(editor.state.field(rawText)).toBe(value.text);
  expect(controller.isDirty(value.documentId)).toBe(false);
});

test("safe source preserves available scroll but a broken geometry capture cannot prevent recovery", async () => {
  for (const broken of [false, true]) {
    const { controller, value } = setup();
    await controller.select();
    const scroll = EditorView.scrollIntoView(3);
    let sawScroll = false;
    controller.setScrollCapture(() => {
      if (broken) throw new Error("private geometry error");
      return scroll;
    });
    controller.setHistoryDispatch((transaction) => {
      sawScroll = transaction.effects.includes(scroll);
      controller.updateEditor(value.documentId, transaction);
    });
    const session = controller.getEditorFault(value.documentId)!;
    reportEditorFault(session, "presentation");
    expect(controller.enterSafeSource(value.documentId, session)).toBe(true);
    expect(sawScroll).toBe(!broken);
    expect(session.recoveryFailed).toBe(false);
    expect(controller.getEditor(value.documentId)!.state.field(rawText)).toBe(
      value.text
    );
  }
});

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
    writeCapability: { writable: true, reason: "writable" },
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
function setup(confirmDiscard?: (message: string) => Promise<boolean>) {
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
    controller: createDocumentController(transport, confirmDiscard),
  };
}

test("inactive controller slots release image widgets while retaining text history selection and folds", async () => {
  const { controller, transport, value: first } = setup();
  const raw = "before\n\n![a](a.png)\n\n# Heading\nbody\nend";
  first.text = raw; first.byteLength = Buffer.byteLength(raw); first.fidelity = analyzeTextFidelity(raw);
  const second = snapshot("second");
  const pool = createEditingImagePool(first.handle, () => Promise.resolve(null));
  try {
    await controller.select();
    let editor = controller.getEditor(first.documentId)!;
    controller.updateEditor(first.documentId, editor.state.update({ changes: { from: raw.length, insert: " draft" } }));
    editor = controller.getEditor(first.documentId)!;
    const summary = summarizeImages(editor.state.field(rawText));
    const oldItem = { semantic: summary.images[0], source: summary.sources[0], pool, valid: () => true };
    controller.updateEditor(first.documentId, editor.state.update({
      selection: { anchor: 1 },
      effects: [editingImagesEffect.of({ reset: true, items: [oldItem] }), foldEffect.of({ from: raw.indexOf("body"), to: editor.state.doc.length })],
      annotations: Transaction.addToHistory.of(false),
    }));
    editor = controller.getEditor(first.documentId)!;
    expect(editor.state.field(editingImageField).base.size).toBe(1);
    expect(foldedRanges(editor.state).size).toBe(1);
    const depth = undoDepth(editor.state), revision = editor.revision;
    const late = editor.state.update({ effects: editingImagesEffect.of({ reset: true, items: [oldItem] }) });
    controller.setScrollPosition(first.documentId, 123);
    transport.selectDocument = request => Promise.resolve(result(request, second));
    await controller.select();
    const inactive = controller.getEditor(first.documentId)!;
    expect(inactive.state.field(editingImageField).base.size).toBe(0);
    expect(inactive.state.field(editingImageField).shown.size).toBe(0);
    expect(inactive.state.field(rawText)).toBe(raw + " draft");
    expect(inactive.revision).toBe(revision);
    expect(undoDepth(inactive.state)).toBe(depth);
    expect(inactive.state.selection.main.anchor).toBe(1);
    expect(foldedRanges(inactive.state).size).toBe(1);
    expect(controller.getMode(first.documentId)).toBe("editing");
    expect(controller.getScrollPosition(first.documentId)).toBe(123);
    expect(controller.updateEditor(first.documentId, late)).toBe(false);
    controller.activateTab(first.documentId);
    const active = controller.getEditor(first.documentId)!;
    expect(active.state.field(editingImageField).base.size).toBe(0);
    expect(controller.updateEditor(first.documentId, late)).toBe(false);
    const rebuilt = { ...oldItem, valid: () => true };
    expect(controller.updateEditor(first.documentId, active.state.update({ effects: editingImagesEffect.of({ reset: true, items: [rebuilt] }) }))).toBe(true);
    expect(controller.getEditor(first.documentId)!.state.field(editingImageField).base.size).toBe(1);
    expect(controller.getEditor(second.documentId)!.state.field(editingImageField).base.size).toBe(0);
    expect(controller.runHistory("undo")).toBe(true);
    expect(controller.getEditor(first.documentId)!.state.field(rawText)).toBe(raw);
  } finally { controller.dispose(); pool.dispose(); }
});

test("clean primary capture follows visual order and modes without bodies, and selection stays current", async () => {
  const { controller, transport, value: a } = setup();
  const b = snapshot("B"), c = snapshot("C");
  try {
    const empty = controller.captureCleanPrimaryTabs();
    expect(empty.ok && empty.activeIndex).toBe(null);
    await controller.select();
    for (const tab of [b, c]) {
      transport.selectDocument = request => Promise.resolve(result(request, tab));
      await controller.select();
    }
    controller.activateTab(b.documentId);
    controller.setActiveTabPinned(true);
    controller.toggleSourceMode();
    controller.moveTab(c.documentId, a.documentId, "before");
    const capture = controller.captureCleanPrimaryTabs();
    if (!capture.ok) throw Error(capture.reason);
    expect(capture.tabs).toEqual([b, c, a].map(tab => ({
      handle: tab.handle, documentId: tab.documentId, revision: tab.revision,
      hash: tab.hash, pinned: tab === b, mode: tab === b ? "source" : "editing",
    })));
    expect(capture.activeIndex).toBe(0);
    const editor = controller.getEditor(b.documentId)!;
    controller.updateEditor(b.documentId, editor.state.update({ selection: { anchor: 1 } }));
    expect(capture.current()).toBe(true);
    controller.activateTab(a.documentId);
    controller.activateTab(b.documentId);
    expect(capture.current()).toBe(false);
    const beforeEdit = controller.captureCleanPrimaryTabs();
    if (!beforeEdit.ok) throw Error(beforeEdit.reason);
    const current = controller.getEditor(b.documentId)!;
    controller.updateEditor(b.documentId, current.state.update({ changes: { from: 0, insert: "draft" } }));
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    expect(controller.runHistory("undo")).toBe(true);
    expect(controller.captureCleanPrimaryTabs().ok).toBe(true);
    expect(beforeEdit.current()).toBe(false);
    const beforeClose = controller.captureCleanPrimaryTabs();
    await controller.closeTab(b.documentId);
    expect(beforeClose.ok && beforeClose.current()).toBe(false);
  } finally { controller.dispose(); }
});

test("clean primary capture rejects transient and isolated states while allowing clean filesystem readonly", async () => {
  const { controller, value } = setup();
  value.writeCapability = { writable: false, reason: "readonly" };
  try {
    const loading = controller.select();
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    await loading;
    expect(controller.captureCleanPrimaryTabs().ok).toBe(true);
    const capture = controller.captureCleanPrimaryTabs();
    const restore = controller.setInteractionCheck(() => false);
    expect(capture.ok && capture.current()).toBe(false);
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    restore();
    expect(capture.ok && capture.current()).toBe(false);
    controller.beginDiscard();
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    controller.endDiscard();
    controller.setEditorInputBlocked(true);
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    controller.setEditorInputBlocked(false);
    controller.toggleReadingMode();
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    controller.toggleReadingMode();
    const beforeFault = controller.captureCleanPrimaryTabs();
    expect(beforeFault.ok).toBe(true);
    const fault = controller.getEditorFault(value.documentId)!;
    reportEditorFault(fault, "presentation");
    expect(beforeFault.ok && beforeFault.current()).toBe(false);
    controller.enterSafeSource(value.documentId, fault);
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
  } finally { controller.dispose(); }
});

test("clean primary capture refuses stale baselines and whole over-capacity groups", async () => {
  const { controller, transport } = setup();
  try {
    await controller.select();
    const before = controller.captureCleanPrimaryTabs();
    transport.readDocument = request => Promise.resolve({ ...request, ok: false, error: "FILE_CHANGED" });
    await controller.reload();
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    expect(before.ok && before.current()).toBe(false);
  } finally { controller.dispose(); }
  const many = setup();
  try {
    for (let index = 0; index < CLEAN_PRIMARY_TAB_CAPTURE_LIMIT; index++) {
      const tab = snapshot("x");
      many.transport.selectDocument = request => Promise.resolve(result(request, tab));
      await many.controller.select();
    }
    const exact = many.controller.captureCleanPrimaryTabs();
    expect(exact.ok && exact.tabs.length).toBe(CLEAN_PRIMARY_TAB_CAPTURE_LIMIT);
    const extra = snapshot("y");
    many.transport.selectDocument = request => Promise.resolve(result(request, extra));
    await many.controller.select();
    expect(many.controller.captureCleanPrimaryTabs()).toEqual({ ok: false, reason: "limit" });
    expect(exact.ok && exact.current()).toBe(false);
  } finally { many.controller.dispose(); }
});

test("clean primary capture requires settled usable capability while retaining confirmed readonly", async () => {
  for (const reason of ["invalid", "unavailable"] as const) {
    const { controller, value } = setup();
    value.writeCapability = { writable: false, reason };
    try {
      await controller.select();
      expect(controller.captureCleanPrimaryTabs()).toEqual({ ok: false, reason: "unavailable" });
    } finally { controller.dispose(); }
  }
  const { controller, transport } = setup();
  try {
    await controller.select();
    const pending = deferred<unknown>();
    let request: DocumentRequest & { handle: string };
    transport.checkDocumentWriteCapability = input => { request = input; return pending.promise; };
    const before = controller.captureCleanPrimaryTabs();
    const refresh = controller.refreshWriteCapability();
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
    expect(before.ok && before.current()).toBe(false);
    pending.resolve({ ...request!, capability: { writable: false, reason: "readonly" } });
    await refresh;
    expect(controller.captureCleanPrimaryTabs().ok).toBe(true);
    expect(before.ok && before.current()).toBe(false);
    const unchanged = controller.captureCleanPrimaryTabs();
    transport.checkDocumentWriteCapability = input => Promise.resolve({ ...input, capability: { writable: false, reason: "readonly" } });
    await controller.refreshWriteCapability();
    expect(unchanged.ok && unchanged.current()).toBe(false);
    const readonly = controller.captureCleanPrimaryTabs();
    transport.checkDocumentWriteCapability = input => Promise.resolve({ ...input, capability: { writable: false, reason: "invalid" } });
    await controller.refreshWriteCapability();
    expect(readonly.ok && readonly.current()).toBe(false);
    expect(controller.captureCleanPrimaryTabs().ok).toBe(false);
  } finally { controller.dispose(); }
});

test("independent reading captures exact clean authority and current editing or source buffer bytes", async () => {
  for (const mode of ["editing", "source"] as const) {
    const { controller, transport, value } = setup();
    const original = "\uFEFF# 已保存\r\n第二行\r末行";
    value.text = original;
    value.byteLength = Buffer.byteLength(original);
    value.fidelity = analyzeTextFidelity(original);
    let saves = 0;
    transport.saveDocument = () => { saves++; return Promise.reject(Error("unexpected save")); };
    await controller.select();
    const clean = controller.captureIndependentReadingSnapshot();
    expect(clean?.kind).toBe("saved");
    const savedSource = {
      handle: value.handle, documentId: value.documentId,
      expectedRevision: value.revision, expectedHash: value.hash,
    };
    expect(clean?.request).toEqual(savedSource);
    expect(clean?.request).toEqual(controller.captureReadingSnapshotSource() ?? undefined);
    if (mode === "source") expect(controller.toggleSourceMode()).toBe(true);
    const editor = controller.getEditor(value.documentId)!;
    const appended = " 中文📖 <script>样本</script>";
    const edit = editor.state.update({
      changes: { from: editor.state.doc.length, insert: appended },
      selection: { anchor: 2 },
    });
    expect(controller.updateEditor(value.documentId, edit)).toBe(true);
    const active = controller.getEditor(value.documentId);
    const before = controller.getSnapshot();
    const history = undoDepth(active!.state);
    expect(controller.getIndependentReadingSnapshotKind()).toBe("buffer");
    const capture = controller.captureIndependentReadingSnapshot();
    expect(capture?.kind).toBe("buffer");
    expect(capture?.request).toEqual({
      kind: "buffer", data: Buffer.from(original + appended).toString("base64"),
    });
    expect(capture?.origin.bufferRevision).toBe(active!.revision);
    expect(controller.captureReadingSnapshotSource()).toBeNull();
    expect(controller.getSnapshot()).toBe(before);
    expect(controller.getEditor(value.documentId)).toBe(active);
    expect(undoDepth(active!.state)).toBe(history);
    expect(controller.getMode(value.documentId)).toBe(mode);
    expect(controller.isDirty(value.documentId)).toBe(true);
    expect(saves).toBe(0);
    const image = "\n![图](local.png)";
    expect(controller.updateEditor(value.documentId, active!.state.update({
      changes: { from: active!.state.doc.length, insert: image },
    }))).toBe(true);
    expect(controller.captureIndependentReadingSnapshot()?.request).toEqual({
      kind: "buffer", data: Buffer.from(original + appended + "\r" + image).toString("base64"),
      source: savedSource,
    });
    controller.dispose();
  }
});

test("independent dirty snapshot respects input and lifecycle gates and rejects invalid Unicode", async () => {
  const { controller, value } = setup();
  expect(controller.captureIndependentReadingSnapshot()).toBeUndefined();
  await controller.select();
  const first = controller.getEditor(value.documentId)!.state;
  expect(controller.updateEditor(value.documentId, first.update({ changes: { from: first.doc.length, insert: "未保存" } }))).toBe(true);
  const releaseInteraction = controller.setInteractionCheck(() => false);
  expect(controller.getIndependentReadingSnapshotKind()).toBeUndefined();
  expect(controller.captureIndependentReadingSnapshot()).toBeUndefined();
  releaseInteraction();
  controller.setEditorInputBlocked(true);
  expect(controller.captureIndependentReadingSnapshot()).toBeUndefined();
  controller.setEditorInputBlocked(false);
  expect(controller.beginDiscard()).toBe(true);
  expect(controller.captureIndependentReadingSnapshot()).toBeUndefined();
  controller.endDiscard();
  expect(controller.toggleReadingMode()).toBe(true);
  expect(controller.captureIndependentReadingSnapshot()).toBeUndefined();
  expect(controller.toggleReadingMode()).toBe(true);
  const dirty = controller.getEditor(value.documentId)!.state;
  expect(controller.updateEditor(value.documentId, dirty.update({ changes: { from: dirty.doc.length, insert: "\uD800" } }))).toBe(true);
  expect(controller.captureIndependentReadingSnapshot()).toMatchObject({ kind: "buffer", request: undefined });
  expect(controller.isDirty(value.documentId)).toBe(true);
  reportEditorFault(controller.getEditorFault(value.documentId)!, "presentation");
  expect(controller.captureIndependentReadingSnapshot()).toBeUndefined();
  controller.dispose();
});

test("independent buffer encodes the exact one MiB raw boundary without changing the editor", async () => {
  const { controller, value } = setup();
  await controller.select();
  const editor = controller.getEditor(value.documentId)!;
  const appended = "x".repeat(READER_SNAPSHOT_MAX_BYTES - value.byteLength);
  const changed = editor.state.update({ changes: { from: editor.state.doc.length, insert: appended } });
  expect(controller.updateEditor(value.documentId, changed)).toBe(true);
  const before = controller.getEditor(value.documentId);
  const capture = controller.captureIndependentReadingSnapshot();
  expect(capture?.request).toEqual({ kind: "buffer", data: Buffer.from(value.text + appended).toString("base64") });
  expect(controller.getEditor(value.documentId)).toBe(before);
  controller.dispose();
});

test("group sorting preserves active editor/MRU and reconciles open, refresh, close and replacement", async () => {
  const { controller, transport, value: a } = setup(() => Promise.resolve(true));
  const b = snapshot("B"), c = snapshot("C"), d = snapshot("D"), e = snapshot("E");
  await controller.select();
  const open = async (tab: DocumentSnapshot) => {
    transport.selectDocument = request => Promise.resolve(result(request, tab));
    await controller.select();
  };
  for (const tab of [b, c, d]) await open(tab);
  for (const tab of [b, c]) { controller.activateTab(tab.documentId); controller.setActiveTabPinned(true); }
  controller.activateTab(d.documentId);
  const editor = controller.getEditor(d.documentId)!;
  controller.updateEditor(d.documentId, editor.state.update({ changes: { from: 0, insert: "draft" }, selection: { anchor: 2 } }));
  const edited = controller.getEditor(d.documentId);
  const state = controller.getSnapshot();
  let activations = 0;
  const unsubscribe = controller.subscribeActivation(() => { activations++; });
  const ids = () => controller.getVisualTabs().map(tab => tab.documentId);
  expect(controller.moveActiveTab(-1)).toBe(true);
  expect(ids()).toEqual([b, c, d, a].map(tab => tab.documentId));
  expect(controller.moveActiveTab(-1)).toBe(false);
  expect(controller.moveTab(d.documentId, b.documentId, "before")).toBe(false);
  expect(controller.moveTab(c.documentId, b.documentId, "before")).toBe(true);
  expect(controller.moveTab(c.documentId, b.documentId, "before")).toBe(false);
  expect(controller.getSnapshot().snapshot).toBe(state.snapshot);
  expect(controller.getSnapshot().tabs).toBe(state.tabs);
  expect(controller.getSnapshot().entries).toBe(state.entries);
  expect(controller.getEditor(d.documentId)).toBe(edited);
  expect(activations).toBe(0);
  expect(controller.cycleRecentTabs()).toBe(true);
  expect(controller.getRecentTabCandidate()).toBe(c.documentId);
  expect(controller.moveActiveTab(1)).toBe(false);
  controller.cancelRecentTabSwitch();
  controller.setInteractionCheck(() => false);
  expect(controller.moveTab(b.documentId, c.documentId, "before")).toBe(false);
  controller.setInteractionCheck(() => true);
  unsubscribe();
  await open(e);
  expect(ids()).toEqual([c, b, d, a, e].map(tab => tab.documentId));
  await open({ ...a, handle: crypto.randomUUID() });
  expect(ids()).toEqual([c, b, d, a, e].map(tab => tab.documentId));
  controller.activateTab(b.documentId);
  controller.setActiveTabPinned(false);
  expect(ids()).toEqual([c, d, b, a, e].map(tab => tab.documentId));
  controller.activateTab(d.documentId);
  await controller.closeActive();
  expect(controller.getSnapshot().snapshot?.documentId).toBe(b.documentId);
  expect(ids()).toEqual([c, b, a, e].map(tab => tab.documentId));
  const replacement = { ...snapshot("replacement"), locationId: a.documentId };
  await open(replacement);
  expect(ids()).toEqual([c, b, e, replacement].map(tab => tab.documentId));
  expect(controller.moveTab(a.documentId, e.documentId, "before")).toBe(false);
  controller.dispose();
});

test("cross-group drop publishes only final pin/order and preserves editor, activation and MRU", async () => {
  const { controller, transport, value: a } = setup(() => Promise.resolve(true));
  const b = snapshot("B"), c = snapshot("C"), d = snapshot("D");
  await controller.select();
  for (const tab of [b, c, d]) {
    transport.selectDocument = request => Promise.resolve(result(request, tab));
    await controller.select();
  }
  controller.activateTab(a.documentId); controller.setActiveTabPinned(true);
  controller.activateTab(d.documentId);
  const editor = controller.getEditor(d.documentId)!;
  controller.updateEditor(d.documentId, editor.state.update({ changes: { from: 0, insert: "草稿" }, selection: { anchor: 1 } }));
  const original = controller.getSnapshot(), edited = controller.getEditor(d.documentId);
  const events: { ids: string[]; pinned: boolean }[] = [];
  let activations = 0;
  const stop = controller.subscribe(() => { events.push({ ids: controller.getVisualTabs().map(tab => tab.documentId), pinned: controller.isTabPinned(c.documentId) }); });
  const stopActivation = controller.subscribeActivation(() => { activations++; });
  expect(controller.dropTab(c.documentId, a.documentId, "before")).toBe(true);
  expect(events).toEqual([{ ids: [c, a, b, d].map(tab => tab.documentId), pinned: true }]);
  expect(controller.getSnapshot().snapshot).toBe(original.snapshot);
  expect(controller.getSnapshot().tabs).toBe(original.tabs);
  expect(controller.getEditor(d.documentId)).toBe(edited); expect(activations).toBe(0);
  expect(controller.cycleRecentTabs()).toBe(true); expect(controller.getRecentTabCandidate()).toBe(a.documentId);
  expect(controller.dropTab(c.documentId, b.documentId, "after")).toBe(false);
  controller.cancelRecentTabSwitch();
  expect(controller.dropTab(c.documentId, b.documentId, "after")).toBe(true);
  expect(events[events.length - 1]).toEqual({ ids: [a, b, c, d].map(tab => tab.documentId), pinned: false });
  expect(events).toHaveLength(2);
  expect(controller.dropTab(c.documentId, c.documentId, "before")).toBe(false);
  controller.setInteractionCheck(() => false);
  expect(controller.dropTab(b.documentId, a.documentId, "after")).toBe(false);
  controller.setInteractionCheck(() => true);
  controller.activateTab(b.documentId); await controller.closeActive();
  expect(controller.getSnapshot().snapshot?.documentId).toBe(c.documentId);
  expect(controller.dropTab(c.documentId, b.documentId, "after")).toBe(false);
  const e = snapshot("E"); transport.selectDocument = request => Promise.resolve(result(request, e)); await controller.select();
  expect(controller.getVisualTabs().map(tab => tab.documentId)).toEqual([a, c, d, e].map(tab => tab.documentId));
  stop(); stopActivation(); controller.dispose();
});

test("two-tab cross-group sequence handles both empty groups and last-member migration", async () => {
  const { controller, transport, value: a } = setup(); const b = snapshot("B");
  await controller.select(); transport.selectDocument = request => Promise.resolve(result(request, b)); await controller.select();
  controller.activateTab(a.documentId); controller.setActiveTabPinned(true);
  const active = controller.getSnapshot().snapshot;
  expect(controller.dropTab(b.documentId, a.documentId, "before")).toBe(true);
  expect(controller.canDropTabToEmptyGroup(a.documentId, false)).toBe(true);
  expect(controller.dropTabToEmptyGroup(a.documentId, false)).toBe(true);
  expect(controller.dropTab(b.documentId, a.documentId, "after")).toBe(true);
  expect(controller.canDropTabToEmptyGroup(b.documentId, true)).toBe(true);
  expect(controller.dropTabToEmptyGroup(b.documentId, true)).toBe(true);
  expect(controller.getVisualTabs().map(tab => tab.documentId)).toEqual([b.documentId, a.documentId]);
  expect(controller.isTabPinned(a.documentId)).toBe(false); expect(controller.isTabPinned(b.documentId)).toBe(true);
  expect(controller.getSnapshot().snapshot).toBe(active);
  expect(controller.dropTabToEmptyGroup(a.documentId, true)).toBe(false);
  expect(controller.dropTabToEmptyGroup("missing", false)).toBe(false);
  // Existing keyboard composition can attain the same placement without crossing in the group-move command.
  controller.activateTab(a.documentId); expect(controller.setActiveTabPinned(true)).toBe(true);
  expect(controller.moveActiveTab(-1)).toBe(true);
  expect(controller.getVisualTabs().map(tab => tab.documentId)).toEqual([a.documentId, b.documentId]);
  controller.dispose();
});

test("pinned tabs keep original order and editor state, and explicit close follows the visual order", async () => {
  let discard = false;
  const { controller, transport, value: first, released } = setup(() =>
    Promise.resolve(discard)
  );
  const second = snapshot("B");
  const third = snapshot("C");
  const fourth = snapshot("D");
  await controller.select();
  for (const tab of [second, third, fourth]) {
    transport.selectDocument = request => Promise.resolve(result(request, tab));
    await controller.select();
  }
  controller.activateTab(third.documentId);
  expect(controller.toggleSourceMode()).toBe(true);
  const editor = controller.getEditor(third.documentId)!;
  expect(controller.updateEditor(third.documentId, editor.state.update({
    changes: { from: 0, insert: "未保存" },
    selection: { anchor: 2 },
  }))).toBe(true);
  const edited = controller.getEditor(third.documentId);
  const original = controller.getSnapshot();
  const activation = controller.getContentSearchActivation();
  let activations = 0;
  const stopActivation = controller.subscribeActivation(() => { activations++; });
  expect(controller.canSetActiveTabPinned(true)).toBe(true);
  expect(controller.setActiveTabPinned(true)).toBe(true);
  expect(controller.setActiveTabPinned(true)).toBe(false);
  expect(controller.getSnapshot()).not.toBe(original);
  expect(controller.getSnapshot().tabs).toBe(original.tabs);
  expect(controller.getSnapshot().entries).toBe(original.entries);
  expect(controller.getSnapshot().snapshot).toBe(original.snapshot);
  expect(controller.getEditor(third.documentId)).toBe(edited);
  expect(controller.getContentSearchActivation()).toBe(activation);
  expect(controller.isDirty(third.documentId)).toBe(true);
  expect(activations).toBe(0);
  stopActivation();

  controller.activateTab(second.documentId);
  expect(controller.setActiveTabPinned(true)).toBe(true);
  expect(controller.getVisualTabs().map(tab => tab.documentId)).toEqual(
    [second, third, first, fourth].map(tab => tab.documentId)
  );
  controller.activateTab(third.documentId);
  await controller.closeActive();
  expect(controller.getSnapshot().snapshot?.documentId).toBe(third.documentId);
  expect(controller.isTabPinned(third.documentId)).toBe(true);
  expect(controller.isDirty(third.documentId)).toBe(true);
  discard = true;
  await controller.closeActive();
  expect(controller.getSnapshot().snapshot?.documentId).toBe(first.documentId);
  expect(controller.isTabPinned(third.documentId)).toBe(false);
  expect(controller.getSnapshot().tabs.map(tab => tab.documentId)).toEqual(
    [first, second, fourth].map(tab => tab.documentId)
  );
  expect(released).toEqual([]);

  transport.readDocument = request => Promise.resolve(result(request, third));
  await controller.activate(controller.getSnapshot().entries.find(entry => entry.documentId === third.documentId)!);
  expect(controller.getSnapshot().snapshot?.documentId).toBe(third.documentId);
  expect(controller.isTabPinned(third.documentId)).toBe(false);
  controller.activateTab(second.documentId);
  expect(controller.setActiveTabPinned(false)).toBe(true);
  expect(controller.getVisualTabs()).toBe(controller.getSnapshot().tabs);
  controller.dispose();
});

test("pin gates respect busy, frozen and composing state, and replaced tabs lose their pin", async () => {
  const { controller, transport, value } = setup(() => Promise.resolve(true));
  value.locationId = crypto.randomUUID();
  expect(controller.setActiveTabPinned(true)).toBe(false);
  await controller.select();
  controller.setEditorInputBlocked(true);
  expect(controller.setActiveTabPinned(true)).toBe(false);
  controller.setEditorInputBlocked(false);
  const restoreInteraction = controller.setInteractionCheck(() => false);
  expect(controller.setActiveTabPinned(true)).toBe(false);
  restoreInteraction();
  expect(controller.beginDiscard()).toBe(true);
  expect(controller.setActiveTabPinned(true)).toBe(false);
  controller.endDiscard();
  expect(controller.setActiveTabPinned(true)).toBe(true);
  const replacement = { ...snapshot("replacement"), locationId: value.locationId };
  const receipt = deferred<DocumentResponse>();
  let selectionRequest: DocumentRequest | undefined;
  transport.selectDocument = request => {
    selectionRequest = request;
    return receipt.promise;
  };
  const selection = controller.select();
  expect(controller.getSnapshot().busy).toBe(true);
  expect(controller.setActiveTabPinned(false)).toBe(false);
  receipt.resolve(result(selectionRequest!, replacement));
  await selection;
  expect(controller.getSnapshot().snapshot?.documentId).toBe(replacement.documentId);
  expect(controller.isTabPinned(value.documentId)).toBe(false);
  expect(controller.isTabPinned(replacement.documentId)).toBe(false);
  controller.dispose();
});

test("recent tab preview freezes MRU, wraps through the origin, and activates only on finish", async () => {
  const { controller, transport, value: first } = setup();
  const second = snapshot("B");
  const third = snapshot("C");
  expect(controller.canCycleRecentTabs()).toBe(false);
  await controller.select();
  expect(controller.cycleRecentTabs()).toBe(false);
  for (const tab of [second, third]) {
    transport.selectDocument = request => Promise.resolve(result(request, tab));
    await controller.select();
  }
  expect(controller.setActiveTabPinned(true)).toBe(true);
  controller.activateTab(first.documentId);
  expect(controller.toggleSourceMode()).toBe(true);
  const original = controller.getSnapshot();
  const editor = controller.getEditor(first.documentId);
  const activation = controller.getContentSearchActivation();
  const candidates: (string | null)[] = [];
  const recorded: string[] = [];
  const stopCandidates = controller.subscribeRecentTabCandidate(() => candidates.push(controller.getRecentTabCandidate()));
  const stopActivation = controller.subscribeActivation(item => recorded.push(item.documentId));
  for (const expected of [third, second, first]) {
    expect(controller.cycleRecentTabs()).toBe(true);
    expect(controller.getRecentTabCandidate()).toBe(expected.documentId);
    expect(controller.getSnapshot()).toBe(original);
    expect(controller.getEditor(first.documentId)).toBe(editor);
  }
  expect(controller.getContentSearchActivation()).toBe(activation);
  expect(controller.finishRecentTabSwitch()).toBe(false);
  expect(recorded).toEqual([]);
  for (const expected of [third, first]) {
    expect(controller.cycleRecentTabs()).toBe(true);
    expect(controller.getRecentTabCandidate()).toBe(expected.documentId);
    expect(controller.finishRecentTabSwitch()).toBe(true);
    expect(controller.getSnapshot().snapshot?.documentId).toBe(expected.documentId);
  }
  expect(candidates).toEqual([third.documentId, second.documentId, first.documentId, null, third.documentId, null, first.documentId, null]);
  expect(recorded).toEqual([third.documentId, first.documentId]);
  expect(controller.getSnapshot().tabs).toBe(original.tabs);
  expect(controller.getVisualTabs().map(tab => tab.documentId)).toEqual([third.documentId, first.documentId, second.documentId]);
  stopActivation();
  stopCandidates();
  controller.dispose();
});

test("recent tab completion settles before a candidate subscriber can start another cycle", async () => {
  const { controller, transport, value: first } = setup();
  const second = snapshot("B");
  await controller.select();
  transport.selectDocument = request => Promise.resolve(result(request, second));
  await controller.select();
  expect(controller.cycleRecentTabs()).toBe(true);
  expect(controller.getRecentTabCandidate()).toBe(first.documentId);
  let activeAtClear: string | undefined;
  const stop = controller.subscribeRecentTabCandidate(() => {
    if (controller.getRecentTabCandidate() !== null) return;
    activeAtClear = controller.getSnapshot().snapshot?.documentId;
    controller.cycleRecentTabs();
  });
  expect(controller.finishRecentTabSwitch()).toBe(true);
  expect(activeAtClear).toBe(first.documentId);
  expect(controller.getRecentTabCandidate()).toBe(second.documentId);
  stop();
  controller.dispose();
});

test("recent tab candidate cancels on lifecycle changes and automatic close fallback becomes most recent", async () => {
  const { controller, transport, value: first } = setup();
  const second = snapshot("B");
  const third = snapshot("C");
  const fourth = snapshot("D");
  await controller.select();
  for (const tab of [second, third, fourth]) {
    transport.selectDocument = request => Promise.resolve(result(request, tab));
    await controller.select();
  }
  controller.activateTab(second.documentId);
  controller.activateTab(first.documentId);
  expect(controller.cycleRecentTabs()).toBe(true);
  expect(controller.getRecentTabCandidate()).toBe(second.documentId);
  await controller.closeTab(second.documentId);
  expect(controller.getRecentTabCandidate()).toBeNull();
  expect(controller.finishRecentTabSwitch()).toBe(false);
  expect(controller.cycleRecentTabs()).toBe(true);
  expect(controller.getRecentTabCandidate()).toBe(fourth.documentId);
  controller.cancelRecentTabSwitch();
  expect(controller.finishRecentTabSwitch()).toBe(false);
  expect(controller.cycleRecentTabs()).toBe(true);
  controller.activateTab(third.documentId);
  expect(controller.getRecentTabCandidate()).toBeNull();
  expect(controller.cycleRecentTabs()).toBe(true);
  controller.setEditorInputBlocked(true);
  expect(controller.getRecentTabCandidate()).toBeNull();
  expect(controller.cycleRecentTabs()).toBe(false);
  controller.setEditorInputBlocked(false);
  expect(controller.cycleRecentTabs()).toBe(true);
  expect(controller.beginDiscard()).toBe(true);
  expect(controller.getRecentTabCandidate()).toBeNull();
  expect(controller.finishRecentTabSwitch()).toBe(false);
  controller.endDiscard();

  expect(controller.cycleRecentTabs()).toBe(true);
  const receipt = deferred<DocumentResponse>();
  let readRequest: DocumentRequest | undefined;
  transport.readDocument = request => {
    readRequest = request;
    return receipt.promise;
  };
  const reload = controller.reload();
  expect(controller.getRecentTabCandidate()).toBeNull();
  expect(controller.cycleRecentTabs()).toBe(false);
  receipt.resolve(result(readRequest!, third));
  await reload;

  transport.readDocument = request => Promise.resolve(result(request, second));
  await controller.activate(controller.getSnapshot().entries.find(entry => entry.documentId === second.documentId)!);
  controller.activateTab(first.documentId);
  controller.activateTab(third.documentId);
  await controller.closeActive();
  expect(controller.getSnapshot().snapshot?.documentId).toBe(fourth.documentId);
  controller.activateTab(first.documentId);
  expect(controller.cycleRecentTabs()).toBe(true);
  expect(controller.getRecentTabCandidate()).toBe(fourth.documentId);
  const releaseInteraction = controller.setInteractionCheck(() => false);
  expect(controller.getRecentTabCandidate()).toBeNull();
  expect(controller.finishRecentTabSwitch()).toBe(false);
  releaseInteraction();
  expect(controller.cycleRecentTabs()).toBe(true);
  controller.dispose();
  expect(controller.getRecentTabCandidate()).toBeNull();
});

test("heading fold survives actual controller tab suspension and mode switch without dirtying readonly", async () => {
  const { controller, transport, value } = setup();
  value.text = "# A\nbody\n# B\nlast";
  value.byteLength = new TextEncoder().encode(value.text).length;
  value.fidelity = analyzeTextFidelity(value.text);
  value.writeCapability = { writable: false, reason: "readonly" };
  await controller.select();
  let editor = controller.getEditor(value.documentId)!;
  const task = headingStructureSteps(editor.state);
  let next = task.next();
  while (!next.done) next = task.next();
  expect(
    controller.updateEditor(
      value.documentId,
      editor.state.update({ effects: headingStructureReady.of(next.value) })
    )
  ).toBe(true);
  editor = controller.getEditor(value.documentId)!;
  expect(
    controller.updateEditor(
      value.documentId,
      headingToggleTransaction(editor.state, next.value.sections[0])!
    )
  ).toBe(true);
  const revision = controller.getEditor(value.documentId)!.revision;
  const second = snapshot("# second\nother");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, second));
  await controller.select();
  controller.activateTab(value.documentId);
  editor = controller.getEditor(value.documentId)!;
  expect(foldedRanges(editor.state).size).toBe(1);
  expect(controller.toggleSourceMode()).toBe(true);
  expect(foldedRanges(controller.getEditor(value.documentId)!.state).size).toBe(
    1
  );
  expect(controller.isDirty(value.documentId)).toBe(false);
  expect(controller.getEditor(value.documentId)!.revision).toBe(revision);
  expect(controller.getEditor(value.documentId)!.state.field(rawText)).toBe(
    value.text
  );
  const fault = controller.getEditorFault(value.documentId)!;
  reportEditorFault(fault, "presentation");
  expect(controller.enterSafeSource(value.documentId, fault)).toBe(true);
  expect(foldedRanges(controller.getEditor(value.documentId)!.state).size).toBe(
    0
  );
  controller.dispose();
});

for (const title of ["# A\n", "first title line\nsecond title line\n===\n"])
  test(`existing long tail fold can unfold after partial controller restore: ${JSON.stringify(title)}`, async () => {
    const { controller, transport, value } = setup();
    value.text = title + "paragraph text\n\n".repeat(3000);
    value.byteLength = new TextEncoder().encode(value.text).length;
    value.fidelity = analyzeTextFidelity(value.text);
    await controller.select();
    let editor = controller.getEditor(value.documentId)!;
    // Test-only simulate an already fully parsed state, never a production force.
    expect(
      ensureSyntaxTree(editor.state, editor.state.doc.length, 1000)
    ).not.toBeNull();
    // Publish the test-only advanced parse context into the actual editor state.
    controller.updateEditor(value.documentId, editor.state.update({}));
    editor = controller.getEditor(value.documentId)!;
    const task = headingStructureSteps(editor.state);
    let next = task.next();
    while (!next.done) next = task.next();
    expect(next.value.sections).toHaveLength(1);
    controller.updateEditor(
      value.documentId,
      editor.state.update({ effects: headingStructureReady.of(next.value) })
    );
    editor = controller.getEditor(value.documentId)!;
    controller.updateEditor(
      value.documentId,
      headingToggleTransaction(editor.state, next.value.sections[0])!
    );
    const stamp = {
      doc: editor.state.doc,
      from: next.value.sections[0].from,
      to: next.value.sections[0].to,
    };
    const second = snapshot("other");
    transport.selectDocument = (request) =>
      Promise.resolve(result(request, second));
    await controller.select();
    controller.activateTab(value.documentId);
    editor = controller.getEditor(value.documentId)!;
    expect(syntaxTreeAvailable(editor.state, editor.state.doc.length)).toBe(
      false
    );
    expect(foldedRanges(editor.state).size).toBe(1);
    const target = currentFoldTarget(editor.state, stamp);
    expect(target).toBeDefined();
    expect(editor.state.selection.main.head).toBe(0);
    expect(currentFoldAtSelection(editor.state)).toEqual(target);
    if (title.startsWith("first")) {
      controller.updateEditor(
        value.documentId,
        editor.state.update({ selection: { anchor: 20 } })
      );
      editor = controller.getEditor(value.documentId)!;
      expect(currentFoldAtSelection(editor.state)).toEqual(target);
    }
    expect(
      controller.updateEditor(
        value.documentId,
        editor.state.update({ effects: unfoldEffect.of(target!) })
      )
    ).toBe(true);
    expect(
      foldedRanges(controller.getEditor(value.documentId)!.state).size
    ).toBe(0);
    expect(controller.isDirty(value.documentId)).toBe(false);
    controller.dispose();
  });

test("typed code and heading survive actual readonly controller tabs, partial return and source presentation", async () => {
  const { controller, transport, value } = setup();
  value.text = "# A\n```ts\n" + "code line\n".repeat(3000) + "```\n# B\nend";
  value.byteLength = new TextEncoder().encode(value.text).length;
  value.fidelity = analyzeTextFidelity(value.text);
  value.writeCapability = { writable: false, reason: "readonly" };
  await controller.select();
  let editor = controller.getEditor(value.documentId)!;
  expect(
    ensureSyntaxTree(editor.state, editor.state.doc.length, 1000)
  ).not.toBeNull();
  controller.updateEditor(value.documentId, editor.state.update({}));
  editor = controller.getEditor(value.documentId)!;
  const task = headingStructureSteps(editor.state);
  let next = task.next();
  while (!next.done) next = task.next();
  expect(next.value.code).toHaveLength(1);
  controller.updateEditor(
    value.documentId,
    editor.state.update({ effects: headingStructureReady.of(next.value) })
  );
  editor = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    codeToggleTransaction(editor.state, next.value.code[0])!
  );
  editor = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    headingToggleTransaction(editor.state, next.value.sections[0])!
  );
  editor = controller.getEditor(value.documentId)!;
  const before = editor.revision,
    history = undoDepth(editor.state);
  const code = next.value.code[0],
    stamp = {
      doc: editor.state.doc,
      kind: "fencedCode" as const,
      from: code.from,
      to: code.to,
    };
  const second = snapshot("other");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, second));
  await controller.select();
  controller.activateTab(value.documentId);
  editor = controller.getEditor(value.documentId)!;
  expect(syntaxTreeAvailable(editor.state, editor.state.doc.length)).toBe(
    false
  );
  expect(foldedRanges(editor.state).size).toBe(2);
  expect(editor.state.field(editorFoldEntries).size).toBe(2);
  expect(currentTypedFold(editor.state, stamp)).toBeDefined();
  expect(controller.toggleSourceMode()).toBe(true);
  editor = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    headingToggleTransaction(editor.state, next.value.sections[0])!
  );
  editor = controller.getEditor(value.documentId)!;
  expect(foldedRanges(editor.state).size).toBe(1);
  controller.updateEditor(
    value.documentId,
    codeToggleTransaction(editor.state, code)!
  );
  editor = controller.getEditor(value.documentId)!;
  expect(foldedRanges(editor.state).size).toBe(0);
  expect(editor.state.field(editorFoldEntries).size).toBe(0);
  expect(editor.revision).toBe(before);
  expect(undoDepth(editor.state)).toBe(history);
  expect(editor.state.field(rawText)).toBe(value.text);
  expect(controller.isDirty(value.documentId)).toBe(false);
  controller.dispose();
});

test("folder open reuses dirty mode and history and honors composition", async () => {
  const { controller, transport, value } = setup();
  let opens = 0;
  transport.openWorkspaceDocument = (request) => {
    opens++;
    return Promise.resolve(result(request, value));
  };
  await controller.select();
  const editor = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    editor.state.update({ changes: { from: 0, insert: "dirty" } })
  );
  controller.toggleReadingMode();
  const before = controller.getEditor(value.documentId);
  await controller.openWorkspaceEntry("root", "entry");
  expect(controller.getEditor(value.documentId)).toBe(before);
  expect(controller.getMode(value.documentId)).toBe("reading");
  expect(controller.isDirty(value.documentId)).toBe(true);
  expect(controller.getSnapshot().tabs).toHaveLength(1);
  controller.setInteractionCheck(() => false);
  expect(controller.canSelectFolder()).toBe(false);
  await controller.openWorkspaceEntry("root", "entry");
  expect(opens).toBe(1);
});
test("backend standalone provenance follows replacement handles without replacing dirty editor", async () => {
  const { controller, transport, value, released } = setup();
  let explicit = false;
  const reply = (request: DocumentRequest) =>
    Promise.resolve(
      result(request, {
        ...value,
        handle: crypto.randomUUID(),
        explicitStandalone: explicit,
      })
    );
  transport.openWorkspaceDocument = reply;
  transport.selectDocument = (request) => {
    explicit = true;
    return reply(request);
  };
  await controller.openWorkspaceEntry("root", "entry");
  expect(controller.getSnapshot().entries[0].explicitStandalone).toBe(false);
  const firstHandle = controller.getSnapshot().entries[0].handle;
  let editor = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    editor.state.update({ changes: { from: 0, insert: "dirty" } })
  );
  controller.toggleReadingMode();
  editor = controller.getEditor(value.documentId)!;
  await controller.select();
  expect(controller.getSnapshot().entries[0].explicitStandalone).toBe(true);
  expect(controller.getSnapshot().entries[0].handle).not.toBe(firstHandle);
  expect(released).toContain(firstHandle);
  await controller.openWorkspaceEntry("root", "entry");
  expect(controller.getSnapshot().entries[0].explicitStandalone).toBe(true);
  expect(controller.getEditor(value.documentId)).toBe(editor);
  expect(controller.getMode(value.documentId)).toBe("reading");
  expect(controller.isDirty(value.documentId)).toBe(true);
  expect(undoDepth(editor.state)).toBeGreaterThan(0);
});

test("root clear runs only after discard approval and failed root clear preserves documents", async () => {
  const { transport, value } = setup();
  let approved = false,
    clears = 0;
  const controller = createDocumentController(transport, () =>
    Promise.resolve(approved)
  );
  await controller.select();
  const editor = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    editor.state.update({ changes: { from: 0, insert: "dirty" } })
  );
  await controller.clear(() => {
    clears++;
    return Promise.resolve();
  });
  expect(clears).toBe(0);
  expect(controller.isDirty(value.documentId)).toBe(true);
  approved = true;
  await controller.clear(() => Promise.reject(new Error("unavailable")));
  expect(controller.getSnapshot().tabs).toHaveLength(1);
  expect(controller.getSnapshot().frozen).toBe(false);
  await controller.clear(() => {
    clears++;
    return Promise.resolve();
  });
  expect(clears).toBe(1);
  expect(controller.getSnapshot().tabs).toHaveLength(0);
});

test("inactive reading tab distinguishes pending capability refresh from confirmed readonly", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  controller.toggleReadingMode();
  const other = snapshot("# another");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, other));
  await controller.select();
  let finish!: () => void;
  transport.checkDocumentWriteCapability = (request) =>
    new Promise((resolve) => {
      finish = () =>
        resolve({
          ...request,
          capability: { writable: true, reason: "writable" },
        });
    });
  const pending = controller.refreshWriteCapability(value.handle, true);
  try {
    const tab = controller
      .getSnapshot()
      .tabs.find((tab) => tab.documentId === value.documentId)!;
    const entry = controller
      .getSnapshot()
      .entries.find((entry) => entry.documentId === value.documentId)!;
    expect(tab.writeCapability).toEqual({
      writable: false,
      reason: "unavailable",
    });
    expect(controller.getMode(value.documentId)).toBe("reading");
    expect(controller.canWrite(value.documentId)).toBe(false);
    expect(documentCapabilitySuffix(tab.writeCapability)).toBe(" · 权限确认中");
    expect(documentCapabilitySuffix(entry.writeCapability)).toBe(
      " · 权限确认中"
    );
  } finally {
    finish();
    await pending;
  }
  expect(controller.canWrite(value.documentId)).toBe(true);
  expect(
    documentCapabilitySuffix(
      controller
        .getSnapshot()
        .tabs.find((tab) => tab.documentId === value.documentId)!
        .writeCapability
    )
  ).toBe("");
  controller.dispose();
});

test("reading is per document, source returns to prior mode and preserves selection/history/dirty", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  const edit = controller.getEditor(value.documentId)!.state.update({
    changes: { from: 0, insert: "未保存\n" },
    selection: { anchor: 2, head: 4 },
  });
  controller.updateEditor(value.documentId, edit);
  const before = controller.getEditor(value.documentId)!;
  expect(controller.toggleReadingMode()).toBe(true);
  expect(controller.getMode(value.documentId)).toBe("reading");
  expect(controller.getEditor(value.documentId)).toBe(before);
  expect(controller.isDirty(value.documentId)).toBe(true);
  expect(controller.canUndo()).toBe(false);
  expect(controller.runHistory("undo")).toBe(false);
  expect(
    controller.updateEditor(
      value.documentId,
      before.state.update({ changes: { from: 0, insert: "forbidden" } })
    )
  ).toBe(false);
  expect(controller.toggleSourceMode()).toBe(true);
  expect(controller.getMode(value.documentId)).toBe("source");
  expect(controller.canToggleReadingMode()).toBe(false);
  expect(controller.toggleSourceMode()).toBe(true);
  expect(controller.getMode(value.documentId)).toBe("reading");
  expect(controller.getEditor(value.documentId)!.state.selection).toEqual(
    before.state.selection
  );
  const second = snapshot("# B");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, second));
  await controller.select();
  expect(controller.getMode(second.documentId)).toBe("editing");
  controller.activateTab(value.documentId);
  expect(controller.getMode(value.documentId)).toBe("reading");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, value));
  await controller.select();
  expect(controller.getMode(value.documentId)).toBe("reading");
  expect(controller.getSnapshot().tabs.length).toBe(2);
  expect(controller.toggleReadingMode()).toBe(true);
  expect(controller.getMode(value.documentId)).toBe("editing");
  expect(controller.runHistory("undo")).toBe(true);
  expect(controller.getEditor(value.documentId)!.state.field(rawText)).toBe(
    value.text
  );
  controller.dispose();
});

test("mode transitions respect IME, frozen state and safe source isolation", async () => {
  const { controller, value } = setup();
  expect(controller.toggleReadingMode()).toBe(false);
  await controller.select();
  controller.setInteractionCheck(() => false);
  expect(controller.toggleReadingMode()).toBe(false);
  expect(controller.toggleSourceMode()).toBe(false);
  controller.setInteractionCheck(() => true);
  controller.beginDiscard();
  expect(controller.toggleReadingMode()).toBe(false);
  controller.endDiscard();
  const fault = controller.getEditorFault(value.documentId)!;
  reportEditorFault(fault, "presentation");
  expect(controller.toggleReadingMode()).toBe(false);
  controller.enterSafeSource(value.documentId, fault);
  expect(controller.getMode(value.documentId)).toBe("source");
  expect(controller.toggleReadingMode()).toBe(false);
  expect(controller.toggleSourceMode()).toBe(false);
  controller.dispose();
});

test("source mode is per-document and cannot mutate raw, revision, save transfer or dirty state", async () => {
  const { controller, transport, value } = setup();
  expect(controller.canToggleSourceMode()).toBe(false);
  await controller.select();
  const before = controller.getEditor(value.documentId)!;
  const transfer = controller.getSaveTransfer(value.documentId);
  expect(controller.toggleSourceMode()).toBe(true);
  expect(controller.getMode(value.documentId)).toBe("source");
  expect(controller.getEditor(value.documentId)!.revision).toBe(
    before.revision
  );
  expect(controller.getEditor(value.documentId)!.state.doc).toBe(
    before.state.doc
  );
  expect(controller.getSaveTransfer(value.documentId)).toBe(transfer);
  expect(controller.getSaveStatus(value.documentId).status).toBe("saved");
  const second = snapshot("second");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, second));
  await controller.select();
  expect(controller.getMode(second.documentId)).toBe("editing");
  controller.activateTab(value.documentId);
  expect(controller.getMode(value.documentId)).toBe("source");
  controller.setInteractionCheck(() => false);
  expect(controller.toggleSourceMode()).toBe(false);
  controller.setInteractionCheck(() => true);
  controller.beginDiscard();
  expect(controller.toggleSourceMode()).toBe(false);
  controller.endDiscard();
  expect(controller.toggleSourceMode()).toBe(true);
  expect(controller.getMode(value.documentId)).toBe("editing");
});

test("read-only documents can switch presentation but reject source edits", async () => {
  const { controller, value } = setup();
  value.writeCapability = { writable: false, reason: "readonly" };
  await controller.select();
  expect(controller.toggleSourceMode()).toBe(true);
  const editor = controller.getEditor(value.documentId)!;
  expect(
    controller.updateEditor(
      value.documentId,
      editor.state.update({ changes: { from: 0, insert: "x" } })
    )
  ).toBe(false);
  expect(controller.getEditor(value.documentId)!.state.field(rawText)).toBe(
    value.text
  );
});

for (const raw of [
  "==readonly==\r\n\r\nend",
  "^read\\ only^ ~text~\r\n\r\nend",
  ":smile: :+1:\r\n\r\nend",
])
  test("dialect readonly controller rejects edits and preserves raw/history in both modes", async () => {
    const { controller, value } = setup();
    value.text = raw;
    value.byteLength = new TextEncoder().encode(value.text).length;
    value.fidelity = analyzeTextFidelity(value.text);
    value.writeCapability = { writable: false, reason: "readonly" };
    await controller.select();
    for (let mode = 0; mode < 2; mode++) {
      expect(
        prepareEditorViewState(controller, value.documentId)
      ).toBeDefined();
      const before = controller.getEditor(value.documentId)!.state;
      expect(before.readOnly).toBe(true);
      expect(before.facet(EditorView.editable)).toBe(false);
      const depth = undoDepth(before);
      expect(
        controller.updateEditor(
          value.documentId,
          before.update({ changes: { from: 3, insert: "X" } })
        )
      ).toBe(false);
      const after = controller.getEditor(value.documentId)!.state;
      expect(after).toBe(before);
      expect(after.field(rawText)).toBe(value.text);
      expect(undoDepth(after)).toBe(depth);
      expect(controller.isDirty(value.documentId)).toBe(false);
      if (mode === 0) expect(controller.toggleSourceMode()).toBe(true);
    }
  });
test("mode dispatch keeps the current view and scroll effect, and reload retains document mode", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  const scroll = EditorView.scrollIntoView(2, { y: "start" });
  controller.setScrollCapture(() => scroll);
  let dispatched = 0;
  controller.setHistoryDispatch((transaction) => {
    expect(transaction.effects).toContain(scroll);
    expect(transaction.docChanged).toBe(false);
    dispatched++;
    controller.updateEditor(value.documentId, transaction);
  });
  expect(controller.toggleSourceMode()).toBe(true);
  expect(dispatched).toBe(1);
  const pending = deferred<DocumentResponse>();
  transport.readDocument = (request) => {
    void Promise.resolve().then(() => pending.resolve(result(request, value)));
    return pending.promise;
  };
  const reload = controller.reload();
  expect(controller.canToggleSourceMode()).toBe(false);
  expect(controller.toggleSourceMode()).toBe(false);
  await reload;
  expect(controller.getMode(value.documentId)).toBe("source");
});

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
  expect(controller.getEditor(value.documentId)!.state.doc).toBe(
    edit.state.doc
  );
  expect(controller.getEditor(value.documentId)!.state.selection).toBe(
    edit.state.selection
  );
  transport.selectDocument = (req) => Promise.resolve(result(req, value));
  await controller.select();
  expect(controller.getEditor(value.documentId)!.state.doc).toBe(
    edit.state.doc
  );
  expect(
    controller.getEditor(value.documentId)!.state.selection.main.anchor
  ).toBe(2);
  undo({
    state: controller.getEditor(value.documentId)!.state,
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
  expect(restored.doc).toBe(selected.state.doc);
  expect(restored.selection).toBe(selected.state.selection);
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
  const confirmations: string[] = [];
  const { controller, transport, value, released } = setup((message) => {
    confirmations.push(message);
    return Promise.resolve(true);
  });
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
  expect(confirmations).toHaveLength(1);
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

test("viewport ownership selects active document while inactive cleanup cannot release another view", async () => {
  const { controller, transport, value: a } = setup();
  const b = snapshot("viewport-b");
  await controller.select();
  const calls: string[] = [];
  const collect = (id: string, offset: number) => () => {
    calls.push(id);
    return { from: 0, offset, ratio: 0.5, revision: controller.getEditor(id)!.revision };
  };
  const firstA = controller.registerViewportCapture(a.documentId, collect(a.documentId, -10));
  transport.selectDocument = request => Promise.resolve(result(request, b));
  await controller.select();
  const firstB = controller.registerViewportCapture(b.documentId, collect(b.documentId, -20));
  calls.length = 0;
  controller.captureCurrentViewport();
  expect(calls).toEqual([b.documentId]);
  firstA.capture(); // explicit cleanup may capture its own still-live inactive document
  expect(controller.getViewport(a.documentId)?.offset).toBe(-10);
  expect(controller.getViewport(b.documentId)?.offset).toBe(-20);
  const nextA = controller.registerViewportCapture(a.documentId, collect(a.documentId, -30));
  firstA.release();
  firstA.capture();
  nextA.capture();
  expect(controller.getViewport(a.documentId)?.offset).toBe(-30);
  calls.length = 0;
  controller.captureCurrentViewport();
  expect(calls).toEqual([b.documentId]);
  controller.activateTab(a.documentId);
  const before = controller.getEditor(a.documentId)!;
  controller.updateEditor(a.documentId, before.state.update({ changes: { from: 0, insert: "draft" } }));
  const edited = controller.getEditor(a.documentId)!;
  nextA.capture();
  expect(controller.getViewport(a.documentId)?.revision).toBe(edited.revision);
  expect(controller.getEditor(a.documentId)).toBe(edited);
  nextA.release(); firstB.release(); controller.dispose();
});

test("viewport capture rejects stale revision, changed state during collect, errors and superseded tokens", async () => {
  const { controller, value } = setup();
  await controller.select();
  const id = value.documentId;
  const good = controller.registerViewportCapture(id, () => ({ from: 0, offset: -7, ratio: 0.3, revision: 0 }));
  good.capture();
  const baseline = controller.getViewport(id);
  const throwing = controller.registerViewportCapture(id, () => { throw Error("detached geometry"); });
  expect(() => throwing.capture()).not.toThrow();
  expect(controller.getViewport(id)).toBe(baseline);
  const stale = controller.registerViewportCapture(id, () => ({ from: 0, offset: -99, ratio: 0.3, revision: 9 }));
  stale.capture();
  expect(controller.getViewport(id)).toBe(baseline);
  const mutating = controller.registerViewportCapture(id, () => {
    const editor = controller.getEditor(id)!;
    controller.updateEditor(id, editor.state.update({ selection: { anchor: 1 } }));
    return { from: 0, offset: -99, ratio: 0.3, revision: editor.revision };
  });
  mutating.capture();
  expect(controller.getViewport(id)).toBe(baseline);
  const replacing = controller.registerViewportCapture(id, () => {
    controller.registerViewportCapture(id, () => undefined);
    return { from: 0, offset: -99, ratio: 0.3, revision: 0 };
  });
  replacing.capture();
  expect(controller.getViewport(id)).toBe(baseline);
  controller.dispose();
});

test("viewport registration cannot revive across reload, close/reopen or disposal", async () => {
  const { controller, value } = setup();
  await controller.select();
  const id = value.documentId;
  let calls = 0;
  const old = controller.registerViewportCapture(id, () => {
    calls++;
    return { from: 0, offset: -9, ratio: 0.1, revision: 0 };
  });
  old.capture();
  await controller.select(); // reselect preserves this editor incarnation
  const reselectedCalls = calls;
  old.capture();
  expect(calls).toBe(reselectedCalls + 1);
  await controller.reload();
  const count = calls;
  const stored = controller.getViewport(id);
  expect(stored?.offset).toBe(-9); // reload retains its historic viewport data policy
  old.capture();
  expect(calls).toBe(count);
  expect(controller.getViewport(id)).toBe(stored);
  const fresh = controller.registerViewportCapture(id, () => ({ from: 0, offset: -12, ratio: 0.2, revision: 0 }));
  old.release(); fresh.capture();
  expect(controller.getViewport(id)?.offset).toBe(-12);
  await controller.closeActive();
  expect(controller.getViewport(id)).toBeUndefined();
  await controller.select();
  fresh.capture();
  expect(controller.getViewport(id)).toBeUndefined();
  const newest = controller.registerViewportCapture(id, () => ({ from: 0, offset: -15, ratio: 0.2, revision: 0 }));
  controller.dispose(); newest.capture();
  expect(controller.getViewport(id)).toBeUndefined();
});
