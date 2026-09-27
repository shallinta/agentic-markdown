import { MAX_DOCUMENT_BYTES, type BufferMirrorIdentity } from "./documents";

export const hashPattern = /^[a-f0-9]{64}$/;
export function validMirror(value: unknown): value is BufferMirrorIdentity {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).length === 3 &&
    typeof item.token === "string" &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(item.token) &&
    Number.isSafeInteger(item.revision) &&
    (item.revision as number) >= 0 &&
    typeof item.hash === "string" &&
    hashPattern.test(item.hash)
  );
}
export function rawBoundary(text: string, offset: number) {
  return !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text[offset - 1]) &&
    /[\uDC00-\uDFFF]/.test(text[offset])
  );
}
export function rawPatch(before: string, after: string) {
  let from = 0,
    oldEnd = before.length,
    newEnd = after.length;
  while (from < oldEnd && from < newEnd && before[from] === after[from]) from++;
  while (!rawBoundary(before, from) || !rawBoundary(after, from)) from--;
  while (
    oldEnd > from &&
    newEnd > from &&
    before[oldEnd - 1] === after[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  while (!rawBoundary(before, oldEnd) || !rawBoundary(after, newEnd)) {
    oldEnd++;
    newEnd++;
  }
  return { from, to: oldEnd, insert: after.slice(from, newEnd) };
}
export async function rawHash(text: string) {
  const bytes = new TextEncoder().encode(text);
  if (
    bytes.length > MAX_DOCUMENT_BYTES ||
    new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes) !== text
  )
    throw new Error("Invalid raw content");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}
