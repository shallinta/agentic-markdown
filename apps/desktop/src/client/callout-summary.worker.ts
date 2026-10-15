import { BomAwareParser } from "./bom-aware-parser";
import { calloutDefinitions } from "./callout-definitions";
import { isCalloutSummaryRequest } from "./callout-summary-protocol";
import { documentMarkdownParser } from "./markdown-grammar";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data;
  try {
    if (!isCalloutSummaryRequest(request))
      throw Error("Invalid callout request");
    // Same LF coordinate normalization as editorText, without importing editor UI.
    const text = request.text.replace(/\r\n?/g, "\n");
    const tree = new BomAwareParser(documentMarkdownParser).parse(text);
    self.postMessage({
      requestId: request.requestId,
      documentId: request.documentId,
      revision: request.revision,
      config: request.config,
      definitions: calloutDefinitions(tree, text),
    });
  } catch {
    self.postMessage({ error: true });
  }
});
