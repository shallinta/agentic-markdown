import type { TextFidelity } from "./text-fidelity";

/** Temporary safety boundary for the F-003a full-snapshot verification UI. */
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export const DOCUMENT_PROTOCOL_VERSION = 1;

export interface DocumentRequest {
  protocolVersion: 1;
  requestId: string;
}

export interface DocumentHandleRequest extends DocumentRequest {
  handle: string;
}

export interface SaveDocumentRequest extends DocumentHandleRequest {
  documentId: string;
  expectedRevision: number;
  expectedHash: string;
  bufferRevision: number;
  mirror: BufferMirrorIdentity;
  content:
    | {
        kind: "patch";
        from: number;
        to: number;
        insert: string;
        targetHash: string;
      }
    | { kind: "resync"; text: string; targetHash: string };
}

export interface BufferMirrorIdentity {
  token: string;
  revision: number;
  hash: string;
}
export type SaveDocumentResponse = { protocolVersion: 1; requestId: string } & (
  | {
      ok: true;
      snapshot: Omit<DocumentSnapshot, "text">;
      savedBufferRevision: number;
    }
  | { ok: false; error: DocumentErrorCode; recovery?: BufferMirrorIdentity }
);

export interface DocumentSavesSettledResponse {
  protocolVersion: 1;
  requestId: string;
  settled: boolean;
}

export type WriteCapability =
  | { writable: true; reason: "writable" }
  | { writable: false; reason: "readonly" | "unavailable" | "invalid" };

export interface WriteCapabilityResponse {
  protocolVersion: 1;
  requestId: string;
  handle: string;
  capability: WriteCapability;
}

export function isWriteCapability(value: unknown): value is WriteCapability {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).length === 2 &&
    (item.writable === true
      ? item.reason === "writable"
      : item.writable === false &&
        typeof item.reason === "string" &&
        ["readonly", "unavailable", "invalid"].includes(item.reason))
  );
}

export interface DocumentSnapshot {
  mirror?: BufferMirrorIdentity;
  handle: string;
  documentId: string;
  fileName: string;
  /** Opaque canonical-path key, never a path or a read capability. */
  locationId?: string;
  /** Display only; cannot be submitted as a read capability. */
  displayPath?: string;
  revision: number;
  hash: string;
  byteLength: number;
  text: string;
  fidelity: TextFidelity;
  writeCapability: WriteCapability;
}

export type DocumentErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_HANDLE"
  | "UNSUPPORTED_FILE"
  | "TOO_LARGE"
  | "INVALID_UTF8"
  | "FILE_CHANGED"
  | "READ_FAILED"
  | "BUSY"
  | "CONFLICT"
  | "SAVE_FAILED"
  | "SAVE_UNCERTAIN"
  | "UNSUPPORTED_SAVE"
  | "READ_ONLY"
  | "CANCELLED"
  | "MIRROR_MISMATCH";

export type DocumentResponse = {
  protocolVersion: 1;
  requestId: string;
} & (
  | {
      ok: true;
      snapshot: DocumentSnapshot | null;
      savedBufferRevision?: number;
    }
  | { ok: false; error: DocumentErrorCode }
);

export interface DocumentService {
  checkWriteCapability(request: unknown): Promise<WriteCapabilityResponse>;
  waitForSaves(request: unknown): Promise<DocumentSavesSettledResponse>;
  save(request: unknown): Promise<SaveDocumentResponse>;
  withWriteBarrier(action: () => Promise<boolean>): Promise<boolean>;
  select(request: unknown): Promise<DocumentResponse>;
  read(request: unknown): Promise<DocumentResponse>;
  release(request: unknown): Promise<DocumentResponse>;
  cancel(request: unknown): Promise<DocumentResponse>;
  dispose(): Promise<void>;
}
