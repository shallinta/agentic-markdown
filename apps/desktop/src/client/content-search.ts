import {
  CONTENT_SEARCH_LIMITS,
  type SearchCoverage,
  type SearchMapping,
} from "../shared/content-search";
import { contentSearchFragments, type ContentSearchFragments } from "../shared/content-search-fragments";

interface ContentSearchDocumentVersion {
  handle: string;
  documentId: string;
  revision: number;
  hash: string;
  bufferRevision: number | undefined;
  incarnation?: object;
}

export type ContentSearchDocument = ContentSearchDocumentVersion &
  ({ status: "clean" | "risky" } | { status: "dirty"; raw: string });

interface SearchFailure {
  ok: false;
  reason: "incomplete" | "limit";
}
export type ContentSearchCapture =
  | SearchFailure
  | {
      ok: true;
      documents: readonly ContentSearchDocument[];
      current(): boolean;
    };

export interface ContentSearchHit {
  entry: string;
  from: number;
  to: number;
  source: "disk" | "memory";
}

export type ContentSearchHitGroup = ContentSearchFragments & Pick<ContentSearchHit, "entry" | "source">;

interface SearchEvidence {
  coverage: readonly SearchCoverage[];
  mappings: readonly SearchMapping[];
}
type HitResult = SearchFailure | { ok: true; covered: number; hits: ContentSearchHit[] };
type FragmentResult = SearchFailure | { ok: true; covered: number; groups: ContentSearchHitGroup[] };

/** Combines validated Bun evidence with one unchanged renderer capture. */
export function mergeContentSearch(
  query: string,
  documents: readonly ContentSearchDocument[],
  evidence: SearchEvidence
): HitResult;
export function mergeContentSearch(
  query: string,
  documents: readonly ContentSearchDocument[],
  evidence: SearchEvidence,
  fragments: true
): FragmentResult;
export function mergeContentSearch(
  query: string,
  documents: readonly ContentSearchDocument[],
  evidence: SearchEvidence,
  fragments = false
): HitResult | FragmentResult {
  if (
    documents.length > CONTENT_SEARCH_LIMITS.documents ||
    evidence.coverage.length > CONTENT_SEARCH_LIMITS.documents
  )
    return { ok: false, reason: "limit" };
  const incomplete = { ok: false, reason: "incomplete" } as const;
  if (!query.length || evidence.mappings.length !== documents.length)
    return incomplete;
  if (fragments && evidence.coverage.some((row) => !row.fragments || row.hit))
    return incomplete;

  const coverage = new Map(evidence.coverage.map((row) => [row.entry, row]));
  const mappings = new Map(evidence.mappings.map((row) => [row.handle, row]));
  if (
    coverage.size !== evidence.coverage.length ||
    mappings.size !== evidence.mappings.length ||
    new Set(documents.map(({ handle }) => handle)).size !== documents.length
  )
    return incomplete;

  let bytes = evidence.coverage.reduce((total, row) => total + row.bytes, 0);
  const matched = new Set<string>();
  const replacements = new Map<string, string>();
  for (const document of documents) {
    const mapping = mappings.get(document.handle);
    if (!mapping || mapping.kind === "unresolved") return incomplete;
    if (mapping.kind !== "matched") continue;
    const row = coverage.get(mapping.entry);
    if (
      !row ||
      matched.has(row.entry) ||
      document.status === "risky" ||
      document.documentId !== mapping.documentId ||
      document.revision !== mapping.revision ||
      document.hash !== mapping.hash ||
      mapping.hash !== row.hash
    )
      return incomplete;
    matched.add(row.entry);
    if (document.status !== "dirty") continue;

    const raw = document.raw;
    if (raw.length > CONTENT_SEARCH_LIMITS.bytes)
      return { ok: false, reason: "limit" };
    if (
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        raw
      )
    )
      return incomplete;
    bytes += new TextEncoder().encode(raw).byteLength - row.bytes;
    replacements.set(row.entry, raw);
  }
  if (bytes > CONTENT_SEARCH_LIMITS.bytes)
    return { ok: false, reason: "limit" };

  if (fragments) {
    const groups: ContentSearchHitGroup[] = [];
    for (const row of evidence.coverage) {
      const raw = replacements.get(row.entry);
      const found = raw === undefined ? row.fragments : contentSearchFragments(raw, query);
      if (found?.matches.length)
        groups.push({ entry: row.entry, source: raw === undefined ? "disk" : "memory", ...found });
    }
    return { ok: true, covered: coverage.size, groups };
  }

  const hits: ContentSearchHit[] = [];
  for (const row of evidence.coverage) {
    const raw = replacements.get(row.entry);
    if (raw !== undefined) {
      const from = raw.indexOf(query);
      if (from >= 0)
        hits.push({ entry: row.entry, from, to: from + query.length, source: "memory" });
    } else if (row.hit)
      hits.push({ entry: row.entry, ...row.hit, source: "disk" });
  }
  return { ok: true, covered: coverage.size, hits };
}
