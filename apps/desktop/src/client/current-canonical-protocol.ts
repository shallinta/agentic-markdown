import { CANONICAL_CONFIG } from "../shared/canonical-corpus";
import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import type { parseCanonicalMarkdown } from "./canonical-parser";

export { CANONICAL_CONFIG };
export interface CanonicalRequest {
  requestId: number;
  documentId: string;
  revision: number;
  config: string;
  text: string;
}
export interface CanonicalResult {
  requestId: number;
  documentId: string;
  revision: number;
  config: string;
  tree: ReturnType<typeof parseCanonicalMarkdown>;
  milliseconds: number;
}
export function isCanonicalRequest(value: unknown): value is CanonicalRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as CanonicalRequest;
  return (
    Number.isSafeInteger(request.requestId) &&
    request.requestId > 0 &&
    typeof request.documentId === "string" &&
    request.documentId.length > 0 &&
    request.documentId.length <= 200 &&
    Number.isSafeInteger(request.revision) &&
    request.revision >= 0 &&
    request.config === CANONICAL_CONFIG &&
    typeof request.text === "string" &&
    request.text.length <= MAX_DOCUMENT_BYTES &&
    new TextEncoder().encode(request.text).length <= MAX_DOCUMENT_BYTES
  );
}
