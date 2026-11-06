import { createHash } from "node:crypto";

import {
  RASTER_PASTE_LAB_MAX_BYTES,
  type RasterPasteLabResponse,
} from "../../shared/raster-paste-lab";

export function rasterPasteLabEnabled() {
  return process.env.AGENTIC_MARKDOWN_PERF_LAB === "1" &&
    process.env.AGENTIC_MARKDOWN_PERF_PASTE_IMAGE === "1";
}

export function inspectRasterPaste(input: unknown, enabled: boolean): RasterPasteLabResponse {
  if (!enabled) return { ok: false, error: "DISABLED" };
  const invalid = { ok: false, error: "INVALID" } as const;
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid;
  const keys = Object.keys(input);
  if (keys.length !== 3 || !["protocolVersion", "requestId", "base64"].every(key => keys.includes(key))) return invalid;
  const { protocolVersion, requestId, base64 } = input as Record<string, unknown>;
  if (protocolVersion !== 1 || typeof requestId !== "string" || requestId.length !== 36 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId) ||
      typeof base64 !== "string" || !base64.length || base64.length % 4 !== 0 ||
      base64.length > Math.ceil(RASTER_PASTE_LAB_MAX_BYTES / 3) * 4) return invalid;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const length = base64.length / 4 * 3 - padding;
  if (length > RASTER_PASTE_LAB_MAX_BYTES) return invalid;
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length !== length || bytes.toString("base64") !== base64) return invalid;
  return { ok: true, requestId, bytes: length, sha256: createHash("sha256").update(bytes).digest("hex") };
}
