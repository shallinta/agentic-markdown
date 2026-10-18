import { markdownFileName, type CreateOperation, type CreateTarget } from "./create-markdown";
import type { DocumentRequest } from "./documents";

export type CreateFolderRequest = DocumentRequest & (
  | { op: "state" }
  | { op: "preview"; target: CreateTarget; name: string; previewId: string }
  | { op: "cancel-preview"; previewId: string }
  | (CreateOperation & { op: "create"; target: CreateTarget; name: string })
  | (CreateOperation & { op: "query" | "retry-locate" | "ack" })
);
export type CreateFolderOutcome = "pending" | "rejected-before-create" | "created" | "unknown" | "busy" | "stale" | "acked";
export type CreateFolderResponse = DocumentRequest & (
  | { status: "state"; session: string; sequence: number }
  | { status: "preview"; previewId: string; result: "available" | "conflict" | "invalid" | "unavailable"; name?: string; message?: string }
  | { status: "cancelled-preview"; previewId: string }
  | { status: CreateFolderOutcome; operation: CreateOperation; working: boolean; name?: string; message?: string; entryHandle?: string }
);
export function folderName(input: string): { ok: true; name: string } | { ok: false; message: string } {
  // Use the same component validation without the Markdown extension policy.
  const checked = markdownFileName(input, false);
  return checked.ok ? { ok: true, name: checked.name } : checked;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(v);
const short = (v: unknown): v is string => typeof v === "string" && !!v && v.length <= 80;
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
function target(v: unknown): v is CreateTarget { return object(v) && keys(v,["rootHandle","generation","directoryHandle"]) && uuid(v.rootHandle) && Number.isSafeInteger(v.generation) && Number(v.generation)>0 && (v.directoryHandle===undefined || uuid(v.directoryHandle)); }
export function validCreateFolderRequest(v: unknown): v is CreateFolderRequest {
  if(!object(v)||v.protocolVersion!==1||!short(v.requestId))return false;
  if(v.op==="state")return Object.keys(v).length===3;
  if(v.op==="cancel-preview")return Object.keys(v).length===4&&short(v.previewId);
  if(v.op==="preview")return Object.keys(v).length===6&&target(v.target)&&typeof v.name==="string"&&v.name.length<=4096&&short(v.previewId);
  if(!uuid(v.session)||!Number.isSafeInteger(v.sequence)||Number(v.sequence)<1)return false;
  if(v.op==="create")return Object.keys(v).length===7&&target(v.target)&&typeof v.name==="string"&&v.name.length<=4096;
  return Object.keys(v).length===5&&["query","retry-locate","ack"].includes(String(v.op));
}
export function validCreateFolderResponse(v: unknown, request: CreateFolderRequest): v is CreateFolderResponse {
  if(!object(v)||v.protocolVersion!==1||v.requestId!==request.requestId)return false;
  const base=["protocolVersion","requestId","status"];
  if(request.op==="state")return keys(v,[...base,"session","sequence"])&&v.status==="state"&&uuid(v.session)&&Number.isSafeInteger(v.sequence)&&Number(v.sequence)>0;
  if(request.op==="cancel-preview")return keys(v,[...base,"previewId"])&&v.status==="cancelled-preview"&&v.previewId===request.previewId;
  if(request.op==="preview")return keys(v,[...base,"previewId","result","name","message"])&&v.status==="preview"&&v.previewId===request.previewId&&["available","conflict","invalid","unavailable"].includes(String(v.result))&&(v.name===undefined||typeof v.name==="string")&&(v.message===undefined||typeof v.message==="string");
  return keys(v,[...base,"operation","working","name","message","entryHandle"])&&object(v.operation)&&Object.keys(v.operation).length===2&&v.operation.session===request.session&&v.operation.sequence===request.sequence&&["pending","rejected-before-create","created","unknown","busy","stale","acked"].includes(String(v.status))&&typeof v.working==="boolean"&&(v.name===undefined||typeof v.name==="string")&&(v.message===undefined||typeof v.message==="string")&&(v.entryHandle===undefined||uuid(v.entryHandle));
}
