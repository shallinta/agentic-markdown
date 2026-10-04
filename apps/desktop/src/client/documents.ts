import { undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import {
  Transaction,
  type EditorState,
  type StateEffect,
} from "@codemirror/state";

import {
  MAX_DOCUMENT_BYTES,
  isWriteCapability,
  type WriteCapability,
  type DocumentErrorCode,
  type DocumentHandleRequest,
  type DocumentRequest,
  type DocumentResponse,
  type DocumentSnapshot,
  type SaveDocumentRequest,
} from "../shared/documents";
import { validMirror } from "../shared/save-content";
import { isTextFidelity } from "../shared/text-fidelity";
import type { WorkspaceOpenRequest } from "../shared/workspace";

import {
  editorFaultSession,
  type EditorFaultSession,
  type EditorFaultKind,
} from "./editor-fault";
import {
  getEditorMode,
  switchEditorMode,
  isSafeSource,
  safeSourceEffects,
  restartParserForFaultTest,
  pauseEditorParser,
  resumeEditorParser,
} from "./editor-mode";
import { createRawEditorState, rawText } from "./raw-buffer";
import { incrementalSave } from "./save-channel";

export interface DocumentTransport {
  openWorkspaceDocument?(request: WorkspaceOpenRequest): Promise<unknown>;
  checkDocumentWriteCapability?(
    request: DocumentHandleRequest
  ): Promise<unknown>;
  saveDocument?(request: SaveDocumentRequest): Promise<unknown>;
  waitForDocumentSaves?(request: DocumentRequest): Promise<unknown>;
  cancelDocument(request: DocumentRequest): Promise<unknown>;
  selectDocument(request: DocumentRequest): Promise<unknown>;
  readDocument(request: DocumentHandleRequest): Promise<unknown>;
  releaseDocument(request: DocumentHandleRequest): Promise<unknown>;
}

export interface DocumentViewState {
  entries: DocumentEntry[];
  tabs: DocumentSnapshot[];
  snapshot: DocumentSnapshot | null;
  busy: boolean;
  error: string | null;
  stale: boolean;
  elapsedMs: number | null;
  frozen: boolean;
}
export type DocumentEntry = Pick<
  DocumentSnapshot,
  | "handle"
  | "documentId"
  | "fileName"
  | "locationId"
  | "displayPath"
  | "writeCapability"
>;
export interface SaveViewStatus {
  status: "saved" | "dirty" | "saving" | "failed" | "uncertain";
  message?: string;
}
const locationKey = (snapshot: DocumentEntry) =>
  snapshot.locationId ?? snapshot.documentId;

const ERROR_TEXT: Record<DocumentErrorCode, string> = {
  CANCELLED: "文档请求已取消。",
  MIRROR_MISMATCH:
    "内存镜像版本失配，保存未完成；当前编辑内容已保留。请重试保存。",
  READ_ONLY: "当前文档不可写，内存修改已保留。请检查文件和父目录权限。",
  CONFLICT: "磁盘内容已被外部修改，未覆盖。请保留内存内容并重新核对文件。",
  SAVE_FAILED: "保存失败，内存修改已保留，请检查文件权限后重试。",
  SAVE_UNCERTAIN:
    "保存结果未确认，内存修改已保留。请重新读取或重新打开核对，不要盲目重复保存。",
  UNSUPPORTED_SAVE: "当前文件或文件系统不支持安全保存，内存修改已保留。",
  INVALID_REQUEST: "文档请求无效，请重试。",
  INVALID_HANDLE: "读取授权已失效，请重新选择文件。",
  UNSUPPORTED_FILE: "请选择普通的 .md 或 .markdown 文件。",
  TOO_LARGE: "文件超过本轮验证入口的 1 MiB 限制，未读取或截断内容。",
  INVALID_UTF8:
    "文件不是有效的 UTF-8 文本。请先使用外部工具转换为 UTF-8 后重新打开；本 App 不会自动转换或修改文件。",
  FILE_CHANGED: "文件已被替换或读取期间发生变化，请重新选择文件。",
  READ_FAILED: "无法读取文件，请检查文件是否存在及读取权限。",
  BUSY: "文件选择器正在使用中，请稍后重试。",
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Validate the trust boundary in both directions, not just TS call sites. */
export function isDocumentResponse(
  value: unknown,
  requestId: string
): value is DocumentResponse {
  if (
    !record(value) ||
    value.protocolVersion !== 1 ||
    value.requestId !== requestId
  )
    return false;
  if (value.ok === false)
    return (
      typeof value.error === "string" &&
      Object.prototype.hasOwnProperty.call(ERROR_TEXT, value.error)
    );
  if (value.ok !== true) return false;
  if (value.snapshot === null) return true;
  const s = value.snapshot;
  return (
    record(s) &&
    (s.mirror === undefined || validMirror(s.mirror)) &&
    typeof s.handle === "string" &&
    UUID.test(s.handle) &&
    typeof s.documentId === "string" &&
    UUID.test(s.documentId) &&
    typeof s.fileName === "string" &&
    s.fileName.length > 0 &&
    s.fileName.length <= 4096 &&
    (s.displayPath === undefined ||
      (typeof s.displayPath === "string" && s.displayPath.length <= 32768)) &&
    (s.locationId === undefined ||
      (typeof s.locationId === "string" && UUID.test(s.locationId))) &&
    typeof s.revision === "number" &&
    Number.isSafeInteger(s.revision) &&
    s.revision > 0 &&
    typeof s.hash === "string" &&
    /^[a-f0-9]{64}$/.test(s.hash) &&
    typeof s.byteLength === "number" &&
    Number.isInteger(s.byteLength) &&
    s.byteLength >= 0 &&
    s.byteLength <= MAX_DOCUMENT_BYTES &&
    typeof s.text === "string" &&
    s.text.length <= MAX_DOCUMENT_BYTES &&
    new TextEncoder().encode(s.text).length === s.byteLength &&
    isTextFidelity(s.fidelity, s.text) &&
    isWriteCapability(s.writeCapability)
  );
}

/** Small external store keeps request ordering independently testable from React. */
export function createDocumentController(
  transport: DocumentTransport,
  confirmDiscard: (message: string) => Promise<boolean> = () =>
    Promise.resolve(false),
  capabilityTimeoutMs = 5000,
  onTiming?: (phase: "stateCreateMs", ms: number) => void
) {
  let state: DocumentViewState = {
    entries: [],
    tabs: [],
    snapshot: null,
    busy: false,
    error: null,
    stale: false,
    elapsedMs: null,
    frozen: false,
  };
  let generation = 0;
  let pending: DocumentRequest | null = null;
  const staleDocuments = new Set<string>();
  const scrollPositions = new Map<string, number>();
  const scrollSnapshots = new Map<
    string,
    {
      doc: EditorState["doc"];
      effect: StateEffect<unknown>;
    }
  >();
  const editors = new Map<string, { state: EditorState; revision: number }>();
  const reading = new Set<string>();
  const sourceReturn = new Map<string, "editing" | "reading">();
  const viewports = new Map<
    string,
    { from: number; offset: number; ratio: number; revision: number }
  >();
  let captureViewport: (() => void) | undefined;
  const captureCurrentViewport = () => {
    try {
      captureViewport?.();
    } catch {
      /* Geometry failure must not block document operations. */
    }
  };
  const transfers = new Map<
    string,
    { mode: "patch" | "resync"; payloadBytes: number }
  >();
  const capabilityChecks = new Map<
    string,
    { invalidated: boolean; expired: boolean }
  >();
  const capabilityLifetimes = new Map<string, object>();
  const canWrite = (documentId: string) =>
    state.tabs.find((tab) => tab.documentId === documentId)?.writeCapability
      .writable === true;
  function applyCapability(handle: string, capability: WriteCapability) {
    const current = state.entries.find((entry) => entry.handle === handle);
    if (
      !current ||
      (current.writeCapability.writable === capability.writable &&
        current.writeCapability.reason === capability.reason)
    )
      return;
    publish({
      ...state,
      entries: state.entries.map((entry) =>
        entry.handle === handle
          ? { ...entry, writeCapability: capability }
          : entry
      ),
      tabs: state.tabs.map((tab) =>
        tab.handle === handle ? { ...tab, writeCapability: capability } : tab
      ),
      snapshot:
        state.snapshot?.handle === handle
          ? { ...state.snapshot, writeCapability: capability }
          : state.snapshot,
    });
  }
  async function refreshWriteCapability(
    handle = state.snapshot?.handle,
    invalidate = false
  ) {
    if (
      !handle ||
      !transport.checkDocumentWriteCapability ||
      !state.entries.some((entry) => entry.handle === handle)
    )
      return;
    if (invalidate)
      applyCapability(handle, { writable: false, reason: "unavailable" });
    const running = capabilityChecks.get(handle);
    if (running) {
      running.invalidated ||= invalidate;
      return;
    }
    const token = { invalidated: false, expired: false };
    const lifetime = capabilityLifetimes.get(handle);
    capabilityChecks.set(handle, token);
    const params = { ...request(), handle };
    const deadline = setTimeout(() => {
      token.invalidated = true;
      token.expired = true;
      if (capabilityChecks.get(handle) === token)
        capabilityChecks.delete(handle);
      if (capabilityLifetimes.get(handle) === lifetime)
        applyCapability(handle, { writable: false, reason: "unavailable" });
    }, capabilityTimeoutMs);
    try {
      const response = await transport.checkDocumentWriteCapability(params);
      if (token.invalidated || capabilityLifetimes.get(handle) !== lifetime)
        return;
      if (
        !record(response) ||
        Object.keys(response).length !== 4 ||
        response.protocolVersion !== 1 ||
        response.requestId !== params.requestId ||
        response.handle !== handle ||
        !isWriteCapability(response.capability)
      )
        throw Error("invalid capability response");
      applyCapability(handle, response.capability);
    } catch {
      if (!token.expired && capabilityLifetimes.get(handle) === lifetime)
        applyCapability(handle, { writable: false, reason: "unavailable" });
    } finally {
      clearTimeout(deadline);
      if (capabilityChecks.get(handle) === token) {
        capabilityChecks.delete(handle);
        if (token.invalidated && !token.expired)
          void refreshWriteCapability(handle);
      }
    }
  }
  const saving = new Map<string, Promise<void>>();
  const saveResults = new Map<
    string,
    { status: "saved" | "failed" | "uncertain"; message?: string }
  >();
  const uncertain = new Set<string>();
  // A rejected/expired RPC does not prove the backend write has stopped.
  let saveDrainRequired = false;
  const waitForSaves = async () => {
    await Promise.all([...saving.values()]);
    if (!saveDrainRequired) return;
    const params = request();
    const response = await transport.waitForDocumentSaves?.(params);
    if (
      !record(response) ||
      Object.keys(response).length !== 3 ||
      response.protocolVersion !== 1 ||
      response.requestId !== params.requestId ||
      response.settled !== true
    )
      throw new Error("Save settlement unconfirmed");
    saveDrainRequired = false;
  };
  let canLeaveEditor = () => true;
  let editorInputBlocked = false;
  function isDirty(documentId: string) {
    const editor = editors.get(documentId);
    const baseline = state.tabs.find((tab) => tab.documentId === documentId);
    return (
      !!editor &&
      !!baseline &&
      (uncertain.has(documentId) ||
        editor.state.field(rawText) !== baseline.text)
    );
  }
  function beginDiscard() {
    if (state.frozen || state.busy || !canLeaveEditor()) return false;
    publish({ ...state, frozen: true });
    return true;
  }
  function endDiscard() {
    publish({ ...state, frozen: false });
  }
  function reportDiscardFailure() {
    publish({
      ...state,
      error:
        "无法确认后台保存已结束，本次操作已取消，内存修改完整保留。请稍后重试。",
    });
  }
  function protect(ids: string[], action: () => void | Promise<void>) {
    if (state.frozen || !canLeaveEditor()) return;
    if (!saveDrainRequired && !saving.size && !ids.some(isDirty))
      return action();
    if (!beginDiscard()) return;
    return (async () => {
      try {
        await waitForSaves();
        const dirtyIds = ids.filter(isDirty);
        const name =
          dirtyIds.length === 1
            ? state.tabs.find((tab) => tab.documentId === dirtyIds[0])?.fileName
            : undefined;
        if (
          !dirtyIds.length ||
          (await confirmDiscard(
            name
              ? `是否放弃“${name}”的未保存变更？放弃后无法恢复。`
              : "是否放弃全部未保存变更？放弃后无法恢复。"
          ))
        )
          await action();
      } catch {
        reportDiscardFailure();
      } finally {
        endDiscard();
      }
    })();
  }
  function cancelPending() {
    const previous = pending;
    pending = null;
    if (previous)
      void transport.cancelDocument(previous).catch(() => undefined);
  }
  const listeners = new Set<() => void>();
  const request = (): DocumentRequest => ({
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
  });
  function publish(next: DocumentViewState) {
    const previousId = state.snapshot?.documentId;
    const nextId = next.snapshot?.documentId;
    // Capture before subscribers can invalidate/unmount the current reading DOM.
    if (
      previousId !== nextId ||
      (!state.busy && next.busy) ||
      (!state.frozen && next.frozen)
    )
      captureCurrentViewport();
    if (previousId !== nextId) {
      // Only the two changed active slots, never every tab on each keystroke.
      for (const id of [previousId, nextId]) {
        const editor = id && editors.get(id);
        if (!id || !editor) continue;
        editors.set(id, {
          ...editor,
          state: editor.state.update({
            effects:
              id === nextId
                ? resumeEditorParser(editor.state)
                : pauseEditorParser(),
            annotations: Transaction.addToHistory.of(false),
          }).state,
        });
      }
    }
    state = next;
    listeners.forEach((listener) => listener());
  }
  async function release(handle: string) {
    try {
      await transport.releaseDocument({ ...request(), handle });
    } catch {
      /* Process shutdown is the final fallback for a failed release request. */
    }
  }
  async function load(
    select: boolean,
    entry?: DocumentEntry,
    open?: (request: DocumentRequest) => Promise<unknown>
  ) {
    const previous = state.snapshot;
    const target = entry ?? previous;
    if (!select && !target) return;
    const current = ++generation;
    cancelPending();
    const params = request();
    pending = params;
    const start = performance.now();
    publish({ ...state, busy: true, error: null });
    try {
      const response = select
        ? await (open ?? transport.selectDocument)(params)
        : await transport.readDocument({ ...params, handle: target!.handle });
      if (!isDocumentResponse(response, params.requestId))
        throw new Error("invalid-response");
      if (current !== generation) {
        if (
          select &&
          response.ok &&
          response.snapshot &&
          !state.entries.some(
            (value) => value.handle === response.snapshot?.handle
          )
        )
          await release(response.snapshot.handle);
        return;
      }
      if (!response.ok) {
        if (!select && target?.documentId === state.snapshot?.documentId)
          staleDocuments.add(target!.documentId);
        publish({
          ...state,
          busy: false,
          error: ERROR_TEXT[response.error],
          stale:
            select || target?.handle !== state.snapshot?.handle
              ? state.stale
              : !!state.snapshot,
        });
        return;
      }
      const snapshot = response.snapshot;
      if (!snapshot) {
        if (!select) throw new Error("empty-read");
        publish({ ...state, busy: false });
        return;
      }
      if (
        !select &&
        target &&
        (snapshot.handle !== target.handle ||
          snapshot.documentId !== target.documentId ||
          (!entry &&
            previous &&
            (snapshot.revision < previous.revision ||
              (snapshot.revision === previous.revision &&
                snapshot.hash !== previous.hash))))
      )
        throw new Error("stale-response");
      const previousEntry = state.entries.find(
        (entry) => locationKey(entry) === locationKey(snapshot)
      );
      const existing = state.tabs.find(
        (tab) => tab.documentId === snapshot.documentId
      );
      // Explicit re-selection activates the open instance without replacing its content.
      const active =
        select && existing
          ? {
              ...existing,
              handle: snapshot.handle,
              writeCapability: snapshot.writeCapability,
            }
          : snapshot;
      capabilityLifetimes.set(active.handle, {});
      if (!select || !existing) staleDocuments.delete(active.documentId);
      const replaced = state.tabs.find(
        (tab) =>
          locationKey(tab) === locationKey(snapshot) &&
          tab.documentId !== snapshot.documentId
      );
      if (replaced && isDirty(replaced.documentId)) {
        publish({ ...state, frozen: true });
        const approved = await confirmDiscard(
          "文件已被替换。是否放弃旧文档的未保存变更并打开新文件？"
        );
        if (!approved || current !== generation) {
          if (!state.entries.some((entry) => entry.handle === snapshot.handle))
            await release(snapshot.handle);
          if (current === generation)
            publish({ ...state, busy: false, frozen: false });
          return;
        }
      }
      if (replaced) {
        staleDocuments.delete(replaced.documentId);
        scrollPositions.delete(replaced.documentId);
        scrollSnapshots.delete(replaced.documentId);
        editors.delete(replaced.documentId);
        reading.delete(replaced.documentId);
        sourceReturn.delete(replaced.documentId);
        viewports.delete(replaced.documentId);
        transfers.delete(replaced.documentId);
        saveResults.delete(replaced.documentId);
        uncertain.delete(replaced.documentId);
      }
      if (!select || !existing) {
        saveResults.delete(active.documentId);
        uncertain.delete(active.documentId);
        scrollSnapshots.delete(active.documentId);
        const previousMode = editors.get(active.documentId)?.state;
        const previousFault = previousMode?.field(editorFaultSession);
        const stateStart = onTiming ? performance.now() : 0;
        const nextEditor = createRawEditorState(
          active.text,
          [],
          !!previousFault?.fault
        );
        if (previousFault?.fault)
          nextEditor.field(editorFaultSession).fault = previousFault.fault;
        editors.set(active.documentId, {
          state:
            previousMode &&
            !previousFault?.fault &&
            getEditorMode(previousMode) === "source"
              ? nextEditor.update({ effects: switchEditorMode("source") }).state
              : nextEditor,
          revision: 0,
        });
        onTiming?.("stateCreateMs", performance.now() - stateStart);
      }
      const tabs = state.tabs.some(
        (tab) =>
          tab.documentId === snapshot.documentId ||
          locationKey(tab) === locationKey(snapshot)
      )
        ? state.tabs.map((tab) =>
            tab.documentId === snapshot.documentId ||
            locationKey(tab) === locationKey(snapshot)
              ? active
              : tab
          )
        : [...state.tabs, active];
      publish({
        tabs,
        entries: state.entries.some(
          (value) => locationKey(value) === locationKey(snapshot)
        )
          ? state.entries.map((value) =>
              locationKey(value) === locationKey(snapshot)
                ? {
                    handle: snapshot.handle,
                    documentId: snapshot.documentId,
                    fileName: snapshot.fileName,
                    locationId: snapshot.locationId,
                    displayPath: snapshot.displayPath,
                    writeCapability: snapshot.writeCapability,
                  }
                : value
            )
          : [
              ...state.entries,
              {
                handle: snapshot.handle,
                documentId: snapshot.documentId,
                fileName: snapshot.fileName,
                locationId: snapshot.locationId,
                displayPath: snapshot.displayPath,
                writeCapability: snapshot.writeCapability,
              },
            ],
        snapshot: active,
        busy: false,
        error: null,
        stale: staleDocuments.has(active.documentId),
        elapsedMs: performance.now() - start,
        frozen: state.frozen,
      });
      if (previousEntry && previousEntry.handle !== snapshot.handle)
        void release(previousEntry.handle);
    } catch {
      if (pending === params) cancelPending();
      if (current === generation) {
        if (!select && target?.documentId === state.snapshot?.documentId)
          staleDocuments.add(target!.documentId);
        publish({
          ...state,
          busy: false,
          error: "文档通信失败或返回结果无效，请重试或重新选择文件。",
          stale:
            select || target?.handle !== state.snapshot?.handle
              ? state.stale
              : !!state.snapshot,
        });
      }
    } finally {
      if (pending === params) pending = null;
      // Replacement confirmation owns this lock only inside a selecting request.
      if (select && current === generation && state.frozen) endDiscard();
    }
  }
  function clear() {
    ++generation;
    cancelPending();
    const previous = state.entries;
    staleDocuments.clear();
    scrollPositions.clear();
    scrollSnapshots.clear();
    editors.clear();
    reading.clear();
    sourceReturn.clear();
    viewports.clear();
    transfers.clear();
    capabilityLifetimes.clear();
    saveResults.clear();
    uncertain.clear();
    publish({
      entries: [],
      tabs: [],
      snapshot: null,
      busy: false,
      error: null,
      stale: false,
      elapsedMs: null,
      frozen: state.frozen,
    });
    for (const entry of previous) void release(entry.handle);
  }
  function activateTab(documentId: string) {
    if (state.frozen || !canLeaveEditor()) return;
    const snapshot = state.tabs.find((tab) => tab.documentId === documentId);
    if (!snapshot) return;
    captureCurrentViewport();
    ++generation;
    cancelPending();
    publish({
      ...state,
      snapshot,
      busy: false,
      error: null,
      stale: staleDocuments.has(documentId),
      elapsedMs: null,
    });
  }
  function closeTab(documentId: string) {
    const index = state.tabs.findIndex((tab) => tab.documentId === documentId);
    if (index < 0) return;
    ++generation;
    cancelPending();
    const tabs = state.tabs.filter((tab) => tab.documentId !== documentId);
    capabilityLifetimes.delete(state.tabs[index].handle);
    const snapshot =
      state.snapshot?.documentId === documentId
        ? (tabs[index] ?? tabs[index - 1] ?? null)
        : state.snapshot;
    staleDocuments.delete(documentId);
    scrollPositions.delete(documentId);
    scrollSnapshots.delete(documentId);
    editors.delete(documentId);
    reading.delete(documentId);
    sourceReturn.delete(documentId);
    viewports.delete(documentId);
    transfers.delete(documentId);
    saveResults.delete(documentId);
    uncertain.delete(documentId);
    publish({
      ...state,
      tabs,
      snapshot,
      busy: false,
      error: null,
      stale: !!snapshot && staleDocuments.has(snapshot.documentId),
      elapsedMs: null,
    });
  }
  let historyDispatch: ((transaction: Transaction) => void) | undefined;
  let captureScroll: (() => StateEffect<unknown>) | undefined;
  const canToggleSourceMode = () =>
    !!state.snapshot &&
    editors.has(state.snapshot.documentId) &&
    !editors.get(state.snapshot.documentId)!.state.field(editorFaultSession)
      .fault &&
    !state.frozen &&
    !state.busy &&
    canLeaveEditor();
  const canHistory = (
    direction: "undo" | "redo",
    documentId = state.snapshot?.documentId
  ) => {
    const editor = documentId && editors.get(documentId);
    return (
      !!editor &&
      !reading.has(documentId) &&
      documentId === state.snapshot?.documentId &&
      !state.frozen &&
      !state.busy &&
      canLeaveEditor() &&
      (direction === "undo"
        ? undoDepth(editor.state)
        : redoDepth(editor.state)) > 0 &&
      canWrite(documentId)
    );
  };
  const controller = {
    isSafeSource: (documentId: string) => {
      const editor = editors.get(documentId);
      return !!editor && isSafeSource(editor.state);
    },
    getEditorFault: (documentId: string) =>
      editors.get(documentId)?.state.field(editorFaultSession),
    enterSafeSource: (documentId: string, session: EditorFaultSession) => {
      const editor = editors.get(documentId);
      if (
        editor?.state.field(editorFaultSession) !== session ||
        !session.fault ||
        session.recoveryFailed ||
        state.frozen ||
        state.busy ||
        !canLeaveEditor()
      )
        return false;
      if (isSafeSource(editor.state)) return true;
      try {
        const effects = safeSourceEffects();
        // View geometry can itself be unavailable after a presentation fault.
        // Preserve scroll when possible, but never make it a recovery dependency.
        if (state.snapshot?.documentId === documentId) {
          try {
            const scroll = captureScroll?.();
            if (scroll) effects.push(scroll);
          } catch {
            // The accepted editor state remains the source of recovery truth.
          }
        }
        const transaction = editor.state.update({
          effects,
          annotations: Transaction.addToHistory.of(false),
        });
        if (state.snapshot?.documentId === documentId && historyDispatch)
          historyDispatch(transaction);
        else controller.updateEditor(documentId, transaction);
        return isSafeSource(editors.get(documentId)!.state);
      } catch {
        session.recoveryFailed = true;
        publish({
          ...state,
          error: "安全源码恢复失败，内存状态已保留；请勿关闭文档。",
        });
        return false;
      }
    },
    injectEditorFault: (kind: EditorFaultKind) => {
      if (!canToggleSourceMode()) return false;
      const documentId = state.snapshot!.documentId;
      const editor = editors.get(documentId)!;
      if (kind === "presentation" && getEditorMode(editor.state) !== "editing")
        return false;
      const session = editor.state.field(editorFaultSession);
      session.inject = kind;
      const transaction = editor.state.update({
        effects: kind === "parser" ? restartParserForFaultTest() : [],
        annotations: Transaction.addToHistory.of(false),
        selection: editor.state.selection,
      });
      if (historyDispatch) historyDispatch(transaction);
      else controller.updateEditor(documentId, transaction);
      return true;
    },
    canToggleSourceMode,
    canChangeReadingTheme: () =>
      !state.frozen && !state.busy && canLeaveEditor(),
    captureCurrentViewport,
    getMode: (documentId: string) => {
      const editor = editors.get(documentId);
      return editor && getEditorMode(editor.state) === "source"
        ? "source"
        : reading.has(documentId)
          ? "reading"
          : "editing";
    },
    setViewportCapture: (capture?: () => void) => {
      captureViewport = capture;
    },
    getViewport: (documentId: string) => viewports.get(documentId),
    setViewport: (
      documentId: string,
      value: { from: number; offset: number; ratio: number; revision: number }
    ) => {
      if (
        editors.has(documentId) &&
        Number.isFinite(value.from) &&
        Number.isFinite(value.offset) &&
        Number.isFinite(value.ratio)
      )
        viewports.set(documentId, value);
    },
    canToggleReadingMode: () =>
      canToggleSourceMode() &&
      controller.getMode(state.snapshot!.documentId) !== "source",
    toggleReadingMode: () => {
      if (!controller.canToggleReadingMode()) return false;
      const id = state.snapshot!.documentId;
      captureCurrentViewport();
      if (reading.has(id)) reading.delete(id);
      else reading.add(id);
      publish({ ...state });
      return true;
    },
    toggleSourceMode: () => {
      if (!canToggleSourceMode()) return false;
      const documentId = state.snapshot!.documentId;
      const editor = editors.get(documentId)!;
      captureCurrentViewport();
      const previous = controller.getMode(documentId);
      if (previous !== "source") sourceReturn.set(documentId, previous);
      const scroll = captureScroll?.();
      const effect = switchEditorMode(
        getEditorMode(editor.state) === "editing" ? "source" : "editing"
      );
      const transaction = editor.state.update({
        effects: scroll ? [effect, scroll] : effect,
        annotations: Transaction.addToHistory.of(false),
      });
      if (historyDispatch) historyDispatch(transaction);
      else controller.updateEditor(documentId, transaction);
      if (editors.get(documentId)?.state === transaction.state) {
        if (previous === "source" && sourceReturn.get(documentId) === "reading")
          reading.add(documentId);
        else reading.delete(documentId);
        publish({ ...state });
      }
      return editors.get(documentId)?.state === transaction.state;
    },
    setScrollCapture: (capture?: () => StateEffect<unknown>) => {
      captureScroll = capture;
    },
    canWrite,
    refreshWriteCapability,
    canUndo: () => canHistory("undo"),
    canRedo: () => canHistory("redo"),
    runHistory: (
      direction: "undo" | "redo",
      documentId = state.snapshot?.documentId
    ) => {
      if (!documentId || !canHistory(direction, documentId)) return false;
      return (direction === "undo" ? undo : redo)({
        state: editors.get(documentId)!.state,
        dispatch: (transaction) => {
          if (historyDispatch) historyDispatch(transaction);
          else controller.updateEditor(documentId, transaction);
        },
      });
    },
    setHistoryDispatch: (dispatch?: (transaction: Transaction) => void) => {
      historyDispatch = dispatch;
    },
    notifyInteraction: () => publish({ ...state }),
    getSnapshot: () => state,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select: () => {
      if (!state.frozen && canLeaveEditor()) {
        if (saving.size || saveDrainRequired)
          return protect([], () => load(true));
        return load(true);
      }
    },
    canSelectFolder: () =>
      !state.frozen && !state.busy && !saving.size && canLeaveEditor(),
    runWorkspaceAction: (action: () => void | Promise<void>) => {
      if (!controller.canSelectFolder()) return;
      // Availability is not settlement: a completed/expired save still needs
      // the backend barrier before changing root ownership or scan generations.
      return protect([], action);
    },
    openWorkspaceEntry: (root: string, entry: string) => {
      if (!controller.canSelectFolder() || !transport.openWorkspaceDocument)
        return;
      const open = (params: DocumentRequest) =>
        transport.openWorkspaceDocument!({ ...params, root, entry });
      return protect([], () => load(true, undefined, open));
    },
    reload: () =>
      protect(state.snapshot ? [state.snapshot.documentId] : [], () =>
        load(false)
      ),
    activate: async (entry: DocumentEntry) => {
      if (state.frozen || !canLeaveEditor()) return;
      if (state.tabs.some((tab) => tab.documentId === entry.documentId))
        activateTab(entry.documentId);
      else if (state.entries.some((value) => value.handle === entry.handle))
        await protect([], () => load(false, entry));
    },
    activateTab,
    closeTab: (documentId: string) =>
      protect([documentId], () => closeTab(documentId)),
    closeActive: () => {
      if (state.snapshot)
        return protect([state.snapshot.documentId], () =>
          closeTab(state.snapshot!.documentId)
        );
    },
    getScrollPosition: (documentId: string) =>
      scrollPositions.get(documentId) ?? 0,
    getScrollSnapshot: (documentId: string) => {
      const saved = scrollSnapshots.get(documentId);
      return saved?.doc === editors.get(documentId)?.state.doc
        ? saved?.effect
        : undefined;
    },
    setScrollSnapshot: (
      documentId: string,
      doc: EditorState["doc"],
      effect: StateEffect<unknown>
    ) => {
      if (editors.get(documentId)?.state.doc === doc)
        scrollSnapshots.set(documentId, { doc, effect });
    },
    setScrollPosition: (documentId: string, offset: number) => {
      if (
        state.tabs.some((tab) => tab.documentId === documentId) &&
        Number.isFinite(offset) &&
        offset >= 0
      )
        scrollPositions.set(documentId, offset);
    },
    clear: (beforeClear?: () => Promise<void>) =>
      protect(
        state.tabs.map((tab) => tab.documentId),
        () => {
          if (!beforeClear) return clear();
          publish({ ...state, frozen: true });
          return beforeClear().then(clear).finally(endDiscard);
        }
      ),
    dispose: () => {
      if (saving.size || saveDrainRequired) {
        void waitForSaves()
          .then(clear)
          .catch(() => undefined);
      } else clear();
    },
    isDirty,
    hasDirty: () => state.tabs.some((tab) => isDirty(tab.documentId)),
    waitForSaves,
    hasSaves: () => saving.size > 0,
    canSave: () =>
      !!transport.saveDocument &&
      canLeaveEditor() &&
      !state.frozen &&
      !state.busy &&
      !!state.snapshot &&
      canWrite(state.snapshot.documentId) &&
      !saving.size &&
      !uncertain.has(state.snapshot.documentId) &&
      isDirty(state.snapshot.documentId),
    getSaveStatus: (documentId: string): SaveViewStatus =>
      saving.has(documentId)
        ? { status: "saving" }
        : saveResults.get(documentId)?.status === "failed" ||
            saveResults.get(documentId)?.status === "uncertain"
          ? saveResults.get(documentId)!
          : isDirty(documentId)
            ? { status: "dirty" }
            : { status: "saved" },
    save: () => {
      const baseline = state.snapshot;
      if (
        !baseline ||
        !canWrite(baseline.documentId) ||
        !transport.saveDocument ||
        state.frozen ||
        state.busy ||
        saving.size ||
        uncertain.has(baseline.documentId) ||
        !isDirty(baseline.documentId) ||
        !canLeaveEditor()
      )
        return;
      const editor = editors.get(baseline.documentId)!;
      const text = editor.state.field(rawText);
      const params = {
        ...request(),
        handle: baseline.handle,
        documentId: baseline.documentId,
        expectedRevision: baseline.revision,
        expectedHash: baseline.hash,
        bufferRevision: editor.revision,
      };
      const operation = Promise.resolve().then(async () => {
        let dispatched = false;
        try {
          const outcome = await incrementalSave(
            params,
            baseline,
            text,
            (request) => {
              dispatched = true;
              return transport.saveDocument!(request);
            },
            (value) => transfers.set(baseline.documentId, value)
          );
          const response = outcome.response;
          if (!isDocumentResponse(response, outcome.requestId))
            throw Error("invalid save response");
          if (!response.ok) {
            if (response.error === "READ_ONLY") {
              applyCapability(baseline.handle, {
                writable: false,
                reason: "unavailable",
              });
              void refreshWriteCapability(baseline.handle);
            }
            if (response.error === "SAVE_UNCERTAIN")
              uncertain.add(baseline.documentId);
            saveResults.set(baseline.documentId, {
              status:
                response.error === "SAVE_UNCERTAIN" ? "uncertain" : "failed",
              message: ERROR_TEXT[response.error],
            });
            return;
          }
          const next = response.snapshot;
          if (
            !next ||
            response.savedBufferRevision !== params.bufferRevision ||
            next.documentId !== baseline.documentId ||
            next.handle !== baseline.handle ||
            next.text !== text ||
            next.revision <= baseline.revision
          )
            throw Error("mismatched save response");
          saveResults.set(baseline.documentId, { status: "saved" });
          staleDocuments.delete(baseline.documentId);
          publish({
            ...state,
            entries: state.entries.map((entry) =>
              entry.handle === next.handle
                ? { ...entry, writeCapability: next.writeCapability }
                : entry
            ),
            tabs: state.tabs.map((tab) =>
              tab.documentId === baseline.documentId ? next : tab
            ),
            snapshot:
              state.snapshot?.documentId === baseline.documentId
                ? next
                : state.snapshot,
            stale:
              state.snapshot?.documentId === baseline.documentId
                ? false
                : state.stale,
          });
        } catch {
          if (dispatched) uncertain.add(baseline.documentId);
          saveResults.set(baseline.documentId, {
            status: dispatched ? "uncertain" : "failed",
            message: dispatched
              ? "保存通信失败或回执无效，结果未确认；内存修改已保留。请核对磁盘后再继续。"
              : "保存准备失败，尚未请求写盘；内存修改已保留。",
          });
        } finally {
          saving.delete(baseline.documentId);
          publish({ ...state });
        }
      });
      saveDrainRequired = true;
      saving.set(baseline.documentId, operation);
      publish({ ...state });
      return operation;
    },
    beginDiscard,
    endDiscard,
    reportDiscardFailure,
    setInteractionCheck: (check: () => boolean) => {
      canLeaveEditor = check;
    },
    isEditorInputBlocked: () => editorInputBlocked,
    setEditorInputBlocked: (blocked: boolean) => {
      if (editorInputBlocked === blocked) return;
      editorInputBlocked = blocked;
      publish({ ...state });
    },
    getEditor: (documentId: string) => editors.get(documentId),
    getSaveTransfer: (documentId: string) => transfers.get(documentId),
    updateEditor: (documentId: string, transaction: Transaction) => {
      const editor = editors.get(documentId);
      if (
        !editor ||
        state.frozen ||
        state.busy ||
        transaction.startState !== editor.state
      )
        return false;
      const raw = transaction.state.field(rawText);
      if (
        (transaction.docChanged || raw !== editor.state.field(rawText)) &&
        (editorInputBlocked || !canWrite(documentId) || reading.has(documentId))
      )
        return false;
      if (
        transaction.docChanged &&
        new TextEncoder().encode(raw).length > MAX_DOCUMENT_BYTES
      ) {
        publish({
          ...state,
          error: "编辑后内容超过 1 MiB，本次操作未应用，原有内容完整保留。",
        });
        return false;
      }
      editors.set(documentId, {
        state: transaction.state,
        revision:
          editor.revision + (raw !== editor.state.field(rawText) ? 1 : 0),
      });
      if (
        transaction.docChanged ||
        isSafeSource(editor.state) !== isSafeSource(transaction.state) ||
        getEditorMode(editor.state) !== getEditorMode(transaction.state)
      )
        publish({ ...state });
      return true;
    },
  };
  return controller;
}
