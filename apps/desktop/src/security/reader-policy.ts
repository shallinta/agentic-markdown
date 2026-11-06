export const PACKAGED_READER_URL = "views://mainview/reader.html";
export const PACKAGED_READER_SNAPSHOT_URL = "views://mainview/reader-snapshot.html";

export function readerNavigationRules(
  url: typeof PACKAGED_READER_URL | typeof PACKAGED_READER_SNAPSHOT_URL = PACKAGED_READER_URL
): string {
  return JSON.stringify(["^*", url === PACKAGED_READER_SNAPSHOT_URL ? url : PACKAGED_READER_URL]);
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

export const READER_SNAPSHOT_CONTENT_SECURITY_POLICY = READER_CONTENT_SECURITY_POLICY.replace(
  "img-src 'none'", "img-src data:"
);
