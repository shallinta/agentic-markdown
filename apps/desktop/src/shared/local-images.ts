/** Adjustable resource protection for the initial local raster consumer. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16 * 1024 * 1024;
export const MAX_IMAGE_CACHE_BYTES = 24 * 1024 * 1024;
export interface LocalImageRequest {
  protocolVersion: 1;
  requestId: string;
  handle: string;
  reference: string;
}
export type LocalImageResult =
  | {
      ok: true;
      mime: "image/png" | "image/jpeg";
      data: string;
      width: number;
      height: number;
      identity: string;
    }
  | { ok: false; error: "UNAVAILABLE" | "INVALID_REQUEST" | "BUSY" };
export type LocalImageResponse = LocalImageResult & {
  protocolVersion: 1;
  requestId: string;
};
export function localImageReference(value: string): string | null {
  if (value.length > 12288) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (
      !decoded ||
      decoded.length > 4096 ||
      [...decoded].some(character=>character.charCodeAt(0)<32 || character.charCodeAt(0)===127) ||
      /[\\?#]/.test(decoded) ||
      decoded.startsWith("/") ||
      /^[a-z][a-z0-9+.-]*:/i.test(decoded)
    )
      return null;
    return decoded;
  } catch {
    return null;
  }
}
export function validLocalImageRequest(
  value: unknown
): value is LocalImageRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    Object.keys(v).length === 4 &&
    v.protocolVersion === 1 &&
    typeof v.requestId === "string" &&
    v.requestId.length > 0 &&
    v.requestId.length <= 80 &&
    typeof v.handle === "string" &&
    /^[a-f0-9-]{36}$/i.test(v.handle) &&
    typeof v.reference === "string" &&
    localImageReference(v.reference) !== null
  );
}
export function validLocalImageResult(
  value: unknown
): value is LocalImageResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.ok === false)
    return (
      Object.keys(v).length === 2 &&
      typeof v.error === "string" &&
      ["UNAVAILABLE", "INVALID_REQUEST", "BUSY"].includes(v.error)
    );
  return (
    Object.keys(v).length === 6 &&
    v.ok === true &&
    (v.mime === "image/png" || v.mime === "image/jpeg") &&
    typeof v.data === "string" &&
    v.data.length > 0 &&
    v.data.length % 4 === 0 &&
    v.data.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(v.data) &&
    typeof v.width === "number" &&
    Number.isSafeInteger(v.width) &&
    v.width > 0 &&
    typeof v.height === "number" &&
    Number.isSafeInteger(v.height) &&
    v.height > 0 &&
    v.width * v.height <= MAX_IMAGE_PIXELS &&
    typeof v.identity === "string" &&
    /^[a-f0-9]{64}$/.test(v.identity)
  );
}
export function validLocalImageResponse(
  value: unknown
): value is LocalImageResponse {
  if (!value || typeof value !== "object") return false;
  const { protocolVersion, requestId, ...result } = value as Record<
    string,
    unknown
  >;
  return (
    protocolVersion === 1 &&
    typeof requestId === "string" &&
    requestId.length > 0 &&
    requestId.length <= 80 &&
    validLocalImageResult(result)
  );
}
