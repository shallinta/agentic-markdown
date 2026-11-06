import {
  CONTENT_SEARCH_FILTER_COUNT_LIMIT,
  validContentSearchFileFilters,
  validContentSearchPathFilters,
  type ContentSearchPathFilter,
} from "./content-search-filters";
import {
  CONTENT_SEARCH_CONTEXT_LIMIT,
  CONTENT_SEARCH_FRAGMENT_LIMIT,
  isWellFormedContentSearchText,
  type ContentSearchFragments,
} from "./content-search-fragments";
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
  fragments?: true;
}

export interface ContentSearchScopeRoot {
  handle: string;
  generation: number;
}

export interface ContentSearchRootSetInput extends Omit<ContentSearchInput, "root" | "generation" | "fragments"> {
  roots: readonly ContentSearchScopeRoot[];
}

export interface ContentSearchWorkspaceInput extends ContentSearchRootSetInput {
  standaloneHandles: readonly string[];
  fragments?: true;
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

export interface ContentSearchRetainedPrepareInput extends Omit<ContentSearchPrepareInput, "root" | "generation"> {
  roots: readonly ContentSearchScopeRoot[];
  /** The visible root entry for a closed standalone grant already covered by that root. */
  rootEntry?: string;
}

type SearchPreparation<Kind extends "open" | "retained"> =
  | {
      ok: true;
      target:
        | { kind: Kind; snapshot: DocumentSnapshot }
        | ({ kind: "reuse" } & ContentSearchDocumentBinding);
    }
  | { ok: false; error: ContentSearchError };
export type ContentSearchPrepared = SearchPreparation<"open">;
export type ContentSearchRetainedPrepared = SearchPreparation<"retained">;

export type SearchCoverage = {
  entry: string;
  hash: string;
  bytes: number;
} & (
  | { hit?: { from: number; to: number }; fragments?: never }
  | { hit?: never; fragments: ContentSearchFragments }
);

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
    | (ContentSearchRootSetInput & { op: "query-roots"; fragments?: never })
    | (ContentSearchWorkspaceInput & { op: "query-workspace" })
    | { op: "cancel"; targetRequestId: string }
  );
export type ContentSearchRetainedPrepareRequest = Envelope &
  ContentSearchRetainedPrepareInput & { op: "prepare-retained" };
export type ContentSearchPrepareRequest =
  | (Envelope & ContentSearchPrepareInput)
  | ContentSearchRetainedPrepareRequest;
export type ContentSearchPrepareResponse = {
  protocolVersion: 1;
  requestId: string | null;
} & (ContentSearchPrepared | ContentSearchRetainedPrepared);
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
    })
  | (Envelope & {
      ok: true;
      op: "query-workspace";
      roots: readonly ContentSearchScopeRoot[];
      standaloneHandles: readonly string[];
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
  value: unknown,
  allowEmpty = false
): value is readonly ContentSearchScopeRoot[] {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && !value.length) ||
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

function validHandles(value: unknown, own = false): value is readonly string[] {
  if (!Array.isArray(value) || value.length > CONTENT_SEARCH_LIMITS.documents)
    return false;
  if (own) {
    if (Object.keys(value).length !== value.length) return false;
    for (let index = 0; index < value.length; index++)
      if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  }
  return Array.from(value).every(perfUuid) && new Set(value).size === value.length;
}

export function validContentSearchDocumentBinding(value: unknown): value is ContentSearchDocumentBinding {
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
  const retained = "op" in value;
  if (retained && value.op !== "prepare-retained") return false;
  const anchored = retained && "rootEntry" in value;
  const keys = [
    "protocolVersion",
    "requestId",
    ...(retained ? ["op", "roots"] : ["root", "generation"]),
    ...(anchored ? ["rootEntry"] : []),
    "entry",
    "expectedHash",
  ];
  return (
    (retained ? validContentSearchScopeRoots(value.roots, !anchored) &&
      (!anchored || (value.roots.length === 1 && perfUuid(value.rootEntry) && !("binding" in value)))
      : perfUuid(value.root) && natural(value.generation)) &&
    perfUuid(value.entry) &&
    digest(value.expectedHash) &&
    ((exact(value, keys) && (!retained || !("binding" in value))) ||
      (exact(value, [...keys, "binding"]) &&
        validContentSearchDocumentBinding(value.binding) &&
        value.binding.hash === value.expectedHash &&
        (!retained || value.binding.handle === value.entry)))
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
      validContentSearchDocumentBinding(target) &&
      target.handle === binding.handle &&
      target.documentId === binding.documentId &&
      target.revision === binding.revision &&
      target.hash === binding.hash
    );
  }
  const retained = "op" in request && request.op === "prepare-retained";
  const snapshot = target.snapshot;
  if (kind !== (retained ? "retained" : "open") ||
      !exact(target, ["snapshot"]) ||
      !isDocumentSnapshot(snapshot, CONTENT_SEARCH_LIMITS.bytes) ||
      snapshot.hash !== request.expectedHash)
    return false;
  if (!retained) return true;
  return perfRecord(snapshot) &&
    snapshot.handle === request.entry &&
    (snapshot.explicitStandalone === true ||
      (request.rootEntry !== undefined && snapshot.explicitStandalone === false)) &&
    exact(snapshot, [
      "handle", "documentId", "fileName", "revision", "hash", "byteLength", "text",
      "fidelity", "writeCapability", "explicitStandalone",
      ...["mirror", "displayPath", "locationId"].filter((key) =>
        Object.prototype.hasOwnProperty.call(snapshot, key)),
    ]);
}
function validFragments(value: unknown, queryLength: number, bytes: number): boolean {
  if (!perfRecord(value) || !exact(value, ["matches", "more"]) ||
      typeof value.more !== "boolean" || !Array.isArray(value.matches) ||
      value.matches.length > CONTENT_SEARCH_FRAGMENT_LIMIT ||
      Object.keys(value.matches).length !== value.matches.length ||
      (value.more && value.matches.length !== CONTENT_SEARCH_FRAGMENT_LIMIT))
    return false;
  let previousEnd = 0;
  for (let index = 0; index < value.matches.length; index++) {
    const match: unknown = value.matches[index];
    if (!Object.prototype.hasOwnProperty.call(value.matches, index) ||
        !perfRecord(match) || !exact(match, ["from", "to", "before", "after"]) ||
        !natural(match.from) || !natural(match.to) || match.from < previousEnd ||
        match.to - match.from !== queryLength ||
        typeof match.before !== "string" || typeof match.after !== "string" ||
        match.before.length > CONTENT_SEARCH_CONTEXT_LIMIT ||
        match.after.length > CONTENT_SEARCH_CONTEXT_LIMIT ||
        match.before.length > match.from || match.to + match.after.length > bytes ||
        !isWellFormedContentSearchText(match.before) || !isWellFormedContentSearchText(match.after))
      return false;
    previousEnd = match.to;
  }
  return !value.more || previousEnd + queryLength <= bytes;
}

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
  if (value.op !== "query" && value.op !== "query-roots" && value.op !== "query-workspace")
    return false;
  const mixed = value.op === "query-workspace";
  const ownFileFilters = Object.prototype.hasOwnProperty.call(value, "fileFilters");
  const ownPathFilters = Object.prototype.hasOwnProperty.call(value, "pathFilters");
  if (mixed && (("fileFilters" in value && !ownFileFilters) ||
    ("pathFilters" in value && !ownPathFilters)))
    return false;
  const scopeKeys = value.op === "query" ? ["root", "generation"]
    : mixed ? ["roots", "standaloneHandles"] : ["roots"];
  const queryKeys = [...base, ...scopeKeys, "query", "handles"];
  if ("fragments" in value) {
    if (value.fragments !== true || value.op === "query-roots") return false;
    queryKeys.push("fragments");
  }
  let filterCount = 0;
  if (ownFileFilters) {
    if (!validContentSearchFileFilters(value.fileFilters)) return false;
    queryKeys.push("fileFilters");
    filterCount += value.fileFilters.length;
  }
  if (ownPathFilters) {
    if (!validContentSearchPathFilters(value.pathFilters)) return false;
    queryKeys.push("pathFilters");
    filterCount += value.pathFilters.length;
  }
  const validScope = value.op === "query"
    ? perfUuid(value.root) && natural(value.generation)
    : validContentSearchScopeRoots(value.roots, mixed) &&
      (!mixed || (validHandles(value.standaloneHandles, true) &&
        (value.roots.length > 0 || value.standaloneHandles.length > 0)));
  return (
    exact(value, queryKeys) &&
    filterCount <= CONTENT_SEARCH_FILTER_COUNT_LIMIT &&
    validScope &&
    typeof value.query === "string" &&
    value.query.length <= CONTENT_SEARCH_LIMITS.query &&
    value.query.trim().length > 0 &&
    isWellFormedContentSearchText(value.query) &&
    validHandles(value.handles, mixed)
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
  } else {
    const mixed = request.op === "query-workspace";
    if (
      !exact(value, [...queryKeys, "roots", ...(mixed ? ["standaloneHandles"] : [])]) ||
      !validContentSearchScopeRoots(value.roots, mixed) ||
      value.roots.length !== request.roots.length ||
      value.roots.some((root, index) =>
        root.handle !== request.roots[index].handle ||
        root.generation !== request.roots[index].generation
      ) ||
      (mixed && (!validHandles(value.standaloneHandles, true) ||
        value.standaloneHandles.length !== request.standaloneHandles.length ||
        value.standaloneHandles.some((handle, index) => handle !== request.standaloneHandles[index])))
    )
      return false;
  }
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
      (request.op === "query-workspace" && !request.roots.length &&
        !request.standaloneHandles.includes(row.entry)) ||
      !digest(row.hash) ||
      !natural(row.bytes)
    )
      return false;
    const hasHit = Object.keys(row).includes("hit");
    const coverageKeys = ["entry", "hash", "bytes"];
    if (
      !exact(
        row,
        request.fragments ? [...coverageKeys, "fragments"]
          : hasHit ? [...coverageKeys, "hit"] : coverageKeys
      )
    )
      return false;
    total += row.bytes;
    if (total > CONTENT_SEARCH_LIMITS.bytes) return false;
    if (request.fragments) {
      if (!validFragments(row.fragments, request.query.length, row.bytes)) return false;
    } else if (hasHit) {
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
