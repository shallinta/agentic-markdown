import type { DocumentRequest, DocumentSnapshot } from "./documents";

export interface CreateTarget { rootHandle: string; generation: number; directoryHandle?: string }
export interface CreateOperation { session: string; sequence: number }
export type CreateMarkdownRequest = DocumentRequest & (
  | { op: "state" }
  | { op: "preview"; target: CreateTarget; name: string; previewId: string }
  | { op: "cancel-preview"; previewId: string }
  | (CreateOperation & { op: "create"; target: CreateTarget; name: string })
  | (CreateOperation & { op: "query" | "retry-open" | "release-unpresented" | "ack" })
);
export type CreateOutcome = "rejected-before-create" | "created" | "opened" | "unknown" | "pending" | "busy" | "stale" | "acked";
export type CreateMarkdownResponse = DocumentRequest & (
  | { status: "state"; session: string; sequence: number }
  | { status: "preview"; previewId: string; result: "available" | "conflict" | "invalid" | "unavailable"; fileName?: string; message?: string }
  | { status: "cancelled-preview"; previewId: string }
  | { status: CreateOutcome; operation: CreateOperation; fileName?: string; message?: string; snapshot?: DocumentSnapshot; entryHandle?: string; released?: boolean }
);
export function markdownFileName(input: string): { ok: true; name: string } | { ok: false; message: string } {
  if (!input.trim() || input === "." || input === ".." || input === ".git" || input.includes("/") || [...input].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) || /[ .]$/.test(input))
    return { ok: false, message: "名称不能为空，不能包含路径分隔符、控制字符或尾随空格和点。" };
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const next = input.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) return { ok: false, message: "名称包含不完整字符。" }; }
    else if (c >= 0xdc00 && c <= 0xdfff) return { ok: false, message: "名称包含不完整字符。" };
  }
  const name = /\.(md|markdown)$/i.test(input) ? input : `${input}.md`;
  if (new TextEncoder().encode(name).length > 255) return { ok: false, message: "文件名过长（最多 255 UTF-8 字节）。" };
  return { ok: true, name };
}
export const markdownNameKey = (name: string) => name.normalize("NFC").toLowerCase();
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const short = (v: unknown): v is string => typeof v === "string" && !!v && v.length <= 80;
function target(v: unknown): v is CreateTarget { return object(v) && Object.keys(v).every(k => ["rootHandle", "generation", "directoryHandle"].includes(k)) && uuid(v.rootHandle) && Number.isSafeInteger(v.generation) && Number(v.generation) > 0 && (v.directoryHandle === undefined || uuid(v.directoryHandle)); }
export function validCreateMarkdownRequest(v: unknown): v is CreateMarkdownRequest {
  if (!object(v) || v.protocolVersion !== 1 || !short(v.requestId)) return false;
  if (v.op === "state") return Object.keys(v).length === 3;
  if (v.op === "cancel-preview") return Object.keys(v).length === 4 && short(v.previewId);
  if (v.op === "preview") return Object.keys(v).length === 6 && short(v.previewId) && target(v.target) && typeof v.name === "string" && v.name.length <= 4096;
  if (!uuid(v.session) || !Number.isSafeInteger(v.sequence) || Number(v.sequence) < 1) return false;
  if (v.op === "create") return Object.keys(v).length === 7 && target(v.target) && typeof v.name === "string" && v.name.length <= 4096;
  return Object.keys(v).length === 5 && ["query", "retry-open", "release-unpresented", "ack"].includes(String(v.op));
}
export function validCreateMarkdownResponse(v: unknown, request: CreateMarkdownRequest): v is CreateMarkdownResponse {
  if (!object(v) || v.protocolVersion !== 1 || v.requestId !== request.requestId) return false;
  if (request.op === "state") return v.status === "state" && uuid(v.session) && Number.isSafeInteger(v.sequence) && Number(v.sequence) > 0;
  if (request.op === "cancel-preview") return v.status === "cancelled-preview" && v.previewId === request.previewId;
  if (request.op === "preview") return v.status === "preview" && v.previewId === request.previewId && ["available", "conflict", "invalid", "unavailable"].includes(String(v.result)) && (v.fileName === undefined || typeof v.fileName === "string") && (v.message === undefined || typeof v.message === "string");
  // Full snapshot validation remains at the document controller's existing boundary.
  return object(v.operation) && v.operation.session === request.session && v.operation.sequence === request.sequence && ["rejected-before-create", "created", "opened", "unknown", "pending", "busy", "stale", "acked"].includes(String(v.status)) && (v.fileName === undefined || typeof v.fileName === "string") && (v.message === undefined || typeof v.message === "string") && (v.entryHandle === undefined || uuid(v.entryHandle)) && (v.released === undefined || typeof v.released === "boolean") && (v.snapshot === undefined || (object(v.snapshot) && uuid(v.snapshot.handle) && uuid(v.snapshot.documentId) && typeof v.snapshot.text === "string"));
}
