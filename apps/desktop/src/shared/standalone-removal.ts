import type { DocumentRequest } from "./documents";

export interface RemovalOperation {
  session: string;
  sequence: number;
  handle: string;
}
export type RemovalRequest = DocumentRequest &
  (
    | { op: "state" }
    | ({ op: "begin" | "commit" | "query" | "ack" } & RemovalOperation)
  );
export type RemovalStatus =
  | "issued"
  | "committed"
  | "rejected"
  | "unknown"
  | "busy"
  | "stale-session"
  | "acked";
export type RemovalResponse = DocumentRequest &
  (
    | { status: "state"; session: string; sequence: number }
    | { status: RemovalStatus; operation: RemovalOperation }
  );
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
export function validRemovalOperation(v: unknown): v is RemovalOperation {
  return (
    object(v) &&
    Object.keys(v).length === 3 &&
    uuid(v.session) &&
    uuid(v.handle) &&
    Number.isSafeInteger(v.sequence) &&
    Number(v.sequence) > 0
  );
}
export function validRemovalRequest(v: unknown): v is RemovalRequest {
  if (
    !object(v) ||
    v.protocolVersion !== 1 ||
    typeof v.requestId !== "string" ||
    !v.requestId ||
    v.requestId.length > 80
  )
    return false;
  if (v.op === "state") return Object.keys(v).length === 3;
  return (
    ["begin", "commit", "query", "ack"].includes(String(v.op)) &&
    Object.keys(v).length === 6 &&
    validRemovalOperation({
      session: v.session,
      sequence: v.sequence,
      handle: v.handle,
    })
  );
}
export function validRemovalResponse(
  v: unknown,
  request: RemovalRequest
): v is RemovalResponse {
  if (
    !object(v) ||
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
  return (
    Object.keys(v).length === 4 &&
    [
      "issued",
      "committed",
      "rejected",
      "unknown",
      "busy",
      "stale-session",
      "acked",
    ].includes(String(v.status)) &&
    validRemovalOperation(v.operation) &&
    v.operation.session === request.session &&
    v.operation.sequence === request.sequence &&
    v.operation.handle === request.handle
  );
}
