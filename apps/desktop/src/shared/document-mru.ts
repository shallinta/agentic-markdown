export const MRU_LIMIT = 20;
export const MRU_MAX_BYTES = 256 * 1024;
export const MRU_EXIT_MS = 2000;
export interface MRUEnvelope { protocolVersion: 1; requestId: string }
export interface MRUSessionResponse extends MRUEnvelope { available: boolean; session: string; sequence: number; revision: number }
export interface MRURecordRequest extends MRUEnvelope { session: string; sequence: number; handle: string; documentId: string }
export interface MRUAck extends MRUEnvelope { session: string; sequence: number; status: "persisted" | "unavailable" | "stale"; revision: number }
export interface MRUResolveRequest extends MRUEnvelope { session: string; sequence: number }
export type MRUResolved = { documentId: string; rank: number } & ({ kind: "root"; root: string; generation: number; entry: string } | { kind: "standalone"; handle: string });
export interface MRUResolveResponse extends MRUEnvelope { session: string; sequence: number; revision: number; items: MRUResolved[]; incomplete: boolean }
export interface MRUEntry { documentId: string; path: string; fingerprint: string; rank: number }
export interface MRUData { revision: number; entries: MRUEntry[] }
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && uuid.test(v);
const counter = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
export const isMRUEnvelope = (v: unknown): v is MRUEnvelope => object(v) && Object.keys(v).sort().join() === "protocolVersion,requestId" && v.protocolVersion === 1 && id(v.requestId);
export function isMRURecordRequest(v: unknown): v is MRURecordRequest {
  return object(v) && Object.keys(v).sort().join() === "documentId,handle,protocolVersion,requestId,sequence,session" && v.protocolVersion === 1 && id(v.requestId) && id(v.session) && id(v.handle) && id(v.documentId) && counter(v.sequence) && v.sequence > 0;
}
export function isMRUResolveRequest(v: unknown): v is MRUResolveRequest {
  return object(v) && Object.keys(v).sort().join() === "protocolVersion,requestId,sequence,session" && v.protocolVersion === 1 && id(v.requestId) && id(v.session) && counter(v.sequence) && v.sequence > 0;
}
export function isMRUData(v: unknown): v is MRUData {
  if (!object(v) || Object.keys(v).sort().join() !== "entries,revision" || !counter(v.revision) || !Array.isArray(v.entries) || v.entries.length > MRU_LIMIT) return false;
  const ids = new Set<string>(), paths = new Set<string>();
  return v.entries.every((e: unknown) => {
    if (!object(e) || Object.keys(e).sort().join() !== "documentId,fingerprint,path,rank" || !id(e.documentId) || typeof e.path !== "string" || !e.path.startsWith("/") || e.path.length > 4096 || e.path.includes("\0") || !/\.(md|markdown)$/i.test(e.path) || typeof e.fingerprint !== "string" || !/^\d+:\d+:\d+$/.test(e.fingerprint) || e.fingerprint.length > 200 || !counter(e.rank) || e.rank > Number(v.revision) || ids.has(e.documentId) || paths.has(e.path)) return false;
    ids.add(e.documentId); paths.add(e.path); return true;
  });
}
export function isMRUSessionResponse(v: unknown): v is MRUSessionResponse {
  return object(v) && Object.keys(v).sort().join() === "available,protocolVersion,requestId,revision,sequence,session" && v.protocolVersion === 1 && id(v.requestId) && typeof v.available === "boolean" && (id(v.session) || (!v.available && v.session === "")) && counter(v.sequence) && counter(v.revision);
}
export function isMRUAck(v: unknown): v is MRUAck {
  return object(v) && Object.keys(v).sort().join() === "protocolVersion,requestId,revision,sequence,session,status" && v.protocolVersion === 1 && id(v.requestId) && id(v.session) && counter(v.sequence) && counter(v.revision) && typeof v.status === "string" && ["persisted", "unavailable", "stale"].includes(v.status);
}
export function isMRUResolveResponse(v: unknown): v is MRUResolveResponse {
  if (!object(v) || Object.keys(v).sort().join() !== "incomplete,items,protocolVersion,requestId,revision,sequence,session" || v.protocolVersion !== 1 || !id(v.requestId) || !id(v.session) || !counter(v.sequence) || !counter(v.revision) || typeof v.incomplete !== "boolean" || !Array.isArray(v.items) || v.items.length > MRU_LIMIT) return false;
  const ids=new Set<string>(), targets=new Set<string>();
  return v.items.every((e:unknown)=>{
    if(!object(e)||!id(e.documentId)||!counter(e.rank)||e.rank>Number(v.revision)||ids.has(e.documentId))return false;
    ids.add(e.documentId);
    const target=e.kind==="standalone"?`standalone:${String(e.handle)}`:`root:${String(e.root)}:${String(e.generation)}:${String(e.entry)}`;
    if(targets.has(target))return false;
    targets.add(target);
    return e.kind==="standalone" ? Object.keys(e).sort().join()==="documentId,handle,kind,rank"&&id(e.handle) : e.kind==="root"&&Object.keys(e).sort().join()==="documentId,entry,generation,kind,rank,root"&&id(e.root)&&id(e.entry)&&counter(e.generation);
  });
}
