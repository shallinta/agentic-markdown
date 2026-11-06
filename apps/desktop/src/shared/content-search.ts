import {
  CONTENT_SEARCH_FILTER_COUNT_LIMIT,
  validContentSearchFileFilters,
  validContentSearchPathFilters,
  type ContentSearchPathFilter,
} from "./content-search-filters";
import { isDocumentSnapshot } from "./document-snapshot";
import type { DocumentSnapshot } from "./documents";
import { perfRecord, perfUuid } from "./perf-lab";

export const CONTENT_SEARCH_LIMITS = {
  roots: 16,
  documents: 16,
  bytes: 65_536,
  query: 4096,
} as const;

export interface ContentSearchInput {
  root: string;
  generation: number;
  query: string;
  handles: readonly string[];
  fileFilters?: readonly string[];
  pathFilters?: readonly ContentSearchPathFilter[];
}

export interface ContentSearchScopeRoot {
  handle: string;
  generation: number;
}

export interface ContentSearchRootSetInput extends Omit<ContentSearchInput, "root" | "generation"> {
  roots: readonly ContentSearchScopeRoot[];
}

export interface ContentSearchDocumentBinding {
  handle: string;
  documentId: string;
  revision: number;
  hash: string;
}

export interface ContentSearchPrepareInput {
  root: string;
  generation: number;
  entry: string;
  expectedHash: string;
  binding?: ContentSearchDocumentBinding;
}

export type ContentSearchPrepared =
  | {
      ok: true;
      target:
        | { kind: "open"; snapshot: DocumentSnapshot }
        | ({ kind: "reuse" } & ContentSearchDocumentBinding);
    }
  | { ok: false; error: ContentSearchError };

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
    | (ContentSearchRootSetInput & { op: "query-roots" })
    | { op: "cancel"; targetRequestId: string }
  );
export type ContentSearchPrepareRequest = Envelope & ContentSearchPrepareInput;
export type ContentSearchPrepareResponse = {
  protocolVersion: 1;
  requestId: string | null;
} & ContentSearchPrepared;
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
    })
  | (Envelope & {
      ok: true;
      op: "query-roots";
      roots: readonly ContentSearchScopeRoot[];
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

export function validContentSearchScopeRoots(
  value: unknown
): value is readonly ContentSearchScopeRoot[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.length > CONTENT_SEARCH_LIMITS.roots ||
    Object.keys(value).length !== value.length
  )
    return false;
  const handles = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const root: unknown = value[index];
    if (
      !Object.prototype.hasOwnProperty.call(value, index) ||
      !perfRecord(root) ||
      !exact(root, ["handle", "generation"]) ||
      !perfUuid(root.handle) ||
      !natural(root.generation) ||
      handles.has(root.handle)
    )
      return false;
    handles.add(root.handle);
  }
  return true;
}

function validBinding(value: unknown): value is ContentSearchDocumentBinding {
  return (
    perfRecord(value) &&
    exact(value, ["handle", "documentId", "revision", "hash"]) &&
    perfUuid(value.handle) &&
    perfUuid(value.documentId) &&
    natural(value.revision) &&
    digest(value.hash)
  );
}

export function validContentSearchPrepareRequest(
  value: unknown
): value is ContentSearchPrepareRequest {
  if (
    !perfRecord(value) ||
    value.protocolVersion !== 1 ||
    !perfUuid(value.requestId)
  )
    return false;
  const keys = [
    "protocolVersion",
    "requestId",
    "root",
    "generation",
    "entry",
    "expectedHash",
  ];
  return (
    perfUuid(value.root) &&
    natural(value.generation) &&
    perfUuid(value.entry) &&
    digest(value.expectedHash) &&
    (exact(value, keys) ||
      (exact(value, [...keys, "binding"]) &&
        validBinding(value.binding) &&
        value.binding.hash === value.expectedHash))
  );
}

export function validContentSearchPrepareResponse(
  value: unknown,
  request: ContentSearchPrepareRequest
): value is ContentSearchPrepareResponse {
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
  if (
    value.ok !== true ||
    !exact(value, [...base, "target"]) ||
    !perfRecord(value.target)
  )
    return false;
  const { kind, ...target } = value.target;
  const binding = request.binding;
  if (binding) {
    return (
      kind === "reuse" &&
      validBinding(target) &&
      target.handle === binding.handle &&
      target.documentId === binding.documentId &&
      target.revision === binding.revision &&
      target.hash === binding.hash
    );
  }
  return (
    kind === "open" &&
    exact(target, ["snapshot"]) &&
    isDocumentSnapshot(target.snapshot, CONTENT_SEARCH_LIMITS.bytes) &&
    target.snapshot.hash === request.expectedHash
  );
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
  if (value.op !== "query" && value.op !== "query-roots") return false;
  const scopeKeys = value.op === "query" ? ["root", "generation"] : ["roots"];
  const queryKeys = [...base, ...scopeKeys, "query", "handles"];
  let filterCount = 0;
  if (Object.prototype.hasOwnProperty.call(value, "fileFilters")) {
    if (!validContentSearchFileFilters(value.fileFilters)) return false;
    queryKeys.push("fileFilters");
    filterCount += value.fileFilters.length;
  }
  if (Object.prototype.hasOwnProperty.call(value, "pathFilters")) {
    if (!validContentSearchPathFilters(value.pathFilters)) return false;
    queryKeys.push("pathFilters");
    filterCount += value.pathFilters.length;
  }
  return (
    exact(value, queryKeys) &&
    filterCount <= CONTENT_SEARCH_FILTER_COUNT_LIMIT &&
    (value.op === "query"
      ? perfUuid(value.root) && natural(value.generation)
      : validContentSearchScopeRoots(value.roots)) &&
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
  const queryKeys = [...base, "op", "coverage", "mappings"];
  if (request.op === "query") {
    if (
      !exact(value, [...queryKeys, "root", "generation"]) ||
      value.root !== request.root ||
      value.generation !== request.generation
    )
      return false;
  } else if (
    !exact(value, [...queryKeys, "roots"]) ||
    !validContentSearchScopeRoots(value.roots) ||
    value.roots.length !== request.roots.length ||
    value.roots.some((root, index) =>
      root.handle !== request.roots[index].handle ||
      root.generation !== request.roots[index].generation
    )
  )
    return false;
  if (
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
