import { parseCanonicalMarkdown } from "./canonical-parser";
import { isCanonicalRequest } from "./current-canonical-protocol";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  try {
    if (!isCanonicalRequest(request))
      throw Error("Invalid current canonical request");
    const start = performance.now();
    const tree = parseCanonicalMarkdown(request.text);
    self.postMessage({
      ok: true,
      result: {
        requestId: request.requestId,
        documentId: request.documentId,
        revision: request.revision,
        config: request.config,
        tree,
        milliseconds: performance.now() - start,
      },
    });
  } catch {
    self.postMessage({ ok: false });
  }
});
