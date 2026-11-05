import { perfRecord, perfUuid } from "./perf-lab";

export const SEARCH_LAB_QUERY_LIMIT = 4096;

interface Envelope {
  protocolVersion: 1;
  requestId: string;
}
interface Scope {
  root: string;
  generation: number;
}
interface Hit {
  entry: string;
  from: number;
  to: number;
}
const searchErrors = [
  "DISABLED",
  "INVALID",
  "NOT_READY",
  "STALE",
  "LIMIT",
  "BUSY",
  "CANCELLED",
  "UNKNOWN",
  "UNAVAILABLE",
] as const;
type SearchError = (typeof searchErrors)[number];

export type SearchLabRequest = Envelope &
  (
    | { op: "prepare" | "stop" }
    | { op: "cancel"; targetRequestId: string }
    | ({ op: "query"; query: string } & Scope)
  );

export type SearchLabResponse =
  | {
      protocolVersion: 1;
      requestId: string | null;
      ok: false;
      error: SearchError;
    }
  | (Envelope & { ok: true } & (
        | ({ op: "prepare" } & Scope)
        | ({ op: "query"; hits: Hit[] } & Scope)
        | { op: "cancel" | "stop" }
      ));

function exact(value: Record<string, unknown>, ...keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function natural(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function validSearchLabRequest(
  value: unknown
): value is SearchLabRequest {
  if (
    !perfRecord(value) ||
    value.protocolVersion !== 1 ||
    !perfUuid(value.requestId)
  )
    return false;
  const base = ["protocolVersion", "requestId", "op"];
  switch (value.op) {
    case "prepare":
    case "stop":
      return exact(value, ...base);
    case "cancel":
      return (
        exact(value, ...base, "targetRequestId") &&
        perfUuid(value.targetRequestId)
      );
    case "query":
      return (
        exact(value, ...base, "root", "generation", "query") &&
        perfUuid(value.root) &&
        natural(value.generation) &&
        typeof value.query === "string" &&
        value.query.length <= SEARCH_LAB_QUERY_LIMIT &&
        value.query.trim().length > 0 &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          value.query
        )
      );
    default:
      return false;
  }
}

export function validSearchLabResponse(
  value: unknown,
  request: SearchLabRequest
): value is SearchLabResponse {
  if (
    !perfRecord(value) ||
    value.protocolVersion !== 1 ||
    value.requestId !== request.requestId
  )
    return false;
  const base = ["protocolVersion", "requestId", "ok"];
  if (value.ok === false)
    return (
      exact(value, ...base, "error") &&
      searchErrors.some((error) => error === value.error)
    );
  if (value.ok !== true || value.op !== request.op) return false;
  if (request.op === "cancel" || request.op === "stop")
    return exact(value, ...base, "op");
  if (!perfUuid(value.root) || !natural(value.generation)) return false;
  if (request.op === "prepare")
    return exact(value, ...base, "op", "root", "generation");
  if (
    request.op !== "query" ||
    !exact(value, ...base, "op", "root", "generation", "hits") ||
    value.root !== request.root ||
    value.generation !== request.generation ||
    !Array.isArray(value.hits) ||
    value.hits.length > 16
  )
    return false;
  const entries = new Set<string>();
  for (const hit of value.hits) {
    if (
      !perfRecord(hit) ||
      !exact(hit, "entry", "from", "to") ||
      !perfUuid(hit.entry) ||
      entries.has(hit.entry) ||
      !natural(hit.from) ||
      !natural(hit.to) ||
      hit.to - hit.from !== request.query.length ||
      hit.to > 65_536
    )
      return false;
    entries.add(hit.entry);
  }
  return true;
}
