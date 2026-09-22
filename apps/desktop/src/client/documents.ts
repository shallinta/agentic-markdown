import type { EditorState, Transaction, StateEffect } from "@codemirror/state";

import {
  MAX_DOCUMENT_BYTES,
  type DocumentErrorCode,
  type DocumentHandleRequest,
  type DocumentRequest,
  type DocumentResponse,
  type DocumentSnapshot,
} from "../shared/documents";
import { isTextFidelity } from "../shared/text-fidelity";

import { createRawEditorState, rawText } from "./raw-buffer";

export interface DocumentTransport {
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
  "handle" | "documentId" | "fileName" | "locationId" | "displayPath"
>;
const locationKey = (snapshot: DocumentEntry) =>
  snapshot.locationId ?? snapshot.documentId;

const ERROR_TEXT: Record<DocumentErrorCode, string> = {
  CANCELLED: "文档请求已取消。",
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
    isTextFidelity(s.fidelity, s.text)
  );
}

/** Small external store keeps request ordering independently testable from React. */
export function createDocumentController(
  transport: DocumentTransport,
  confirmDiscard: (message: string) => Promise<boolean> = () =>
    Promise.resolve(false)
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
  let canLeaveEditor = () => true;
  function isDirty(documentId: string) {
    const editor = editors.get(documentId);
    const baseline = state.tabs.find((tab) => tab.documentId === documentId);
    return (
      !!editor && !!baseline && editor.state.field(rawText) !== baseline.text
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
  function protect(ids: string[], action: () => void | Promise<void>) {
    if (state.frozen || !canLeaveEditor()) return;
    if (!ids.some(isDirty)) return action();
    if (!beginDiscard()) return;
    return (async () => {
      try {
        if (await confirmDiscard("是否放弃未保存变更？当前编辑尚不支持保存。"))
          await action();
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
  async function load(select: boolean, entry?: DocumentEntry) {
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
        ? await transport.selectDocument(params)
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
          ? { ...existing, handle: snapshot.handle }
          : snapshot;
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
      }
      if (!select || !existing) {
        scrollSnapshots.delete(active.documentId);
        editors.set(active.documentId, {
          state: createRawEditorState(active.text),
          revision: 0,
        });
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
    const snapshot =
      state.snapshot?.documentId === documentId
        ? (tabs[index] ?? tabs[index - 1] ?? null)
        : state.snapshot;
    staleDocuments.delete(documentId);
    scrollPositions.delete(documentId);
    scrollSnapshots.delete(documentId);
    editors.delete(documentId);
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
  return {
    getSnapshot: () => state,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select: () => {
      if (!state.frozen && canLeaveEditor()) return load(true);
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
        await load(false, entry);
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
    clear: () =>
      protect(
        state.tabs.map((tab) => tab.documentId),
        clear
      ),
    dispose: clear,
    isDirty,
    hasDirty: () => state.tabs.some((tab) => isDirty(tab.documentId)),
    beginDiscard,
    endDiscard,
    setInteractionCheck: (check: () => boolean) => {
      canLeaveEditor = check;
    },
    getEditor: (documentId: string) => editors.get(documentId),
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
        revision: editor.revision + (transaction.docChanged ? 1 : 0),
      });
      if (transaction.docChanged) publish({ ...state });
      return true;
    },
  };
}
