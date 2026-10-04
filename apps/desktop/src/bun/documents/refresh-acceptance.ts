import type { DocumentErrorCode, DocumentSnapshot } from "../../shared/documents";

export interface RefreshAcceptanceRequest {
  handle: string;
  token: string;
  operationId: string;
  sequence: number;
}
export type RefreshAcceptanceResult =
  // Historical receipt for this operation, NOT proof of the current baseline.
  | { status: "committed"; snapshot: DocumentSnapshot }
  | { status: "rejected"; error: DocumentErrorCode }
  | { status: "pending" | "unknown" | "superseded" | "unavailable" };
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export function validRefreshAcceptance(value: unknown): value is RefreshAcceptanceRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return Object.keys(r).length === 4 &&
    typeof r.handle === "string" && uuid.test(r.handle) &&
    typeof r.token === "string" && uuid.test(r.token) &&
    typeof r.operationId === "string" && uuid.test(r.operationId) &&
    typeof r.sequence === "number" && Number.isSafeInteger(r.sequence) && r.sequence > 0;
}

/** Latest result/high-water mark per live grant, not an unbounded operation log. */
export function createRefreshAcceptanceLedger() {
  interface Record { request: RefreshAcceptanceRequest; result: RefreshAcceptanceResult; promise: Promise<RefreshAcceptanceResult> }
  const records = new Map<string, Record>();
  let active: Promise<RefreshAcceptanceResult> | undefined;
  const same = (a: RefreshAcceptanceRequest, b: RefreshAcceptanceRequest) => a.operationId === b.operationId && a.token === b.token && a.sequence === b.sequence;
  return {
    run(request: RefreshAcceptanceRequest, admitted: boolean, execute: () => Promise<RefreshAcceptanceResult>): Promise<RefreshAcceptanceResult> {
      const old = records.get(request.handle);
      if (old && same(old.request, request)) return old.promise.then(value => structuredClone(value));
      if (old?.request.operationId === request.operationId) return Promise.resolve({ status: "rejected", error: "INVALID_REQUEST" });
      if (old && request.sequence <= old.request.sequence) return Promise.resolve({ status: "superseded" });
      if (!admitted || active) return Promise.resolve({ status: "unavailable" });
      const record: Record = { request: { ...request }, result: { status: "pending" }, promise: Promise.resolve({ status: "pending" }) };
      records.set(request.handle, record);
      // Publish the admission before any caller-supplied asynchronous work runs.
      const work = Promise.resolve().then(execute).catch((): RefreshAcceptanceResult => ({ status: "unknown" })).then(result => {
        record.result = structuredClone(result);
        return record.result;
      });
      record.promise = work;
      active = work;
      void work.finally(() => { if (active === work) active = undefined; });
      return work.then(value => structuredClone(value));
    },
    query(request: RefreshAcceptanceRequest): RefreshAcceptanceResult {
      const record = records.get(request.handle);
      if (!record) return { status: "unknown" };
      if (same(record.request, request)) return structuredClone(record.result);
      return { status: request.sequence <= record.request.sequence ? "superseded" : "unknown" };
    },
    busy: () => !!active,
    async settled() { while (active) await active; },
    release(handle: string) { records.delete(handle); },
    clear() { records.clear(); },
    size: () => records.size,
  };
}
