import { WORKSPACE_MAX_ROOTS } from "./workspace";

export interface RootRosterEntry {
  id: string;
  path: string;
  name: string;
}
export type RootRosterFailure =
  | "legacy"
  | "future"
  | "corrupt"
  | "too-large"
  | "io"
  | "capacity"
  | "invalid"
  | "closed"
  | "queue-full"
  | "unknown"
  | "busy";
export type RootRosterRequest =
  | { protocolVersion: 1; op: "list" }
  | { protocolVersion: 1; op: "remove"; id: string };
export interface RootRosterResponse {
  protocolVersion: 1;
  pending: readonly RootRosterEntry[];
  readOnly: boolean;
  failure?: RootRosterFailure;
}
export const validRootRosterId = (id: unknown): id is string =>
  typeof id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
export function validRootRosterRequest(
  value: unknown
): value is RootRosterRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as RootRosterRequest;
  if (r.protocolVersion !== 1) return false;
  return r.op === "list"
    ? Object.keys(r).sort().join() === "op,protocolVersion"
    : r.op === "remove" &&
        Object.keys(r).sort().join() === "id,op,protocolVersion" &&
        validRootRosterId(r.id);
}
export function validRootRosterResponse(
  value: unknown
): value is RootRosterResponse {
  if (!value || typeof value !== "object") return false;
  const r = value as RootRosterResponse;
  if (
    Object.keys(r).some(
      (k) => !["protocolVersion", "pending", "readOnly", "failure"].includes(k)
    ) ||
    r.protocolVersion !== 1 ||
    typeof r.readOnly !== "boolean" ||
    !Array.isArray(r.pending) ||
    r.pending.length > WORKSPACE_MAX_ROOTS ||
    (r.failure !== undefined &&
      ![
        "legacy",
        "future",
        "corrupt",
        "too-large",
        "io",
        "capacity",
        "invalid",
        "closed",
        "queue-full",
        "unknown",
        "busy",
      ].includes(r.failure))
  )
    return false;
  const ids = new Set<string>(),
    paths = new Set<string>();
  return r.pending.every((item: unknown) => {
    const e = item as RootRosterEntry | null;
    if (
      !e ||
      typeof e !== "object" ||
      Object.keys(e).sort().join() !== "id,name,path" ||
      !validRootRosterId(e.id) ||
      typeof e.path !== "string" ||
      !e.path.startsWith("/") ||
      e.path.length > 4096 ||
      e.path.includes("\0") ||
      typeof e.name !== "string" ||
      !e.name.length ||
      e.name.length > 1024 ||
      e.name.includes("\0") ||
      ids.has(e.id) ||
      paths.has(e.path)
    )
      return false;
    ids.add(e.id);
    paths.add(e.path);
    return true;
  });
}
