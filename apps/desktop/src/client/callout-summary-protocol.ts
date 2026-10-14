import { MAX_DOCUMENT_BYTES } from "../shared/documents";
import { MARKDOWN_GRAMMAR } from "../shared/markdown-profile";

export const CALLOUT_SUMMARY_CONFIG = `${MARKDOWN_GRAMMAR}:callout-definitions-1`;
export type CalloutDefinitions = ReadonlySet<string>;
export interface CalloutSummaryRequest {
  requestId: number;
  documentId: string;
  revision: number;
  config: typeof CALLOUT_SUMMARY_CONFIG;
  text: string;
}
export interface CalloutSummaryResponse {
  requestId: number;
  documentId: string;
  revision: number;
  config: typeof CALLOUT_SUMMARY_CONFIG;
  definitions: readonly unknown[];
}
export function isCalloutSummaryRequest(
  value: unknown
): value is CalloutSummaryRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<CalloutSummaryRequest>;
  return (
    Number.isSafeInteger(request.requestId) &&
    request.requestId! > 0 &&
    typeof request.documentId === "string" &&
    request.documentId.length > 0 &&
    request.documentId.length <= 200 &&
    Number.isSafeInteger(request.revision) &&
    request.revision! >= 0 &&
    request.config === CALLOUT_SUMMARY_CONFIG &&
    typeof request.text === "string" &&
    request.text.length <= MAX_DOCUMENT_BYTES &&
    new TextEncoder().encode(request.text).length <= MAX_DOCUMENT_BYTES
  );
}
export function isCalloutSummaryResponse(
  value: unknown
): value is CalloutSummaryResponse {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<CalloutSummaryResponse>;
  return (
    Number.isSafeInteger(result.requestId) &&
    result.requestId! > 0 &&
    typeof result.documentId === "string" &&
    Number.isSafeInteger(result.revision) &&
    result.revision! >= 0 &&
    result.config === CALLOUT_SUMMARY_CONFIG &&
    Array.isArray(result.definitions)
  );
}
