import type { DocumentRequest } from "./documents";
import type { WorkspaceRoot } from "./workspace";

export interface FolderRemovalOperation {
  session: string;
  sequence: number;
  root: string;
}
export interface OpenFolderDocument {
  handle: string;
  documentId: string;
}
export interface FolderRemovalDocument extends OpenFolderDocument {
  fileName: string;
  explicitStandalone: boolean;
}
export interface FolderRemovalPublication {
  root: string;
  closed: string[];
  revoked: string[];
  standalone: string[];
  roots: WorkspaceRoot[];
  coveredHandles: string[];
  assetEpochs: Record<string, string>;
  cacheBytes: number;
  queueBytes: number;
}
export type FolderRemovalRequest = DocumentRequest &
  (
    | { op: "state" }
    | (FolderRemovalOperation & {
        op: "prepare";
        generation: number;
        documents: OpenFolderDocument[];
      })
    | (FolderRemovalOperation & { op: "commit"; decision: "keep" | "close" })
    | (FolderRemovalOperation & { op: "cancel" | "query" | "ack" })
  );
export type FolderRemovalResponse = DocumentRequest &
  (
    | { status: "state"; session: string; sequence: number }
    | {
        status: "issued";
        operation: FolderRemovalOperation;
        documents: FolderRemovalDocument[];
      }
    | {
        status: "committed";
        operation: FolderRemovalOperation;
        publication: FolderRemovalPublication;
      }
    | {
        status:
          | "rejected"
          | "pending"
          | "unknown"
          | "busy"
          | "stale-session"
          | "acked";
        operation: FolderRemovalOperation;
      }
  );
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
function uniqueHandles(items: unknown[]): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    if (!record(item) || !uuid(item.handle) || seen.has(item.handle)) return false;
    seen.add(item.handle);
  }
  return true;
}
export function validFolderRemovalRequest(
  v: unknown
): v is FolderRemovalRequest {
  if (
    !record(v) ||
    v.protocolVersion !== 1 ||
    typeof v.requestId !== "string" ||
    !v.requestId ||
    v.requestId.length > 80
  )
    return false;
  if (v.op === "state") return Object.keys(v).length === 3;
  if (
    !uuid(v.session) ||
    !uuid(v.root) ||
    !Number.isSafeInteger(v.sequence) ||
    Number(v.sequence) <= 0
  )
    return false;
  if (v.op === "prepare")
    return (
      Object.keys(v).length === 8 &&
      Number.isSafeInteger(v.generation) &&
      Number(v.generation) > 0 &&
      Array.isArray(v.documents) &&
      v.documents.length <= 32768 &&
      v.documents.every(
        (item) =>
          record(item) &&
          Object.keys(item).length === 2 &&
          uuid(item.handle) &&
          uuid(item.documentId)
      ) &&
      uniqueHandles(v.documents)
    );
  if (v.op === "commit")
    return (
      Object.keys(v).length === 7 &&
      (v.decision === "keep" || v.decision === "close")
    );
  return (
    Object.keys(v).length === 6 &&
    ["cancel", "query", "ack"].includes(String(v.op))
  );
}

export function validFolderRemovalResponse(
  v: unknown,
  request: FolderRemovalRequest
): v is FolderRemovalResponse {
  if (
    !record(v) ||
    v.protocolVersion !== 1 ||
    v.requestId !== request.requestId
  )
    return false;
  if (request.op === "state")
    return (
      Object.keys(v).length === 5 &&
      v.status === "state" &&
      uuid(v.session) &&
      Number.isSafeInteger(v.sequence) &&
      Number(v.sequence) > 0
    );
  const op = v.operation;
  if (
    !record(op) ||
    Object.keys(op).length !== 3 ||
    op.root !== request.root ||
    op.session !== request.session ||
    op.sequence !== request.sequence
  )
    return false;
  if (v.status === "issued")
    return (
      Object.keys(v).length === 5 &&
      Array.isArray(v.documents) &&
      v.documents.length <= 32768 &&
      v.documents.every(
        (item) =>
          record(item) &&
          Object.keys(item).length === 4 &&
          uuid(item.handle) &&
          uuid(item.documentId) &&
          typeof item.fileName === "string" &&
          item.fileName.length <= 4096 &&
          typeof item.explicitStandalone === "boolean"
      ) &&
      uniqueHandles(v.documents)
    );
  if (v.status !== "committed")
    return (
      Object.keys(v).length === 4 &&
      [
        "rejected",
        "pending",
        "unknown",
        "busy",
        "stale-session",
        "acked",
      ].includes(String(v.status))
    );
  const p = v.publication;
  if (
    Object.keys(v).length !== 5 ||
    !record(p) ||
    Object.keys(p).length !== 9 ||
    p.root !== request.root
  )
    return false;
  const handles = (list: unknown): list is string[] =>
    Array.isArray(list) &&
    list.length <= 32768 &&
    list.every(uuid) &&
    new Set(list).size === list.length;
  if (
    !handles(p.closed) ||
    !handles(p.revoked) ||
    !handles(p.standalone) ||
    !handles(p.coveredHandles)
  )
    return false;
  const revoked = p.revoked,
    closed = p.closed;
  if (
    p.standalone.some(
      (handle) => revoked.includes(handle) || closed.includes(handle)
    )
  )
    return false;
  if (
    !record(p.assetEpochs) ||
    Object.keys(p.assetEpochs).length > 32768 ||
    !Object.entries(p.assetEpochs).every(
      ([handle, epoch]) => uuid(handle) && uuid(epoch)
    )
  )
    return false;
  if (
    p.revoked.some((handle) =>
      Object.prototype.hasOwnProperty.call(p.assetEpochs, handle)
    )
  )
    return false;
  const integer = (value: unknown): value is number =>
    Number.isSafeInteger(value) && Number(value) >= 0;
  if (
    !integer(p.cacheBytes) ||
    p.cacheBytes > 4 * 1024 * 1024 ||
    !integer(p.queueBytes)
  )
    return false;
  if (!Array.isArray(p.roots) || p.roots.length > 32) return false;
  return (
    p.roots.every(
      (root) =>
        record(root) &&
        Object.keys(root).every((key) =>
          [
            "handle",
            "name",
            "displayPath",
            "generation",
            "status",
            "examined",
            "errors",
            "entries",
            "showHidden",
            "observation",
          ].includes(key)
        ) &&
        uuid(root.handle) &&
        root.handle !== request.root &&
        typeof root.name === "string" &&
        root.name.length <= 4096 &&
        typeof root.displayPath === "string" &&
        root.displayPath.length <= 4096 &&
        integer(root.generation) &&
        root.generation > 0 &&
        integer(root.examined) &&
        integer(root.errors) &&
        integer(root.entries) &&
        ["scanning", "complete", "partial", "paused", "failed"].includes(
          String(root.status)
        ) &&
        (root.showHidden === undefined ||
          typeof root.showHidden === "boolean") &&
        (root.observation === undefined ||
          (typeof root.observation === "string" &&
          ["establishing", "watching", "limited", "unavailable"].includes(
            root.observation
          )))
    ) && uniqueHandles(p.roots)
  );
}
