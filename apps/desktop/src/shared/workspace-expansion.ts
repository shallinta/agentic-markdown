import { validRootRosterId } from "./root-roster";

export const EXPANSION_MAX_DIRS_PER_ROOT = 1024;
export const EXPANSION_MAX_DIRS = 4096;
export const EXPANSION_MAX_BYTES = 1024 * 1024;
export const EXPANSION_MAX_PATH_LENGTH = 4096;
interface Identity {
  protocolVersion: 1;
  root: string;
  generation: number;
}
export type WorkspaceExpansionRequest = Identity &
  ({ op: "read" } | { op: "set"; expanded: boolean; directory?: string });
export type WorkspaceExpansionResponse =
  | (Identity & {
      ok: true;
      op: "read";
      collapsed: boolean;
      expanded: string[];
    })
  | (Identity & { ok: true; op: "set" })
  | { protocolVersion: 1; ok: false; error: "stale" | "unavailable" };
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
const identity = (r: Identity) =>
  r.protocolVersion === 1 &&
  validRootRosterId(r.root) &&
  Number.isSafeInteger(r.generation) &&
  r.generation > 0;
export function validWorkspaceExpansionRequest(
  value: unknown
): value is WorkspaceExpansionRequest {
  if (!value || typeof value !== "object") return false;
  const r = value as WorkspaceExpansionRequest;
  if (!identity(r)) return false;
  const base = ["protocolVersion", "root", "generation", "op"];
  return r.op === "read"
    ? exact(r, base)
    : r.op === "set" &&
        typeof r.expanded === "boolean" &&
        (r.directory === undefined || validRootRosterId(r.directory)) &&
        exact(r, [
          ...base,
          "expanded",
          ...(r.directory === undefined ? [] : ["directory"]),
        ]);
}
export function validWorkspaceExpansionResponse(
  value: unknown,
  request?: WorkspaceExpansionRequest
): value is WorkspaceExpansionResponse {
  if (!value || typeof value !== "object") return false;
  const r = value as WorkspaceExpansionResponse;
  if (r.protocolVersion !== 1) return false;
  if (r.ok !== true)
    return (
      r.ok === false &&
      exact(r, ["protocolVersion", "ok", "error"]) &&
      (r.error === "stale" || r.error === "unavailable")
    );
  if (
    !identity(r) ||
    (request &&
      (request.root !== r.root ||
        request.generation !== r.generation ||
        request.op !== r.op))
  )
    return false;
  const base = ["protocolVersion", "root", "generation", "op", "ok"];
  return r.op === "set"
    ? exact(r, base)
    : r.op === "read" &&
        exact(r, [...base, "collapsed", "expanded"]) &&
        typeof r.collapsed === "boolean" &&
        Array.isArray(r.expanded) &&
        r.expanded.length <= EXPANSION_MAX_DIRS_PER_ROOT &&
        Array.from(r.expanded).every(validRootRosterId) &&
        new Set(r.expanded).size === r.expanded.length;
}
