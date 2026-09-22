export type DiscardReason = "quit" | "reload" | "update";
export interface DiscardRequest {
  protocolVersion: 1;
  requestId: string;
  reason: DiscardReason;
}
export interface DiscardResponse {
  protocolVersion: 1;
  requestId: string;
  allow: boolean;
}
export interface ReloadCommitRequest {
  protocolVersion: 1;
  requestId: string;
}
export interface ReloadCommitResponse extends ReloadCommitRequest {
  committed: boolean;
}
export function isReloadCommitRequest(
  value: unknown
): value is ReloadCommitRequest {
  return (
    record(value) &&
    Object.keys(value).length === 2 &&
    value.protocolVersion === 1 &&
    typeof value.requestId === "string" &&
    uuid.test(value.requestId)
  );
}
export function isReloadCommitResponse(
  value: unknown,
  requestId: string
): value is ReloadCommitResponse {
  return (
    record(value) &&
    Object.keys(value).length === 3 &&
    value.protocolVersion === 1 &&
    value.requestId === requestId &&
    typeof value.committed === "boolean"
  );
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function isDiscardRequest(value: unknown): value is DiscardRequest {
  return (
    record(value) &&
    Object.keys(value).length === 3 &&
    value.protocolVersion === 1 &&
    typeof value.requestId === "string" &&
    uuid.test(value.requestId) &&
    (value.reason === "quit" ||
      value.reason === "reload" ||
      value.reason === "update")
  );
}
export function isDiscardResponse(
  value: unknown,
  requestId: string
): value is DiscardResponse {
  return (
    record(value) &&
    Object.keys(value).length === 3 &&
    value.protocolVersion === 1 &&
    value.requestId === requestId &&
    typeof value.allow === "boolean"
  );
}
