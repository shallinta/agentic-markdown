import { undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import {
  Transaction,
  type EditorState,
  type StateEffect,
  type Extension,
} from "@codemirror/state";

import type { DuplicateSource } from "../shared/create-markdown";
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
import type { FolderRemovalPublication, FolderRemovalDocument } from "../shared/folder-removal";
import { validMirror } from "../shared/save-content";
import { validRemovalResponse, type RemovalRequest, type RemovalOperation } from "../shared/standalone-removal";
import { isTextFidelity } from "../shared/text-fidelity";
import type { WorkspaceOpenRequest } from "../shared/workspace";

import { createDocumentObservation } from "./document-observation";
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
  getSourceWrapping,
  sourceWrappingEffect,
} from "./editor-mode";
import { createRawEditorState, rawText, sourceSearchPresentation } from "./raw-buffer";
import { incrementalSave } from "./save-channel";
import { createSearchStore } from "./source-search-store";

export interface DocumentTransport {
  removeStandalone?(request: RemovalRequest): Promise<unknown>;
  observeDocument?(request: import("../shared/document-observation").ObservationRequest): Promise<unknown>;
  openWorkspaceDocument?(request: WorkspaceOpenRequest): Promise<unknown>;
  checkDocumentWriteCapability?(
    request: DocumentHandleRequest
  ): Promise<unknown>;
  saveDocument?(request: SaveDocumentRequest): Promise<unknown>;
  waitForDocumentSaves?(request: DocumentRequest): Promise<unknown>;
  cancelDocument(request: DocumentRequest): Promise<unknown>;
  selectDocument(request: DocumentRequest): Promise<unknown>;
  revealDocument?(request: DocumentHandleRequest): Promise<unknown>;
  openDefaultDocument?(request: DocumentHandleRequest): Promise<unknown>;
  readDocument(request: DocumentHandleRequest): Promise<unknown>;
  releaseDocument(request: DocumentHandleRequest): Promise<unknown>;
}

export interface DocumentViewState {
  folderRemovalPending?: "confirming" | "ack";
  removalPending?: "confirming" | "ack";
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
  | "explicitStandalone"
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
    (s.explicitStandalone === undefined ||
      typeof s.explicitStandalone === "boolean") &&
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
  let removalGate = false;
  let folderRemovalGate = false;
  let duplicateGate: { source: DuplicateSource; cancelled: boolean } | null = null;
  let creationGate: { token: string; cancelled: boolean } | null = null;
  let discardActive = false;
  let removalEligible: (handle: string) => boolean = () => false;
  let removal: { entry: DocumentEntry; phase: "state" | "begin" | "commit" | "query" | "ack"; operation?: RemovalOperation; finalError: string | null } | null = null;
  let removalRunning = false;
  const staleDocuments = new Set<string>();
  const scrollPositions = new Map<string, number>();
  const scrollSnapshots = new Map<
    string,
    {
      doc: EditorState["doc"];
      effect: StateEffect<unknown>;
    }
  >();
  let editors = new Map<string, { state: EditorState; revision: number }>();
  const search = createSearchStore(id=>editors.has(id) && !metadataDisposed);
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
  let metadataEpoch = 0;
  let metadataDisposed = false;
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
  // Fault ownership outlives EditorView (reading has no view). Only faults enter
  // this pending set; ordinary edits neither scan tabs nor schedule recovery.
  const faultOwners = new Map<
    string,
    { session: EditorFaultSession; notify: () => void }
  >();
  const pendingFaults = new Set<string>();
  let recoveryQueued = false;
  function scheduleFaultRecovery() {
    if (metadataDisposed || recoveryQueued || !pendingFaults.size) return;
    recoveryQueued = true;
    queueMicrotask(() => {
      recoveryQueued = false;
      if (metadataDisposed) return;
      for (const id of [...pendingFaults]) {
        const owner = faultOwners.get(id);
        const editor = editors.get(id);
        if (!owner || editor?.state.field(editorFaultSession) !== owner.session) {
          pendingFaults.delete(id);
          continue;
        }
        if (!owner.session.recoveryFailed && !isSafeSource(editor.state))
          controller.enterSafeSource(id, owner.session);
        if (owner.session.recoveryFailed || controller.isSafeSource(id))
          pendingFaults.delete(id);
      }
      // A blocked attempt waits for an explicit unblock event, never itself.
    });
  }
  function releaseFaultOwner(id: string) {
    const owner = faultOwners.get(id);
    if (owner && owner.session.notify === owner.notify)
      owner.session.notify = undefined;
    faultOwners.delete(id);
    pendingFaults.delete(id);
  }
  function bindFaultOwner(id: string) {
    releaseFaultOwner(id);
    const session = editors.get(id)!.state.field(editorFaultSession);
    let announced = false;
    const notify = () => {
      if (
        metadataDisposed ||
        faultOwners.get(id)?.notify !== notify ||
        editors.get(id)?.state.field(editorFaultSession) !== session ||
        !session.fault || session.recoveryFailed || controller.isSafeSource(id)
      ) return;
      pendingFaults.add(id);
      if (!announced) {
        announced = true;
        publish({ ...state });
      }
      scheduleFaultRecovery();
    };
    faultOwners.set(id, { session, notify });
    session.notify = notify;
    if (session.fault) queueMicrotask(notify);
  }
  let sourceWrapping = true;
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
  const observation = createDocumentObservation(transport.observeDocument ? request => transport.observeDocument!(request) : undefined, () => publish({ ...state }));
  const needsDiscard = (documentId: string) => isDirty(documentId) || observation.atRisk(documentId);
  function beginDiscard() {
    if (state.frozen || state.busy || !canLeaveEditor()) return false;
    discardActive = true;
    publish({ ...state, frozen: true });
    return true;
  }
  function endDiscard() {
    discardActive = false;
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
    if (!saveDrainRequired && !saving.size && !ids.some(needsDiscard))
      return action();
    if (!beginDiscard()) return;
    return (async () => {
      try {
        await waitForSaves();
        const dirtyIds = ids.filter(needsDiscard);
        const name =
          dirtyIds.length === 1
            ? state.tabs.find((tab) => tab.documentId === dirtyIds[0])?.fileName
            : undefined;
        if (
          !dirtyIds.length ||
          (await confirmDiscard(
            name
              ? `是否放弃“${name}”的未保存变更或尚未接受外部变化的内存内容？放弃后无法恢复。`
              : "是否放弃全部未保存变更或尚未接受外部变化的内存内容？放弃后无法恢复。"
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
  let revealPending: { requestId: string; handle: string } | null = null;
  const request = (): DocumentRequest => ({
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
  });
  function publish(next: DocumentViewState) {
    if (removalGate || folderRemovalGate || duplicateGate || creationGate) next = { ...next, frozen: true };
    if (revealPending && (next.snapshot?.handle !== revealPending.handle || next.busy || next.frozen || !canLeaveEditor())) {
      const old = revealPending; revealPending = null;
      void transport.cancelDocument({ protocolVersion: 1, requestId: old.requestId }).catch(() => undefined);
    }
    const recoveryUnblocked =
      (state.busy && !next.busy) || (state.frozen && !next.frozen);
    const previousTabs = state.tabs;
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
                : pauseEditorParser(true),
            annotations: Transaction.addToHistory.of(false),
          }).state,
        });
      }
    }
    state = next;
    if (previousTabs !== next.tabs) observation.sync(next.tabs);
    listeners.forEach((listener) => listener());
    if (recoveryUnblocked) scheduleFaultRecovery();
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
    open?: (request: DocumentRequest) => Promise<unknown>,
    createdIntent?: () => boolean
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
          !createdIntent && !state.entries.some(
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
      // A creation receipt owns its grant until explicit adoption/cleanup. Do
      // not use the ordinary best-effort release path for a cancelled intent.
      if (createdIntent && (!createdIntent() || metadataDisposed || state.frozen || !canLeaveEditor() || state.entries.some(value => locationKey(value) === locationKey(snapshot) && value.documentId !== snapshot.documentId))) {
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
              explicitStandalone: snapshot.explicitStandalone,
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
      if (replaced) {
        observation.replaced(replaced.documentId);
        publish({ ...state, frozen: true });
        const approved = await confirmDiscard(
          "文件已被替换。是否放弃旧文档的未保存变更或内存内容并打开新文件？"
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
        releaseFaultOwner(replaced.documentId);
        editors.delete(replaced.documentId);
        search.delete(replaced.documentId);
        reading.delete(replaced.documentId);
        sourceReturn.delete(replaced.documentId);
        viewports.delete(replaced.documentId);
        transfers.delete(replaced.documentId);
        saveResults.delete(replaced.documentId);
        uncertain.delete(replaced.documentId);
      }
      if (!select || !existing) {
        observation.accept(active.documentId);
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
              ? nextEditor.update({
                  effects: switchEditorMode("source", sourceWrapping),
                }).state
              : nextEditor.update({
                  effects: sourceWrappingEffect(nextEditor, sourceWrapping),
                }).state,
          revision: 0,
        });
        onTiming?.("stateCreateMs", performance.now() - stateStart);
        bindFaultOwner(active.documentId);
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
                    explicitStandalone: snapshot.explicitStandalone,
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
                explicitStandalone: snapshot.explicitStandalone,
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
    metadataEpoch++;
    ++generation;
    cancelPending();
    const previous = state.entries;
    staleDocuments.clear();
    scrollPositions.clear();
    scrollSnapshots.clear();
    for (const id of faultOwners.keys()) releaseFaultOwner(id);
    editors.clear();
    search.clear();
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
  function closeTab(documentId: string, removeHandle?: string) {
    const index = state.tabs.findIndex((tab) => tab.documentId === documentId);
    if (index < 0) {
      if (removeHandle) publish({ ...state, entries: state.entries.filter(entry => entry.handle !== removeHandle), frozen: discardActive, removalPending: "ack" });
      return;
    }
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
    releaseFaultOwner(documentId);
    editors.delete(documentId);
    search.delete(documentId);
    reading.delete(documentId);
    sourceReturn.delete(documentId);
    viewports.delete(documentId);
    transfers.delete(documentId);
    saveResults.delete(documentId);
    uncertain.delete(documentId);
    publish({
      ...state,
      ...(removeHandle ? { entries: state.entries.filter(entry => entry.handle !== removeHandle), frozen: discardActive, removalPending: "ack" as const } : {}),
      tabs,
      snapshot,
      busy: false,
      error: null,
      stale: !!snapshot && staleDocuments.has(snapshot.documentId),
      elapsedMs: null,
    });
  }
  async function settleRemoval() {
    if (!removal || removalRunning || !transport.removeStandalone || metadataDisposed) return;
    const captured = removal;
    removalRunning = true;
    try {
      for (let step = 0; step < 5 && removal === captured; step++) {
        const params: RemovalRequest = captured.phase === "state" ? { ...request(), op: "state" } : { ...request(), op: captured.phase, ...captured.operation! };
        let value: unknown;
        try { value = await transport.removeStandalone(params); }
        catch (error) { if (captured.phase === "commit") captured.phase = "query"; throw error; }
        if (metadataDisposed || removal !== captured) return;
        if (!validRemovalResponse(value, params)) { if (captured.phase === "commit") captured.phase = "query"; throw Error("Invalid removal response"); }
        if (value.status === "state") {
          captured.operation = { session: value.session, sequence: value.sequence, handle: captured.entry.handle };
          captured.phase = "begin";
          continue;
        }
        if (captured.phase === "ack") {
          if (value.status !== "acked") throw Error("Removal acknowledgement unknown");
          removal = null;
          publish({ ...state, removalPending: undefined, error: captured.finalError });
          return;
        }
        if (value.status === "issued") { captured.phase = "commit"; continue; }
        if (value.status === "committed" || value.status === "rejected" || (value.status === "busy" && captured.phase === "begin")) {
          const current = state.entries.find(entry => entry.handle === captured.entry.handle);
          if (current?.documentId !== captured.entry.documentId || locationKey(current) !== locationKey(captured.entry)) throw Error("Removal target changed");
          const needsAck = captured.phase !== "begin" || value.status === "committed";
          removalGate = false;
          captured.phase = "ack";
          captured.finalError = value.status === "committed" ? null : "无法移除：文件归属或授权状态已变化，窗口内容完整保留。";
          if (value.status === "committed") closeTab(current.documentId, current.handle);
          else publish({ ...state, frozen: discardActive, error: captured.finalError, removalPending: needsAck ? "ack" : undefined });
          if (!needsAck) { removal = null; return; }
          continue;
        }
        throw Error("Removal outcome unknown");
      }
    } catch {
      if (metadataDisposed || removal !== captured) return;
      if (captured.phase === "state") { removalGate = false; removal = null; }
      publish({ ...state, frozen: removalGate || discardActive, removalPending: removal ? (captured.phase === "ack" ? "ack" : "confirming") : undefined,
        error: captured.phase === "ack" ? "移除结果已确认，但收据尚未确认回收。可重试；暂不能移除其他文件。" : removal ? "移除结果尚未确认，内存内容已保留并锁定。请重试确认结果，勿关闭应用。" : "无法开始移除，窗口内容完整保留。请重试。" });
    } finally { removalRunning = false; }
  }
  let historyDispatch: ((transaction: Transaction) => void) | undefined;
  let captureScroll: (() => StateEffect<unknown>) | undefined;
  let scheduleWrapping: (() => void) | undefined;
  let sourceSelectionTarget: {
    documentId: string;
    ready: () => boolean;
    run: (action: "above" | "below" | "simplify") => boolean;
  } | undefined;
  let listInputTarget: {
    documentId: string;
    ready: () => boolean;
    run: (soft: boolean) => boolean;
  } | undefined;
  let indentationTarget: {
    documentId: string;
    ready: () => boolean;
    run: (more: boolean) => boolean;
  } | undefined;
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
    acquireCreationGate: (): string | null => {
      if (metadataDisposed || editorInputBlocked || !controller.canSelectFolder()) return null;
      const token = crypto.randomUUID();
      creationGate = { token, cancelled: false };
      publish({ ...state, frozen: true });
      return token;
    },
    creationGateCurrent: (token: string) => creationGate?.token === token && !creationGate.cancelled && !metadataDisposed && !discardActive && !editorInputBlocked && canLeaveEditor(),
    releaseCreationGate: (token: string) => {
      if (creationGate?.token !== token) return;
      creationGate = null;
      publish({ ...state, frozen: discardActive });
    },
    canDuplicate: () => {
      const snapshot = state.snapshot;
      const editor = snapshot && editors.get(snapshot.documentId);
      return !metadataDisposed && !state.frozen && !state.busy && !saving.size && !editorInputBlocked && canLeaveEditor() && !!snapshot && !!editor && !editor.state.field(editorFaultSession).fault && !state.stale && !observation.atRisk(snapshot.documentId) && controller.getSaveStatus(snapshot.documentId).status === "saved";
    },
    acquireDuplicateSource: (handle: string, documentId: string): DuplicateSource | null => {
      if (!controller.canDuplicate() || state.snapshot?.handle !== handle || state.snapshot.documentId !== documentId) return null;
      const snapshot = state.snapshot;
      const source: DuplicateSource = { handle, documentId, expectedRevision: snapshot.revision, expectedHash: snapshot.hash, bufferRevision: editors.get(documentId)!.revision, gateToken: crypto.randomUUID() };
      duplicateGate = { source, cancelled: false };
      publish({ ...state, frozen: true });
      return source;
    },
    matchesDuplicateSource: (source: DuplicateSource) => !metadataDisposed && !discardActive && !editorInputBlocked && canLeaveEditor() && state.snapshot?.handle === source.handle && state.snapshot.documentId === source.documentId && state.snapshot.revision === source.expectedRevision && state.snapshot.hash === source.expectedHash && editors.get(source.documentId)?.revision === source.bufferRevision && !editors.get(source.documentId)?.state.field(editorFaultSession).fault && !needsDiscard(source.documentId),
    duplicateSourceCurrent: (source: DuplicateSource) => duplicateGate?.source === source && !duplicateGate.cancelled && controller.matchesDuplicateSource(source),
    releaseDuplicateSource: (source: DuplicateSource) => {
      if (duplicateGate?.source !== source) return;
      duplicateGate = null;
      publish({ ...state, frozen: discardActive });
    },
    // Only the application exit/reload guard may bypass this particular owner.
    // Keep its freeze until the receipt settles; cancellation cannot revive an
    // old auto-activation intent or send an as-yet unsent publication.
    beginWindowDiscard: () => {
      if (!duplicateGate && !creationGate) return beginDiscard();
      if (removalGate || folderRemovalGate || discardActive || state.busy || !canLeaveEditor()) return false;
      if (duplicateGate) duplicateGate.cancelled = true;
      if (creationGate) creationGate.cancelled = true;
      discardActive = true;
      publish({ ...state, frozen: true });
      return true;
    },
    canBeginFolderRemoval: () => !metadataDisposed && !removal && !state.folderRemovalPending && !state.busy && !state.frozen && canLeaveEditor(),
    beginFolderRemoval: async () => {
      if (!controller.canBeginFolderRemoval()) return false;
      folderRemovalGate = true;
      publish({ ...state, frozen: true, folderRemovalPending: "confirming", error: null });
      try { await waitForSaves(); return !metadataDisposed; }
      catch { folderRemovalGate = false; publish({ ...state, frozen: discardActive, folderRemovalPending: undefined }); reportDiscardFailure(); return false; }
    },
    confirmFolderRemovalClose: async (documents: FolderRemovalDocument[]) => {
      if (!folderRemovalGate || metadataDisposed) return false;
      const risky = documents.filter(item => needsDiscard(item.documentId));
      return !risky.length || await confirmDiscard(`是否放弃以下文档的未保存变更或尚未接受外部变化的内存内容并关闭？放弃后无法恢复。\n${risky.map(item => item.fileName).join("\n")}`);
    },
    setFolderRemovalStatus: (phase: "confirming" | "ack" | null, error: string | null = null) => {
      folderRemovalGate = phase === "confirming";
      publish({ ...state, frozen: folderRemovalGate || discardActive, folderRemovalPending: phase ?? undefined, error });
    },
    prepareFolderRemoval: (result: FolderRemovalPublication) => {
      if (!folderRemovalGate || metadataDisposed) throw Error("folder-removal-gate");
      const known = new Map(state.entries.map(entry => [entry.handle, entry]));
      if ([...result.closed, ...result.standalone].some(handle => !known.has(handle))) throw Error("folder-removal-identity");
      const closed = new Set(result.closed), revoked = new Set(result.revoked), standalone = new Set(result.standalone);
      if (result.closed.some(handle => !state.tabs.some(tab => tab.handle === handle)) || result.revoked.some(handle => state.tabs.some(tab => tab.handle === handle) && !closed.has(handle)) || result.standalone.some(handle => revoked.has(handle))) throw Error("folder-removal-membership");
      const promote = <T extends DocumentEntry>(entry: T): T => standalone.has(entry.handle) && entry.explicitStandalone !== true ? { ...entry, explicitStandalone: true } : entry;
      const tabs = state.tabs.filter(tab => !closed.has(tab.handle)).map(promote);
      const oldIndex = state.tabs.findIndex(tab => tab.documentId === state.snapshot?.documentId);
      const snapshot = state.snapshot && !closed.has(state.snapshot.handle) ? tabs.find(tab => tab.documentId === state.snapshot!.documentId)! : (state.tabs.slice(oldIndex + 1).map(tab => tabs.find(item => item.documentId === tab.documentId)).find(Boolean) ?? [...state.tabs.slice(0, oldIndex)].reverse().map(tab => tabs.find(item => item.documentId === tab.documentId)).find(Boolean) ?? null);
      const removedIds = state.tabs.filter(tab => closed.has(tab.handle)).map(tab => tab.documentId);
      const nextEditors = new Map(editors);
      captureCurrentViewport();
      for (const id of removedIds) nextEditors.delete(id);
      if (snapshot?.documentId !== state.snapshot?.documentId && snapshot) {
        const editor = nextEditors.get(snapshot.documentId);
        if (editor) nextEditors.set(snapshot.documentId, { ...editor, state: editor.state.update({ effects: resumeEditorParser(editor.state), annotations: Transaction.addToHistory.of(false) }).state });
      }
      const next: DocumentViewState = { ...state, entries: state.entries.filter(entry => !revoked.has(entry.handle)).map(promote), tabs, snapshot, frozen: discardActive, folderRemovalPending: "ack", busy: false, error: null, stale: !!snapshot && staleDocuments.has(snapshot.documentId), elapsedMs: null };
      return { next, nextEditors, removedIds, closed: result.closed };
    },
    swapPrepared: (prepared: { next: DocumentViewState; nextEditors: typeof editors }) => {
      state = prepared.next;
      editors = prepared.nextEditors;
      folderRemovalGate = false;
      generation++;
    },
    flushPreparedEffects: (prepared: { removedIds: string[]; closed: string[] }) => {
      const safely = (effect: () => void) => { try { effect(); } catch { console.error("folder-removal-effect"); } };
      for (const handle of prepared.closed) capabilityLifetimes.delete(handle);
      for (const id of prepared.removedIds) {
        staleDocuments.delete(id); scrollPositions.delete(id); scrollSnapshots.delete(id); reading.delete(id); sourceReturn.delete(id); viewports.delete(id); transfers.delete(id); saveResults.delete(id); uncertain.delete(id);
        safely(() => releaseFaultOwner(id)); safely(() => search.delete(id));
      }
      safely(() => observation.sync(state.tabs));
      for (const listener of listeners) safely(listener);
      safely(scheduleFaultRecovery);
    },
    setStandaloneRemovalEligibility: (eligible: (handle: string) => boolean) => { removalEligible = eligible; },
    canRemoveStandalone: (handle: string | null) => !!handle && !!transport.removeStandalone && !metadataDisposed && !removal && !state.folderRemovalPending && !state.busy && !state.frozen && canLeaveEditor() && state.entries.some(entry => entry.handle === handle && entry.explicitStandalone !== false) && removalEligible(handle),
    removeStandalone: (handle: string) => {
      if (!controller.canRemoveStandalone(handle)) return;
      const entry = state.entries.find(entry => entry.handle === handle)!;
      return protect([entry.documentId], async () => {
        const current = state.entries.find(candidate => candidate.handle === handle);
        if (metadataDisposed || removal || current?.documentId !== entry.documentId || locationKey(current) !== locationKey(entry) || !removalEligible(handle) || !canLeaveEditor()) return;
        removalGate = true;
        removal = { entry: current, phase: "state", finalError: null };
        publish({ ...state, frozen: true, error: null, removalPending: "confirming" });
        await settleRemoval();
      });
    },
    retryStandaloneRemoval: () => settleRemoval(),
    search,
    /** Release only a derived view-owned extension, including during frozen teardown. */
    releaseSearchPresentation: (
      documentId: string,
      session: EditorFaultSession,
      extension: Extension,
    ) => {
      const editor = editors.get(documentId);
      if (
        editor?.state.field(editorFaultSession) !== session ||
        sourceSearchPresentation.get(editor.state) !== extension
      ) return undefined;
      const transaction = editor.state.update({
        effects: sourceSearchPresentation.reconfigure([]),
        annotations: Transaction.addToHistory.of(false),
      });
      editors.set(documentId, { state: transaction.state, revision: editor.revision });
      return transaction;
    },
    setListInputTarget: (target?: typeof listInputTarget) => { listInputTarget = target; },
    setIndentationTarget: (target?: typeof indentationTarget) => { indentationTarget = target; },
    canIndentSource: () => {
      const id = indentationTarget?.documentId, editor = id && editors.get(id);
      return !!editor && !metadataDisposed && id === state.snapshot?.documentId &&
        !reading.has(id) && !isSafeSource(editor.state) &&
        !editor.state.field(editorFaultSession).fault && canWrite(id) && !editorInputBlocked &&
        !state.frozen && !state.busy && canLeaveEditor() && !!indentationTarget?.ready();
    },
    runSourceIndentation: (more: boolean, documentId: string) => {
      if (indentationTarget?.documentId !== documentId || !controller.canIndentSource()) return false;
      return indentationTarget.run(more);
    },
    canRunListInput: () => {
      const id=listInputTarget?.documentId, editor=id&&editors.get(id);
      return !!editor && !metadataDisposed && id===state.snapshot?.documentId &&
        !reading.has(id) && !isSafeSource(editor.state) && !editor.state.field(editorFaultSession).fault &&
        canWrite(id) && !editorInputBlocked && !state.frozen && !state.busy && canLeaveEditor() && !!listInputTarget?.ready();
    },
    runListInput: (soft:boolean,documentId:string) => {
      if(listInputTarget?.documentId!==documentId || !controller.canRunListInput())return false;
      return listInputTarget.run(soft);
    },
    setSourceSelectionTarget: (target?: typeof sourceSelectionTarget) => {
      sourceSelectionTarget = target;
    },
    canSelectSource: (documentId = state.snapshot?.documentId) => {
      const editor = documentId && editors.get(documentId);
      return !metadataDisposed && !!editor &&
        documentId === state.snapshot?.documentId &&
        getEditorMode(editor.state) === "source" && !isSafeSource(editor.state) &&
        !editor.state.field(editorFaultSession).fault &&
        !state.frozen && !state.busy && canLeaveEditor();
    },
    canRunSourceSelection: () => !!sourceSelectionTarget &&
      controller.canSelectSource(sourceSelectionTarget.documentId) && sourceSelectionTarget.ready(),
    runSourceSelection: (action: "above" | "below" | "simplify", documentId: string) => {
      if (sourceSelectionTarget?.documentId !== documentId || !controller.canRunSourceSelection()) return false;
      return sourceSelectionTarget.run(action);
    },
    setSourceWrapping: (enabled: boolean) => {
      if (typeof enabled !== "boolean" || metadataDisposed) return;
      sourceWrapping = enabled;
      if (state.frozen || state.busy || !canLeaveEditor()) return;
      const id = state.snapshot?.documentId;
      const editor = id && editors.get(id);
      if (
        !editor || isSafeSource(editor.state) ||
        getSourceWrapping(editor.state) === enabled
      ) return;
      // Hidden cached states keep their old geometry until their view is restored.
      if (scheduleWrapping) scheduleWrapping();
      else controller.applySourceWrapping(id, editor.state);
    },
    needsSourceWrapping: (documentId: string) => {
      const editor = editors.get(documentId);
      return (
        !metadataDisposed && documentId === state.snapshot?.documentId &&
        !!editor && !isSafeSource(editor.state) &&
        getSourceWrapping(editor.state) !== sourceWrapping
      );
    },
    applySourceWrapping: (
      documentId: string,
      expected: EditorState,
      scroll?: StateEffect<unknown>
    ) => {
      const editor = editors.get(documentId);
      if (
        !controller.needsSourceWrapping(documentId) || editor?.state !== expected ||
        state.frozen || state.busy || !canLeaveEditor()
      ) return false;
      const effects: StateEffect<unknown>[] = [
        sourceWrappingEffect(expected, sourceWrapping),
      ];
      if (scroll && getEditorMode(expected) === "source") effects.push(scroll);
      const transaction = expected.update({
        effects, annotations: Transaction.addToHistory.of(false),
      });
      if (historyDispatch) historyDispatch(transaction);
      else controller.updateEditor(documentId, transaction);
      return editors.get(documentId)?.state === transaction.state;
    },
    isSafeSource: (documentId: string) => {
      const editor = editors.get(documentId);
      return !!editor && isSafeSource(editor.state);
    },
    getEditorFault: (documentId: string) =>
      editors.get(documentId)?.state.field(editorFaultSession),
    enterSafeSource: (documentId: string, session: EditorFaultSession) => {
      const editor = editors.get(documentId);
      if (
        metadataDisposed ||
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
          selection: editor.state.selection.asSingle(),
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
        getEditorMode(editor.state) === "editing" ? "source" : "editing",
        sourceWrapping
      );
      const transaction = editor.state.update({
        effects: scroll ? [...effect, scroll] : effect,
        selection: editor.state.selection.asSingle(),
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
      scheduleFaultRecovery();
      return () => {
        if (historyDispatch !== dispatch) return;
        historyDispatch = undefined;
        scheduleFaultRecovery();
      };
    },
    setWrappingScheduler: (schedule?: () => void) => {
      scheduleWrapping = schedule;
    },
    notifyInteraction: () => {
      controller.setSourceWrapping(sourceWrapping);
      publish({ ...state });
      scheduleFaultRecovery();
    },
    getSnapshot: () => state,
    canRevealDocument: () => !!state.snapshot && !["missing", "replaced"].includes(observation.status(state.snapshot.documentId) ?? "") && !state.busy && !state.frozen && !saving.size && !revealPending && canLeaveEditor(),
    revealCurrentDocument: () => controller.dispatchDocumentPath("reveal"),
    openDefaultDocument: () => controller.dispatchDocumentPath("open-default"),
    async dispatchDocumentPath(action: "reveal" | "open-default") {
      if (!controller.canRevealDocument() || !state.snapshot) return;
      const target = { ...request(), handle: state.snapshot.handle };
      revealPending = target;
      publish({ ...state });
      try {
        const response = await (action === "reveal" ? transport.revealDocument?.(target) : transport.openDefaultDocument?.(target));
        if (revealPending !== target || state.snapshot?.handle !== target.handle || !canLeaveEditor()) return;
        if (!isDocumentResponse(response, target.requestId) || !response.ok)
          publish({ ...state, error: action === "reveal" ? "无法发起 Finder 定位，请确认文件仍存在且授权有效。" : "无法用系统默认应用打开，请确认文件仍存在且有默认关联。" });
      } catch {
        if (revealPending === target && state.snapshot?.handle === target.handle && canLeaveEditor())
          publish({ ...state, error: action === "reveal" ? "Finder 定位请求失败，请重试。" : "系统默认应用打开请求失败，请重试。" });
      } finally {
        if (revealPending === target) revealPending = null;
        publish({ ...state });
      }
    },
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    select: () => controller.selectWith(),
    selectWith: (open?: (request: DocumentRequest) => Promise<unknown>) => {
      if (!state.frozen && canLeaveEditor()) {
        if (saving.size || saveDrainRequired)
          return protect([], () => load(true, undefined, open));
        return load(true, undefined, open);
      }
    },
    canSelectFolder: () =>
      !state.frozen && !state.busy && !saving.size && canLeaveEditor(),
    adoptCreatedDocument: async (snapshot: DocumentSnapshot, current: () => boolean) => {
      if (metadataDisposed || !current() || !controller.canSelectFolder()) return false;
      let ready = false;
      await protect([], () => { ready = true; });
      if (!ready || metadataDisposed || !current() || !controller.canSelectFolder()) return false;
      await load(true, undefined, params => Promise.resolve({ ...params, ok: true, snapshot }), current);
      return state.tabs.some(tab => tab.handle === snapshot.handle && tab.documentId === snapshot.documentId);
    },
    runWorkspaceAction: (action: () => void | Promise<void>) => {
      if (!controller.canSelectFolder()) return;
      // Availability is not settlement: a completed/expired save still needs
      // the backend barrier before changing root ownership or scan generations.
      return protect([], action);
    },
    runMetadataRescan: async (action: () => void | Promise<void>) => {
      if (metadataDisposed || !controller.canSelectFolder()) return;
      const expected = metadataEpoch;
      let ready = false;
      // The save settlement barrier must finish and unfreeze before the long
      // metadata task. Other workspace ownership operations retain protect().
      await protect([], () => { ready = true; });
      if (ready && expected === metadataEpoch && controller.canSelectFolder()) await action();
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
      if (creationGate) creationGate.cancelled = true;
      if (duplicateGate) duplicateGate.cancelled = true;
      if (revealPending) {
        void transport.cancelDocument({ protocolVersion: 1, requestId: revealPending.requestId }).catch(() => undefined);
        revealPending = null;
      }
      metadataDisposed = true;
      for (const id of faultOwners.keys()) releaseFaultOwner(id);
      search.clear();
      metadataEpoch++;
      observation.dispose();
      if (saving.size || saveDrainRequired) {
        void waitForSaves()
          .then(clear)
          .catch(() => undefined);
      } else clear();
    },
    isDirty,
    hasDiscardable: () => state.tabs.some(tab => needsDiscard(tab.documentId)),
    externalStatus: observation.status,
    externalMessage: observation.message,
    applyExternalObservation: observation.apply,
    refreshExternalObservations: observation.refresh,
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
      scheduleFaultRecovery();
      return () => {
        if (canLeaveEditor !== check) return;
        canLeaveEditor = () => true;
        scheduleFaultRecovery();
      };
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
      const rawChanged = raw !== editor.state.field(rawText);
      const contentChanged = transaction.docChanged || rawChanged;
      if (
        contentChanged &&
        (editorInputBlocked || !canWrite(documentId) || reading.has(documentId))
      )
        return false;
      if (
        contentChanged &&
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
        revision: editor.revision + (rawChanged ? 1 : 0),
      });
      if (!isSafeSource(editor.state) && isSafeSource(transaction.state))
        reading.delete(documentId);
      if (
        contentChanged ||
        isSafeSource(editor.state) !== isSafeSource(transaction.state) ||
        getEditorMode(editor.state) !== getEditorMode(transaction.state)
      )
        publish({ ...state });
      return true;
    },
  };
  return controller;
}
