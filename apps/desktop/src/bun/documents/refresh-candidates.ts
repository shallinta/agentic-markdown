import { randomUUID } from "node:crypto";

import type { DocumentErrorCode } from "../../shared/documents";
import type { TextFidelity } from "../../shared/text-fidelity";

export interface RefreshBinding {
  handle: string;
  documentId: string;
  expectedRevision: number;
  expectedHash: string;
}
export interface RefreshContent {
  text: string;
  hash: string;
  byteLength: number;
  fidelity: TextFidelity;
}
export interface RefreshCandidate extends RefreshContent, RefreshBinding {
  token: string;
}
export type RefreshResult =
  | { ok: true; candidate: RefreshCandidate | null }
  | { ok: false; error: DocumentErrorCode };
export interface RefreshContext {
  binding: RefreshBinding;
  current(): boolean;
  verify(): Promise<void>;
  read(alive: () => boolean): Promise<RefreshContent>;
}
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function validRefreshBinding(value: unknown): value is RefreshBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 4 &&
    typeof r.handle === "string" && uuid.test(r.handle) &&
    typeof r.documentId === "string" && uuid.test(r.documentId) &&
    typeof r.expectedRevision === "number" && Number.isSafeInteger(r.expectedRevision) && r.expectedRevision > 0 &&
    typeof r.expectedHash === "string" && /^[a-f0-9]{64}$/.test(r.expectedHash);
}

/** One running read, latest intent/candidate per document. No baseline writes. */
export function createRefreshCandidates(canRun: () => boolean, errorCode: (error: unknown) => DocumentErrorCode) {
  interface Item { context: RefreshContext; resolve(result: RefreshResult): void; candidate?: RefreshCandidate }
  const items = new Map<string, Item>();
  const pending = new Map<string, Item>();
  interface Check { item: Item; promise: Promise<boolean>; resolve(value: boolean): void }
  const checks = new Map<Item, Check>();
  const pendingChecks = new Set<Check>();
  let runningCheck: Check | undefined;
  let running: Item | undefined;
  let disposed = false;
  const live = (item: Item) => !disposed && items.get(item.context.binding.documentId) === item && item.context.current();
  const invalidate = (id: string) => {
    const item = items.get(id);
    if (item) {
      item.candidate = undefined; item.resolve({ ok: false, error: "CANCELLED" });
      const check = checks.get(item);
      if (check) { check.resolve(false); pendingChecks.delete(check); checks.delete(item); }
    }
    items.delete(id); pending.delete(id);
  };
  function pumpChecks() {
    if (disposed || runningCheck || !canRun()) return;
    const check = pendingChecks.values().next().value;
    if (!check) return;
    pendingChecks.delete(check); runningCheck = check;
    void (async () => {
      const { item } = check;
      let valid = false;
      try { if (live(item)) { await item.context.verify(); valid = live(item); } }
      catch { /* Authorization failures never prove a valid binding. */ }
      finally {
        if (!valid && items.get(item.context.binding.documentId) === item) invalidate(item.context.binding.documentId);
        checks.delete(item); check.resolve(valid); runningCheck = undefined; pumpChecks();
      }
    })();
  }
  function pump() {
    if (disposed || running || !canRun()) return;
    const item = pending.values().next().value;
    if (!item) return;
    const id = item.context.binding.documentId;
    pending.delete(id); running = item;
    void (async () => {
      try {
        if (!live(item)) throw Error("stale");
        const content = await item.context.read(() => live(item));
        if (!live(item)) throw Error("stale");
        if (content.hash === item.context.binding.expectedHash) {
          items.delete(id); item.resolve({ ok: true, candidate: null });
        } else {
          // Private copies prevent a trusted caller's accidental mutation from
          // changing the retained binding or future check result.
          item.candidate = structuredClone({ ...content, ...item.context.binding, token: randomUUID() });
          item.resolve({ ok: true, candidate: structuredClone(item.candidate) });
        }
      } catch (error) {
        const current = live(item);
        if (items.get(id) === item) items.delete(id);
        item.resolve({ ok: false, error: current ? errorCode(error) : "CANCELLED" });
      } finally { running = undefined; pump(); }
    })();
  }
  return {
    request(context: RefreshContext): Promise<RefreshResult> {
      if (disposed) return Promise.resolve({ ok: false, error: "INVALID_HANDLE" });
      const id = context.binding.documentId;
      invalidate(id);
      return new Promise(resolve => {
        const item: Item = { context, resolve };
        items.set(id, item); pending.set(id, item); pump();
      });
    },
    /** Authorization/baseline binding only; never proves latest disk content. */
    checkBinding(this: void, token: unknown): Promise<boolean> {
      if (typeof token !== "string" || !uuid.test(token)) return Promise.resolve(false);
      const item = [...items.values()].find(value => value.candidate?.token === token);
      if (!item) return Promise.resolve(false);
      const old = checks.get(item);
      if (old) return old.promise;
      let resolve!: (valid: boolean) => void;
      const promise = new Promise<boolean>(done => { resolve = done; });
      const check = { item, promise, resolve };
      checks.set(item, check); pendingChecks.add(check); pumpChecks();
      return promise;
    },
    discardHandle(this: void, handle: string) {
      for (const [id, item] of items) if (item.context.binding.handle === handle) invalidate(id);
    },
    invalidate,
    wake() { pump(); pumpChecks(); },
    dispose() { disposed = true; for (const id of items.keys()) invalidate(id); },
    stats: () => ({ retained: [...items.values()].filter(item => !!item.candidate).length, pending: pending.size, running: !!running }),
  };
}
