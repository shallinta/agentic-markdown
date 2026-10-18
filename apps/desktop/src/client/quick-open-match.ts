export const QUERY_LIMIT = 4096;
export function normalizeQuery(value: string): string | null {
  if (value.length > QUERY_LIMIT) return null;
  const normalized = value.trim().normalize("NFC").toLowerCase();
  return normalized.length <= QUERY_LIMIT ? normalized : null;
}
export function matchField(query: readonly string[], raw: string, field: number): number[] | null {
  if (raw.length > QUERY_LIMIT) return null;
  const value = Array.from(raw.normalize("NFC").toLowerCase());
  let position = 0, first = -1, last = -1;
  for (const character of query) {
    while (position < value.length && value[position] !== character) position++;
    if (position === value.length) return null;
    if (first < 0) first = position;
    last = position++;
  }
  const span = last - first + 1, gaps = span - query.length;
  const rank = first === 0 && gaps === 0 ? (query.length === value.length ? 0 : 1) : 2;
  return [rank, field, gaps, span, first];
}
export function compareScore(a: readonly number[], b: readonly number[]) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
