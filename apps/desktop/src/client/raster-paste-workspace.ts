import { relativeContentSearchPath } from "../shared/content-search-filters";
import {
  parseRasterPasteResponse,
  RASTER_PASTE_MAX_BYTES,
  type RasterPasteRequest,
} from "../shared/raster-paste";

import type { RasterPasteAuthority, RasterPasteTransport } from "./raster-paste-intent";
import type { FolderState } from "./workspace";

interface WorkspaceState {
  getSnapshot(): FolderState;
  subscribe(this: void, listener: () => void): () => void;
}

/** Display paths identify which root generations to observe in the renderer.
 * Only the covered handle is passed to the Bun write authority. */
export function captureRasterWorkspaceAuthority(
  workspace: WorkspaceState, handle: string, documentPath: string | undefined
): RasterPasteAuthority | undefined {
  if (!documentPath) return undefined;
  const capture = (state: FolderState) => {
    const epoch = state.assetEpochs?.[handle];
    if (state.busy || !epoch || !state.coveredHandles.includes(handle)) return undefined;
    const roots = state.roots.filter(root => relativeContentSearchPath(root.displayPath, documentPath));
    if (!roots.length || roots.some(root => root.status !== "complete")) return undefined;
    return { epoch, roots: new Map(roots.map(root => [root.handle, root.generation])) };
  };
  const expected = capture(workspace.getSnapshot());
  if (!expected) return undefined;
  return {
    current() {
      const latest = capture(workspace.getSnapshot());
      return latest?.epoch === expected.epoch && latest.roots.size === expected.roots.size &&
        [...expected.roots].every(([key, generation]) => latest.roots.get(key) === generation);
    },
    subscribe: workspace.subscribe,
  };
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 8192)
    binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(binary);
}

export function createRasterPasteTransport(options: {
  getFloor: () => Promise<unknown>;
  publish: (request: RasterPasteRequest) => Promise<unknown>;
}): RasterPasteTransport {
  let sequence: number | undefined;
  return async (source, bytes, current) => {
    if (!bytes.length || bytes.length > RASTER_PASTE_MAX_BYTES)
      return { ok: false, error: "INVALID" };
    if (!current()) return { ok: false, error: "CANCELLED" };
    if (sequence === undefined) {
      try {
        const floor = await options.getFloor();
        if (!floor || typeof floor !== "object" || Reflect.ownKeys(floor).length !== 2)
          return { ok: false, error: "UNAVAILABLE" };
        const ok: unknown = Object.getOwnPropertyDescriptor(floor, "ok")?.value;
        const last: unknown = Object.getOwnPropertyDescriptor(floor, "sequence")?.value;
        if (ok !== true || typeof last !== "number" || !Number.isSafeInteger(last) || last < 0)
          return { ok: false, error: "UNAVAILABLE" };
        sequence = last;
      } catch {
        return { ok: false, error: "UNAVAILABLE" };
      }
    }
    if (sequence >= Number.MAX_SAFE_INTEGER) return { ok: false, error: "UNAVAILABLE" };
    if (!current()) return { ok: false, error: "CANCELLED" };
    const data = base64(bytes);
    const requestId = crypto.randomUUID();
    if (!current()) return { ok: false, error: "CANCELLED" };
    const receipt = parseRasterPasteResponse(await options.publish({
      protocolVersion: 1,
      requestId,
      sequence: ++sequence,
      handle: source.handle,
      documentId: source.documentId,
      expectedRevision: source.expectedRevision,
      expectedHash: source.expectedHash,
      data,
    }), requestId);
    if (receipt?.ok === false && receipt.error === "STALE") sequence = undefined;
    return receipt;
  };
}
