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

export interface DocumentSnapshot {
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
  | "CANCELLED";

export type DocumentResponse = {
  protocolVersion: 1;
  requestId: string;
} & (
  | { ok: true; snapshot: DocumentSnapshot | null }
  | { ok: false; error: DocumentErrorCode }
);

export interface DocumentService {
  select(request: unknown): Promise<DocumentResponse>;
  read(request: unknown): Promise<DocumentResponse>;
  release(request: unknown): Promise<DocumentResponse>;
  cancel(request: unknown): Promise<DocumentResponse>;
  dispose(): Promise<void>;
}
