export const RASTER_PASTE_MAX_BYTES = 1024 * 1024;

export interface RasterPasteRequest {
  protocolVersion: 1;
  requestId: string;
  sequence: number;
  handle: string;
  documentId: string;
  expectedRevision: number;
  expectedHash: string;
  data: string;
}

const errors = [
  "INVALID", "STALE", "BUSY", "ADMITTED_BUSY", "UNAUTHORIZED",
  "READ_ONLY", "CONFLICT", "UNKNOWN", "UNAVAILABLE",
] as const;
export type RasterPasteError = (typeof errors)[number];
export type RasterPasteResponse =
  | { ok: true; requestId: string; relativePath: string }
  | { ok: false; requestId: string | null; error: RasterPasteError };
export type RasterPasteSequenceResponse =
  | { ok: true; sequence: number }
  | { ok: false; error: "UNAVAILABLE" };

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier = (value: unknown, pattern = uuid): value is string =>
  typeof value === "string" && value.length === 36 && pattern.test(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

function own(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value : undefined;
}

export function rasterPasteRequestId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  try {
    const id = own(value, "requestId");
    return identifier(id, uuidV4) ? id : null;
  } catch { return null; }
}

function validData(value: unknown): value is string {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0 ||
      value.length > Math.ceil(RASTER_PASTE_MAX_BYTES / 3) * 4) return false;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const end = value.length - padding;
  return value.length / 4 * 3 - padding <= RASTER_PASTE_MAX_BYTES &&
    !/[^A-Za-z0-9+/]/.test(value.slice(0, end)) &&
    (!padding || (alphabet.indexOf(value.charAt(end - 1)) & (padding === 2 ? 15 : 3)) === 0);
}

export function parseRasterPasteRequest(value: unknown): RasterPasteRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    if (Array.isArray(value) || Reflect.ownKeys(value).length !== 8 ||
        own(value, "protocolVersion") !== 1) return undefined;
    const requestId = own(value, "requestId"), sequence = own(value, "sequence");
    const handle = own(value, "handle"), documentId = own(value, "documentId");
    const expectedRevision = own(value, "expectedRevision"), expectedHash = own(value, "expectedHash");
    const data = own(value, "data");
    if (!identifier(requestId, uuidV4) || !positive(sequence) ||
        !identifier(handle) || !identifier(documentId) || !positive(expectedRevision) ||
        typeof expectedHash !== "string" || expectedHash.length !== 64 || !/^[0-9a-f]+$/.test(expectedHash) ||
        !validData(data)) return undefined;
    return { protocolVersion: 1, requestId, sequence, handle, documentId, expectedRevision, expectedHash, data };
  } catch { return undefined; }
}

export function validRasterPastePath(relativePath: unknown): relativePath is string {
  return typeof relativePath === "string" && [55, 57].includes(relativePath.length) &&
    /^\.\/assets\/image-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:-[2-4])?\.(?:png|jpg)$/.test(relativePath);
}

export function parseRasterPasteResponse(value: unknown, expectedRequestId: string): RasterPasteResponse | undefined {
  if (!value || typeof value !== "object") return undefined;
  try {
    if (Array.isArray(value) || Reflect.ownKeys(value).length !== 3) return undefined;
    const requestId = own(value, "requestId"), ok = own(value, "ok");
    if (!identifier(requestId, uuidV4) || requestId !== expectedRequestId) return undefined;
    if (ok === false) {
      const code = own(value, "error");
      const error = errors.find(candidate => candidate === code);
      return error ? { ok, requestId, error } : undefined;
    }
    const relativePath = own(value, "relativePath");
    if (ok !== true || !validRasterPastePath(relativePath)) return undefined;
    return { ok, requestId, relativePath };
  } catch { return undefined; }
}
