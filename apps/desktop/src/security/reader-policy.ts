export const PACKAGED_READER_URL = "views://mainview/reader.html";

export function readerNavigationRules(): string {
  return JSON.stringify(["^*", PACKAGED_READER_URL]);
}

export const READER_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self' views://mainview",
  "script-src-attr 'none'",
  "style-src 'self' views://mainview",
  "worker-src blob:",
  "connect-src 'none'",
  "img-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");
