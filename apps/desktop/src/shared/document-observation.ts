export type ObservationStatus = "unchanged" | "content-changed" | "missing" | "replaced" | "unavailable";
export interface ObservationBinding {
  protocolVersion: 1;
  handle: string;
  documentId: string;
  revision: number;
  hash: string;
  watchToken: string;
  watchEpoch: number;
}
export interface ObservationRequest extends ObservationBinding { active: boolean; requestId: string; }
export interface ObservationEvent extends ObservationBinding { generation: number; status: ObservationStatus; }
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function binding(value: unknown): value is ObservationBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return v.protocolVersion === 1 && [v.handle, v.documentId, v.watchToken].every(x => typeof x === "string" && uuid.test(x)) && Number.isSafeInteger(v.watchEpoch) && Number(v.watchEpoch) > 0 && Number.isSafeInteger(v.revision) && Number(v.revision) > 0 && typeof v.hash === "string" && /^[a-f0-9]{64}$/.test(v.hash);
}
export function validObservationRequest(value: unknown): value is ObservationRequest {
  return binding(value) && Object.keys(value).length === 9 && "active" in value && typeof value.active === "boolean" && "requestId" in value && typeof value.requestId === "string" && value.requestId.length > 0 && value.requestId.length <= 80;
}
export function validObservationEvent(value: unknown): value is ObservationEvent {
  return binding(value) && Object.keys(value).length === 9 && "generation" in value && Number.isSafeInteger(value.generation) && Number(value.generation) > 0 && "status" in value && typeof value.status === "string" && ["unchanged", "content-changed", "missing", "replaced", "unavailable"].includes(value.status);
}
export const observationText: Record<ObservationStatus, string> = {
  unchanged: "",
  "content-changed": "磁盘内容已变化，当前显示未更新，内存内容仍保留。",
  missing: "原文件不存在，内存内容仍保留。关闭前请确认是否放弃。",
  replaced: "原路径文件已替换，当前仍是原文档的内存内容。",
  unavailable: "暂无法检查文件，当前内存内容仍保留。",
};
