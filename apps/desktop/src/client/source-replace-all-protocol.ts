import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import type { SearchOptions } from "./source-search-protocol";

export const ALL_RANGE_LIMIT = 65536;
export const ALL_INSERTED_BREAK_LIMIT = 65536;
export const ALL_LINE_WORK = 5_000_000_000;
export interface ReplaceAllRequest {
  id: number;
  raw: string;
  options: SearchOptions;
  replacement: string;
}
export type ReplaceAllResult = { id: number } & (
  | { kind: "rejected"; reason: "cost" | "size" }
  | { kind: "noop"; matched: number; changed: 0 }
  | {
      kind: "plan";
      matched: number;
      changed: number;
      bytes: number;
      pairs: Uint32Array;
    }
);
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const integer = (x: unknown, max: number): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= max;
export function validReplaceAllRequest(x: unknown): x is ReplaceAllRequest {
  return (
    record(x) &&
    Object.keys(x).length === 4 &&
    integer(x.id, Number.MAX_SAFE_INTEGER) &&
    typeof x.raw === "string" &&
    x.raw.length <= MAX_DOCUMENT_BYTES &&
    typeof x.replacement === "string" &&
    x.replacement.length <= MAX_DOCUMENT_BYTES &&
    record(x.options) &&
    Object.keys(x.options).length === 3 &&
    typeof x.options.query === "string" &&
    x.options.query.length <= MAX_DOCUMENT_BYTES &&
    typeof x.options.caseSensitive === "boolean" &&
    typeof x.options.wholeWord === "boolean"
  );
}
export function validReplaceAllResult(
  x: unknown,
  id: number,
  length: number
): x is ReplaceAllResult {
  if (!record(x) || x.id !== id) return false;
  if (x.kind === "rejected")
    return (
      Object.keys(x).length === 3 &&
      (x.reason === "cost" || x.reason === "size")
    );
  if (!integer(x.matched, length) || !integer(x.changed, x.matched))
    return false;
  if (x.kind === "noop") return Object.keys(x).length === 4 && x.changed === 0;
  if (
    x.kind !== "plan" ||
    Object.keys(x).length !== 6 ||
    !x.changed ||
    !integer(x.bytes, MAX_DOCUMENT_BYTES) ||
    !(x.pairs instanceof Uint32Array) ||
    x.matched > ALL_RANGE_LIMIT ||
    x.pairs.length !== x.matched * 2
  )
    return false;
  let previous = 0;
  for (let i = 0; i < x.pairs.length; i += 2) {
    if (
      x.pairs[i] < previous ||
      x.pairs[i] >= x.pairs[i + 1] ||
      x.pairs[i + 1] > length
    )
      return false;
    previous = x.pairs[i + 1];
  }
  return true;
}
