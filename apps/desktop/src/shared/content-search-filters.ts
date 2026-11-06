import { perfRecord } from "./perf-lab";

export const CONTENT_SEARCH_FILTER_TEXT_LIMIT = 16_384;
export const CONTENT_SEARCH_FILTER_COUNT_LIMIT = 8;
const maxValueLength = 256;
const forbidden = /\p{Cc}|[\uD800-\uDFFF]/u;

export interface ContentSearchPathFilter {
  kind: "path" | "-path";
  value: string;
}
type FilterKind = "file" | ContentSearchPathFilter["kind"];

type FilterParseResult =
  | { ok: true; fileFilters: string[]; pathFilters: ContentSearchPathFilter[] }
  | { ok: false; error: "invalid" | "unsupported" | "limit" };

function validValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxValueLength &&
    !forbidden.test(value)
  );
}

function canonicalRelativePath(path: string): boolean {
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

function validFileValue(value: unknown): value is string {
  return validValue(value) && !value.includes("/");
}

function validPathValue(value: unknown): value is string {
  return (
    validValue(value) &&
    !/^(?:[A-Za-z]:[/\\]|\\\\)/.test(value) &&
    canonicalRelativePath(value.endsWith("/") ? value.slice(0, -1) : value)
  );
}

function denseFilters(value: unknown): value is readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > CONTENT_SEARCH_FILTER_COUNT_LIMIT ||
    Object.keys(value).length !== value.length
  )
    return false;
  for (let index = 0; index < value.length; index++)
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
  return true;
}

export function validContentSearchFileFilters(
  value: unknown
): value is readonly string[] {
  if (!denseFilters(value)) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (!validFileValue(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

export function validContentSearchPathFilters(
  value: unknown
): value is readonly ContentSearchPathFilter[] {
  if (!denseFilters(value)) return false;
  const included = new Set<string>();
  const excluded = new Set<string>();
  for (const item of value) {
    if (
      !perfRecord(item) ||
      Object.keys(item).length !== 2 ||
      !Object.prototype.propertyIsEnumerable.call(item, "kind") ||
      !Object.prototype.propertyIsEnumerable.call(item, "value") ||
      (item.kind !== "path" && item.kind !== "-path") ||
      !validPathValue(item.value)
    )
      return false;
    const seen = item.kind === "path" ? included : excluded;
    if (seen.has(item.value)) return false;
    seen.add(item.value);
  }
  return true;
}

export function parseContentSearchFilters(raw: string): FilterParseResult {
  if (raw.length > CONTENT_SEARCH_FILTER_TEXT_LIMIT)
    return { ok: false, error: "limit" };
  if (/(?!\s)\p{Cc}/u.test(raw)) return { ok: false, error: "invalid" };
  const whitespace = /\s*/uy;
  const kindPrefix = /(file|-?path):/uy;
  const token = /("(?:[^"\\]|\\[\s\S])*"|[^"\s]+)(?=\s|$)/uy;
  const fileFilters: string[] = [];
  const pathFilters: ContentSearchPathFilter[] = [];
  let offset = 0;
  while (offset < raw.length) {
    whitespace.lastIndex = offset;
    whitespace.exec(raw);
    offset = whitespace.lastIndex;
    if (offset === raw.length) break;
    kindPrefix.lastIndex = offset;
    const kind = kindPrefix.exec(raw)?.[1];
    if (kind !== "file" && kind !== "path" && kind !== "-path")
      return { ok: false, error: "unsupported" };
    if (fileFilters.length + pathFilters.length === CONTENT_SEARCH_FILTER_COUNT_LIMIT)
      return { ok: false, error: "limit" };

    token.lastIndex = kindPrefix.lastIndex;
    const match = token.exec(raw);
    if (!match) return { ok: false, error: "invalid" };
    const spelling = match[1];
    let value: unknown = spelling;
    if (spelling.startsWith('"')) {
      try {
        value = JSON.parse(spelling);
      } catch {
        return { ok: false, error: "invalid" };
      }
    }
    if (typeof value === "string" && value.length > maxValueLength)
      return { ok: false, error: "limit" };
    if (kind === "file") {
      if (!validFileValue(value) || fileFilters.includes(value))
        return { ok: false, error: "invalid" };
      fileFilters.push(value);
    } else {
      if (!validPathValue(value) || pathFilters.some((filter) =>
        filter.kind === kind && filter.value === value))
        return { ok: false, error: "invalid" };
      pathFilters.push({ kind, value });
    }
    offset = token.lastIndex;
  }
  return { ok: true, fileFilters, pathFilters };
}

export function formatContentSearchFilter(kind: FilterKind, value: string): string {
  return kind + ":" + JSON.stringify(value);
}

export function matchesContentSearchFileFilters(
  name: string,
  values: readonly string[]
): boolean {
  return values.every((value) => name.includes(value));
}

/** Project trusted POSIX scan paths without normalizing them. */
export function relativeContentSearchPath(root: string, file: string): string | undefined {
  if (!root.startsWith("/") || (root !== "/" && !canonicalRelativePath(root.slice(1))))
    return;
  const prefix = root === "/" ? root : root + "/";
  if (!file.startsWith(prefix)) return;
  const relative = file.slice(prefix.length);
  if (canonicalRelativePath(relative)) return relative;
}

export function matchesContentSearchPathFilters(
  path: string,
  filters: readonly ContentSearchPathFilter[]
): boolean {
  return filters.every(({ kind, value }) =>
    path.includes(value) === (kind === "path")
  );
}
