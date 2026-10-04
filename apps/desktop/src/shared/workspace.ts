import type { DocumentRequest, DocumentResponse } from "./documents";

export type ScanStatus =
  "scanning" | "complete" | "partial" | "paused" | "failed";
export interface WorkspaceRoot {
  showHidden?: boolean;
  handle: string;
  name: string;
  displayPath: string;
  generation: number;
  status: ScanStatus;
  examined: number;
  errors: number;
  entries: number;
}
export interface WorkspaceNode {
  handle: string;
  parent: string;
  name: string;
  kind: "directory" | "file";
  /** Display only; never accepted as authority. */
  displayPath: string;
}
export interface WorkspaceRequest extends DocumentRequest {
  op:
    "select" | "state" | "page" | "rescan" | "prioritize" | "clear" | "hidden";
  showHidden?: boolean;
  root?: string;
  entry?: string;
  generation?: number;
  cursor?: number;
}
export interface WorkspaceOpenRequest extends DocumentRequest {
  root: string;
  entry: string;
}
export type WorkspaceResponse = { protocolVersion: 1; requestId: string } & (
  | {
      ok: false;
      error: "INVALID_REQUEST" | "INVALID_HANDLE" | "UNAVAILABLE" | "BUSY";
    }
  | {
      ok: true;
      roots: WorkspaceRoot[];
      /** Existing document handles whose visible sidebar ownership is a root. */
      coveredHandles: string[];
      /** Opaque asset-only invalidation metadata; never authorizes renderer paths. */
      assetEpochs?: Record<string, string>;
      root?: string;
      generation?: number;
      nodes?: WorkspaceNode[];
      nextCursor?: number;
      cacheBytes: number;
      queueBytes?: number;
    }
);
export interface WorkspaceService {
  request(value: unknown): Promise<WorkspaceResponse>;
  open(value: unknown): Promise<DocumentResponse>;
  dispose(): Promise<void>;
}
export const WORKSPACE_PAGE_SIZE = 128;
export const WORKSPACE_MAX_ROOTS = 32;
export const WORKSPACE_CACHE_BYTES = 4 * 1024 * 1024;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function validWorkspaceRequest(
  value: unknown
): value is WorkspaceRequest {
  if (
    !record(value) ||
    value.protocolVersion !== 1 ||
    typeof value.requestId !== "string" ||
    !value.requestId ||
    value.requestId.length > 80
  )
    return false;
  const common = ["protocolVersion", "requestId", "op"];
  const fields =
    value.op === "page"
      ? [...common, "root", "generation", "cursor"]
      : value.op === "hidden"
        ? [...common, "root", "showHidden"]
        : value.op === "rescan"
          ? [...common, "root"]
          : value.op === "prioritize"
            ? [...common, "root", "entry"]
            : common;
  if (
    Object.keys(value).length !== fields.length ||
    !Object.keys(value).every((key) => fields.includes(key))
  )
    return false;
  if (["select", "state", "clear"].includes(value.op as string)) return true;
  if (!uuid(value.root)) return false;
  if (value.op === "hidden") return typeof value.showHidden === "boolean";
  if (value.op === "rescan") return true;
  if (value.op === "prioritize") return uuid(value.entry);
  return (
    value.op === "page" &&
    Number.isSafeInteger(value.generation) &&
    Number(value.generation) > 0 &&
    Number.isSafeInteger(value.cursor) &&
    Number(value.cursor) >= 0
  );
}
export function validWorkspaceOpen(
  value: unknown
): value is WorkspaceOpenRequest {
  return (
    record(value) &&
    Object.keys(value).length === 4 &&
    value.protocolVersion === 1 &&
    typeof value.requestId === "string" &&
    value.requestId.length > 0 &&
    value.requestId.length <= 80 &&
    uuid(value.root) &&
    uuid(value.entry)
  );
}
