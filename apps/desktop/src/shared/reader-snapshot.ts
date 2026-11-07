import { MAX_DOCUMENT_BYTES } from "./documents";

export const READER_SNAPSHOT_MAX_BYTES = MAX_DOCUMENT_BYTES;
export const READER_SNAPSHOT_EVENT = "agentic-markdown:reader-snapshot";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const uuidV4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type SnapshotDelivery =
  | { text: string; deliveryId?: string; kind?: never }
  | { text: string; kind: "buffer"; deliveryId?: string };

export function isReaderSnapshotDeliveryId(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && uuidV4.test(value);
}

export function readerSnapshotOwnValue(record: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value : undefined;
}

export function isCanonicalBase64(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || value.length % 4 !== 0 ||
      value.length > Math.ceil(maxBytes / 3) * 4) return false;

  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const end = value.length - padding;
  if (value.length / 4 * 3 - padding > maxBytes ||
      /[^A-Za-z0-9+/]/.test(value.slice(0, end))) return false;

  // The trailing partial sextet must have its unused bits cleared.
  return padding === 0 || (alphabet.indexOf(value.charAt(end - 1)) &
    (padding === 2 ? 15 : 3)) === 0;
}

/** Fixed one-way delivery expression for the isolated, already loaded reader. */
export function readerSnapshotDeliveryScript(base64: string, deliveryId?: string): string | undefined {
  if (!isCanonicalBase64(base64, READER_SNAPSHOT_MAX_BYTES)) return undefined;
  if (deliveryId !== undefined && !isReaderSnapshotDeliveryId(deliveryId)) return undefined;
  const detail = deliveryId === undefined ? base64 : { protocolVersion: 1, deliveryId, data: base64 };
  return snapshotEventScript(detail);
}

export function prepareReaderBufferSnapshotDelivery(base64: string, imageDeliveryId?: string) {
  const text = decodeReaderSnapshot(base64);
  if (text === undefined || (imageDeliveryId !== undefined && !isReaderSnapshotDeliveryId(imageDeliveryId)))
    return undefined;
  const deliveryId = text.includes("![") ? imageDeliveryId : undefined;
  const script = snapshotEventScript({ protocolVersion: 1, kind: "buffer", data: base64,
    ...(deliveryId ? { deliveryId } : {}) });
  return { script, deliveryId };
}

function snapshotEventScript(detail: string | {
  protocolVersion: number; deliveryId: string; data: string;
} | { protocolVersion: number; kind: "buffer"; data: string; deliveryId?: string }): string {
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(READER_SNAPSHOT_EVENT)}, {detail: ${JSON.stringify(detail)}}));`;
}

export function decodeReaderSnapshot(value: unknown): string | undefined {
  if (!isCanonicalBase64(value, READER_SNAPSHOT_MAX_BYTES)) return undefined;
  try {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** Only the body delivery can bind the expected image ID for this reader. */
export function decodeReaderSnapshotDelivery(value: unknown): SnapshotDelivery | undefined {
  if (typeof value === "string") {
    const text = decodeReaderSnapshot(value);
    return text === undefined ? undefined : { text };
  }
  if (typeof value !== "object" || value === null) return undefined;
  try {
    if (Array.isArray(value) || readerSnapshotOwnValue(value, "protocolVersion") !== 1) return undefined;
    const fields = Reflect.ownKeys(value).length;
    if (readerSnapshotOwnValue(value, "kind") === "buffer") {
      if (fields !== 3 && fields !== 4) return undefined;
      const deliveryId = readerSnapshotOwnValue(value, "deliveryId");
      if (fields === 4 && !isReaderSnapshotDeliveryId(deliveryId)) return undefined;
      const text = decodeReaderSnapshot(readerSnapshotOwnValue(value, "data"));
      if (text === undefined || (fields === 4 && !text.includes("!["))) return undefined;
      return { text, kind: "buffer", ...(isReaderSnapshotDeliveryId(deliveryId) ? { deliveryId } : {}) };
    }
    if (fields !== 3) return undefined;
    const deliveryId = readerSnapshotOwnValue(value, "deliveryId");
    if (!isReaderSnapshotDeliveryId(deliveryId)) return undefined;
    const text = decodeReaderSnapshot(readerSnapshotOwnValue(value, "data"));
    return text === undefined ? undefined : { text, deliveryId };
  } catch {
    return undefined;
  }
}
