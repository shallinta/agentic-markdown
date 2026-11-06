export const RASTER_PASTE_LAB_MAX_BYTES = 1024 * 1024;

export interface RasterPasteLabRequest {
  protocolVersion: 1;
  requestId: string;
  base64: string;
}

export type RasterPasteLabResponse =
  | { ok: true; requestId: string; bytes: number; sha256: string }
  | { ok: false; error: "DISABLED" | "INVALID" };
