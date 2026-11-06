import {
  isWriteCapability,
  MAX_DOCUMENT_BYTES,
  type DocumentSnapshot,
} from "./documents";
import { hashPattern, validMirror } from "./save-content";
import { isTextFidelity } from "./text-fidelity";

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function isDocumentSnapshot(
  value: unknown,
  maxBytes = MAX_DOCUMENT_BYTES
): value is DocumentSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    (s.mirror === undefined || validMirror(s.mirror)) &&
    typeof s.handle === "string" &&
    UUID.test(s.handle) &&
    typeof s.documentId === "string" &&
    UUID.test(s.documentId) &&
    typeof s.fileName === "string" &&
    s.fileName.length > 0 &&
    s.fileName.length <= 4096 &&
    (s.explicitStandalone === undefined ||
      typeof s.explicitStandalone === "boolean") &&
    (s.displayPath === undefined ||
      (typeof s.displayPath === "string" && s.displayPath.length <= 32768)) &&
    (s.locationId === undefined ||
      (typeof s.locationId === "string" && UUID.test(s.locationId))) &&
    typeof s.revision === "number" &&
    Number.isSafeInteger(s.revision) &&
    s.revision > 0 &&
    typeof s.hash === "string" &&
    hashPattern.test(s.hash) &&
    typeof s.byteLength === "number" &&
    Number.isInteger(s.byteLength) &&
    s.byteLength >= 0 &&
    s.byteLength <= maxBytes &&
    typeof s.text === "string" &&
    s.text.length <= maxBytes &&
    new TextEncoder().encode(s.text).length === s.byteLength &&
    isTextFidelity(s.fidelity, s.text) &&
    isWriteCapability(s.writeCapability)
  );
}
