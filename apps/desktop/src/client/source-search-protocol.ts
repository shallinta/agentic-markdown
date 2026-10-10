import { MAX_DOCUMENT_BYTES } from "../shared/documents";

export const SEARCH_LIMIT = MAX_DOCUMENT_BYTES;
export const SEARCH_MARK_LIMIT = 2048;
export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}
export type SearchRequest = { epoch: string; id: number } & (
  | { kind: "scan"; text?: string; options: SearchOptions; position: number }
  | { kind: "viewport"; from: number; to: number }
  | { kind: "navigate"; direction: number }
);
export interface SearchResult {
  epoch: string;
  id: number;
  kind: SearchRequest["kind"];
  count: number;
  index: number;
  current: [number, number] | null;
  ranges: number[];
  limited: boolean;
}
const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const integer = (n: unknown, max = SEARCH_LIMIT): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;
export function validSearchRequest(v: unknown): v is SearchRequest {
  if (
    !record(v) ||
    typeof v.epoch !== "string" ||
    v.epoch.length > 100 ||
    !integer(v.id, Number.MAX_SAFE_INTEGER)
  )
    return false;
  const keys =
    v.kind === "scan"
      ? ["epoch", "id", "kind", "text", "options", "position"]
      : v.kind === "viewport"
        ? ["epoch", "id", "kind", "from", "to"]
        : ["epoch", "id", "kind", "direction"];
  if (Object.keys(v).some((key) => !keys.includes(key))) return false;
  if (v.kind === "scan")
    return (
      (v.text === undefined ||
        (typeof v.text === "string" && v.text.length <= SEARCH_LIMIT)) &&
      integer(v.position) &&
      record(v.options) &&
      Object.keys(v.options).length === 3 &&
      typeof v.options.query === "string" &&
      v.options.query.length <= SEARCH_LIMIT &&
      typeof v.options.caseSensitive === "boolean" &&
      typeof v.options.wholeWord === "boolean"
    );
  if (v.kind === "viewport")
    return integer(v.from) && integer(v.to) && v.from <= v.to;
  return (
    v.kind === "navigate" &&
    typeof v.direction === "number" &&
    Number.isSafeInteger(v.direction) &&
    Math.abs(v.direction) <= SEARCH_LIMIT
  );
}
export function validSearchResult(
  v: unknown,
  request: SearchRequest,
  length: number
): v is SearchResult {
  if (
    !record(v) ||
    Object.keys(v).length !== 8 ||
    v.epoch !== request.epoch ||
    v.id !== request.id ||
    v.kind !== request.kind ||
    !integer(v.count, length) ||
    !Number.isInteger(v.index) ||
    typeof v.index !== "number" ||
    v.index < -1 ||
    v.index >= v.count ||
    (v.count === 0) !== (v.index === -1) ||
    typeof v.limited !== "boolean" ||
    !Array.isArray(v.ranges) ||
    v.ranges.length > SEARCH_MARK_LIMIT * 2 ||
    v.ranges.length > v.count * 2 ||
    v.ranges.length % 2
  )
    return false;
  const pair = (a: unknown, b: unknown) =>
    integer(a, length) && integer(b, length) && a < b;
  if (
    v.count === 0
      ? v.current !== null
      : !Array.isArray(v.current) ||
        v.current.length !== 2 ||
        !pair(v.current[0], v.current[1])
  )
    return false;
  let end = -1;
  for (let i = 0; i < v.ranges.length; i += 2) {
    if (!pair(v.ranges[i], v.ranges[i + 1]) || v.ranges[i] < end) return false;
    end = Number(v.ranges[i + 1]);
  }
  return true;
}
