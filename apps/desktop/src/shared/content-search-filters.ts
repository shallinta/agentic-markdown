export const CONTENT_SEARCH_FILTER_TEXT_LIMIT = 16_384;
const maxFilters = 8;
const maxValueLength = 256;
const forbidden = /[/\p{Cc}]|[\uD800-\uDFFF]/u;

type FilterParseResult =
  | { ok: true; values: string[] }
  | { ok: false; error: "invalid" | "unsupported" | "limit" };

function validValue(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxValueLength &&
    !forbidden.test(value)
  );
}

export function validContentSearchFileFilters(
  value: unknown
): value is readonly string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > maxFilters ||
    Object.keys(value).length !== value.length
  )
    return false;
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index++) {
    const item: unknown = value[index];
    if (
      !Object.prototype.hasOwnProperty.call(value, index) ||
      !validValue(item) ||
      seen.has(item)
    )
      return false;
    seen.add(item);
  }
  return true;
}

export function parseContentSearchFileFilters(raw: string): FilterParseResult {
  if (raw.length > CONTENT_SEARCH_FILTER_TEXT_LIMIT)
    return { ok: false, error: "limit" };
  if (/(?!\s)\p{Cc}/u.test(raw)) return { ok: false, error: "invalid" };
  const whitespace = /\s*/uy;
  const token = /file:("(?:[^"\\]|\\[\s\S])*"|[^"\s]+)(?=\s|$)/uy;
  const values: string[] = [];
  let offset = 0;
  while (offset < raw.length) {
    whitespace.lastIndex = offset;
    whitespace.exec(raw);
    offset = whitespace.lastIndex;
    if (offset === raw.length) break;
    if (!raw.startsWith("file:", offset))
      return { ok: false, error: "unsupported" };
    if (values.length === maxFilters) return { ok: false, error: "limit" };

    token.lastIndex = offset;
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
    if (!validValue(value) || values.includes(value))
      return { ok: false, error: "invalid" };
    values.push(value);
    offset = token.lastIndex;
  }
  return { ok: true, values };
}

export function formatContentSearchFileFilter(value: string): string {
  return "file:" + JSON.stringify(value);
}

export function matchesContentSearchFileFilters(
  name: string,
  values: readonly string[]
): boolean {
  return values.every((value) => name.includes(value));
}
