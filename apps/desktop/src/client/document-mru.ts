import { isMRUAck, isMRUResolveResponse, isMRUSessionResponse, MRU_EXIT_MS, type MRUEnvelope, type MRURecordRequest, type MRUResolveRequest, type MRUResolved } from "../shared/document-mru";

import type { createDocumentController } from "./documents";
import type { createFolderWorkspace } from "./workspace";

export interface MRUTransport {
  begin(request: MRUEnvelope): Promise<unknown>;
  record(request: MRURecordRequest): Promise<unknown>;
  resolve(request: MRUResolveRequest): Promise<unknown>;
}
interface MRUState { items: readonly MRUResolved[]; revision: number; incomplete: boolean; message: string }
const envelope = (): MRUEnvelope => ({ protocolVersion: 1, requestId: crypto.randomUUID() });
const WARNING = "最近文档记录暂不可确认，最近顺序可能未保留。";

export function createDocumentMRU(transport: MRUTransport, documents: ReturnType<typeof createDocumentController>, folders: ReturnType<typeof createFolderWorkspace>, warn: (message: string) => void = () => undefined) {
  let state: MRUState = { items: [], revision: 0, incomplete: false, message: "" };
  const listeners = new Set<() => void>();
  let disposed = false, session = "", offset = 0, sequence = 0, resolveSequence = 0, resolveEpoch = 0, pending = 0;
  let tail: Promise<void> = Promise.resolve(), bootstrap: Promise<boolean> | undefined;
  let dirty = true, resolving = false, knownRevision = 0;
  const documentKey = () => { const snapshot = documents.getSnapshot().snapshot; return snapshot ? `${snapshot.handle}:${snapshot.documentId}:${snapshot.revision}:${snapshot.hash}` : ""; };
  let folderSnapshot = folders.getSnapshot(), entrySnapshot = documents.getSnapshot().entries, documentSnapshot = documentKey();
  const publish = (next: MRUState) => { state = next; for (const listener of listeners) listener(); };
  const warning = () => { if (!disposed) { try { warn(WARNING); } catch { /* Metadata reporting never blocks document work. */ } } };
  function begin() {
    bootstrap ??= (async () => {
      const request = envelope();
      try {
        const response = await Promise.resolve().then(() => transport.begin(request));
        if (disposed || !isMRUSessionResponse(response) || response.requestId !== request.requestId || !response.available || !response.session) throw Error("mru-session");
        session = response.session; offset = response.sequence; knownRevision = response.revision;
        return true;
      } catch { bootstrap = undefined; warning(); return false; }
    })();
    return bootstrap;
  }
  function invalidate() {
    resolveEpoch++; dirty = true;
    if (state.items.length) { folders.setMRUCost(0); publish({ ...state, items: [], incomplete: true }); }
  }
  async function refresh() {
    if (disposed || resolving || !dirty || !folders.queryAvailable() || !documents.canSelectFolder()) return;
    resolving = true; dirty = false;
    const epoch = resolveEpoch, captured = folders.getSnapshot(), entries = documents.getSnapshot().entries;
    try {
      if (!await begin() || disposed) return;
      const request = { ...envelope(), session, sequence: ++resolveSequence };
      const response = await transport.resolve(request);
      if (disposed || epoch !== resolveEpoch || folders.getSnapshot() !== captured || documents.getSnapshot().entries !== entries) return;
      if (!isMRUResolveResponse(response) || response.requestId !== request.requestId || response.session !== session || response.sequence !== request.sequence || response.revision < Math.max(state.revision, knownRevision)) throw Error("mru-resolve");
      if (JSON.stringify(response.items) === JSON.stringify(state.items) && response.revision === state.revision && response.incomplete === state.incomplete && !state.message) return;
      // Charge both the incoming response and its retained small rank metadata;
      // workspace admission additionally includes the previous retained value.
      const cost = 4 * JSON.stringify(response).length + 1024 + response.items.length * 256;
      if (!folders.setMRUCost(cost)) throw Error("mru-budget");
      publish({ items: response.items, revision: response.revision, incomplete: response.incomplete, message: response.incomplete ? "部分最近文档暂不可确认。" : "" });
    } catch {
      if (!disposed && epoch === resolveEpoch) { folders.setMRUCost(0); publish({ ...state, items: [], incomplete: true, message: WARNING }); }
    } finally { resolving = false; if (!disposed && dirty) queueMicrotask(() => { void refresh(); }); }
  }
  function record(target: { handle: string; documentId: string }) {
    if (disposed) return;
    const own = ++sequence;
    if (pending >= 64) { warning(); return; }
    pending++;
    invalidate();
    tail = tail.then(async () => {
      if (!await begin() || disposed) return;
      const request = { ...envelope(), ...target, session, sequence: offset + own };
      const response = await transport.record(request);
      if (!isMRUAck(response) || response.requestId !== request.requestId || response.session !== session || response.sequence !== request.sequence) warning();
      else { knownRevision = Math.max(knownRevision, response.revision); if (response.status !== "persisted") warning(); }
    }).catch(warning).finally(() => { pending--; if (!disposed) { dirty = true; void refresh(); } });
  }
  const onFolders = () => { const next = folders.getSnapshot(); if (next !== folderSnapshot) { folderSnapshot = next; invalidate(); } void refresh(); };
  const onDocuments = () => {
    const next = documents.getSnapshot();
    const key = documentKey();
    if (next.entries !== entrySnapshot || key !== documentSnapshot) { entrySnapshot = next.entries; documentSnapshot = key; invalidate(); }
    void refresh();
  };
  let offActivation: (() => void) | undefined, offFolders: (() => void) | undefined, offAvailability: (() => void) | undefined, offDocuments: (() => void) | undefined;
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    attach() {
      disposed = false;
      offActivation ??= documents.subscribeActivation(record);
      offFolders ??= folders.subscribe(onFolders);
      offAvailability ??= folders.subscribeQueryAvailability(() => { void refresh(); });
      offDocuments ??= documents.subscribe(onDocuments);
      void refresh();
    },
    refresh() { dirty = true; void refresh(); },
    async flush(budgetMs: number) {
      const frontier = tail;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), Math.max(0, Math.min(MRU_EXIT_MS, budgetMs))); });
      try { if (!await Promise.race([frontier.then(() => true), timeout])) warning(); }
      finally { clearTimeout(timer); }
    },
    dispose() {
      disposed = true; resolveEpoch++; offActivation?.(); offFolders?.(); offAvailability?.(); offDocuments?.();
      offActivation = offFolders = offAvailability = offDocuments = undefined;
      folders.setMRUCost(0); listeners.clear();
    },
  };
}
