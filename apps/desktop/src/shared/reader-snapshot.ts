export const READER_SNAPSHOT_MAX_BYTES = 64 * 1024;
export const READER_SNAPSHOT_EVENT = "agentic-markdown:reader-snapshot";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function isCanonicalBase64(value: unknown): value is string {
  if (typeof value !== "string" || value.length % 4 !== 0 ||
      value.length > Math.ceil(READER_SNAPSHOT_MAX_BYTES / 3) * 4) return false;

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const end = value.length - padding;
  if (value.length / 4 * 3 - padding > READER_SNAPSHOT_MAX_BYTES ||
      /[^A-Za-z0-9+/]/.test(value.slice(0, end))) return false;

  // The trailing partial sextet must have its unused bits cleared.
  return padding === 0 || (alphabet.indexOf(value.charAt(end - 1)) &
    (padding === 2 ? 15 : 3)) === 0;
}

/** Fixed one-way delivery expression for the isolated, already loaded reader. */
export function readerSnapshotDeliveryScript(base64: string): string | undefined {
  if (!isCanonicalBase64(base64)) return undefined;
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(READER_SNAPSHOT_EVENT)}, {detail: ${JSON.stringify(base64)}}));`;
}

export function decodeReaderSnapshot(value: unknown): string | undefined {
  if (!isCanonicalBase64(value)) return undefined;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
