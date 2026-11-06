import { perfRecord, perfUuid } from "./perf-lab";

export const CONTENT_SEARCH_LIMITS = {
  documents: 16,
  bytes: 65_536,
  query: 4096,
} as const;

export interface ContentSearchInput {
  root: string;
  generation: number;
  query: string;
  handles: readonly string[];
}

export interface SearchCoverage {
  entry: string;
  hash: string;
  bytes: number;
  hit?: { from: number; to: number };
}

export type SearchMapping =
  | {
      handle: string;
      kind: "matched";
      entry: string;
      documentId: string;
      revision: number;
      hash: string;
    }
  | { handle: string; kind: "outside" | "unresolved" };

const errors = [
  "DISABLED",
  "INVALID",
  "STALE",
  "NOT_READY",
  "LIMIT",
  "BUSY",
  "CANCELLED",
  "UNKNOWN",
  "UNAVAILABLE",
] as const;
export type ContentSearchError = (typeof errors)[number];
export type ContentSearchCandidates =
  | { ok: true; coverage: SearchCoverage[]; mappings: SearchMapping[] }
  | { ok: false; error: ContentSearchError };

interface Envelope {
  protocolVersion: 1;
  requestId: string;
}
export type ContentSearchRequest = Envelope &
  (
    | (ContentSearchInput & { op: "query" })
    | { op: "cancel"; targetRequestId: string }
  );
export type ContentSearchResponse =
  | {
      protocolVersion: 1;
      requestId: string | null;
      ok: false;
      error: ContentSearchError;
    }
  | (Envelope & { ok: true; op: "cancel" })
  | (Envelope & {
      ok: true;
      op: "query";
      root: string;
      generation: number;
      coverage: SearchCoverage[];
      mappings: SearchMapping[];
    });

function exact(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}
function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
const unpaired =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

export function validContentSearchRequest(
  value: unknown
): value is ContentSearchRequest {
  if (
    !perfRecord(value) ||
    value.protocolVersion !== 1 ||
    !perfUuid(value.requestId)
  )
    return false;
  const base = ["protocolVersion", "requestId", "op"];
  if (value.op === "cancel")
    return (
      exact(value, [...base, "targetRequestId"]) &&
      perfUuid(value.targetRequestId)
    );
  return (
    value.op === "query" &&
    exact(value, [...base, "root", "generation", "query", "handles"]) &&
    perfUuid(value.root) &&
    natural(value.generation) &&
    typeof value.query === "string" &&
    value.query.length <= CONTENT_SEARCH_LIMITS.query &&
    value.query.trim().length > 0 &&
    !unpaired.test(value.query) &&
    Array.isArray(value.handles) &&
    value.handles.length <= CONTENT_SEARCH_LIMITS.documents &&
    Array.from(value.handles).every(perfUuid) &&
    new Set(value.handles).size === value.handles.length
  );
}

export function validContentSearchResponse(
  value: unknown,
  request: ContentSearchRequest
): value is ContentSearchResponse {
  if (
    !perfRecord(value) ||
    value.protocolVersion !== 1 ||
    value.requestId !== request.requestId
  )
    return false;
  const base = ["protocolVersion", "requestId", "ok"];
  if (value.ok === false)
    return (
      exact(value, [...base, "error"]) &&
      errors.some((error) => error === value.error)
    );
  if (value.ok !== true || value.op !== request.op) return false;
  if (request.op === "cancel") return exact(value, [...base, "op"]);
  if (
    !exact(value, [
      ...base,
      "op",
      "root",
      "generation",
      "coverage",
      "mappings",
    ]) ||
    value.root !== request.root ||
    value.generation !== request.generation ||
    !Array.isArray(value.coverage) ||
    value.coverage.length > CONTENT_SEARCH_LIMITS.documents ||
    !Array.isArray(value.mappings) ||
    value.mappings.length !== request.handles.length
  )
    return false;
  const entries = new Set<string>();
  let total = 0;
  for (const row of value.coverage) {
    if (
      !perfRecord(row) ||
      !perfUuid(row.entry) ||
      entries.has(row.entry) ||
      !digest(row.hash) ||
      !natural(row.bytes)
    )
      return false;
    const hasHit = Object.keys(row).includes("hit");
    if (
      !exact(
        row,
        hasHit ? ["entry", "hash", "bytes", "hit"] : ["entry", "hash", "bytes"]
      )
    )
      return false;
    total += row.bytes;
    if (total > CONTENT_SEARCH_LIMITS.bytes) return false;
    if (hasHit) {
      const hit = row.hit;
      if (
        !perfRecord(hit) ||
        !exact(hit, ["from", "to"]) ||
        !natural(hit.from) ||
        !natural(hit.to) ||
        hit.to - hit.from !== request.query.length ||
        hit.to > row.bytes
      )
        return false;
    }
    entries.add(row.entry);
  }
  const remaining = new Set(request.handles);
  const matched = new Set<string>();
  for (const row of value.mappings) {
    if (
      !perfRecord(row) ||
      !perfUuid(row.handle) ||
      !remaining.delete(row.handle)
    )
      return false;
    if (row.kind === "outside" || row.kind === "unresolved") {
      if (!exact(row, ["handle", "kind"])) return false;
      continue;
    }
    if (
      row.kind !== "matched" ||
      !exact(row, [
        "handle",
        "kind",
        "entry",
        "documentId",
        "revision",
        "hash",
      ]) ||
      !perfUuid(row.entry) ||
      !entries.has(row.entry) ||
      matched.has(row.entry) ||
      !perfUuid(row.documentId) ||
      !natural(row.revision) ||
      !digest(row.hash)
    )
      return false;
    matched.add(row.entry);
  }
  return remaining.size === 0;
}
