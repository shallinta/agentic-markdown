import { parseReadingMarkdown } from "../../client/canonical-parser";
import { firstReaderImageCandidate } from "../../client/reader-image-candidate";
import { decodeReaderSnapshot } from "../../shared/reader-snapshot";

self.onmessage = (event: MessageEvent<unknown>) => {
  self.onmessage = null;
  let reference: string | null = null;
  try {
    const input = event.data;
    if (input && typeof input === "object" && !Array.isArray(input) &&
        Object.keys(input).length === 2) {
      const request = input as Record<string, unknown>;
      const text = request.protocolVersion === 1 && typeof request.data === "string"
        ? decodeReaderSnapshot(request.data) : undefined;
      if (text)
        reference = firstReaderImageCandidate(parseReadingMarkdown(text), text.length)?.reference ?? null;
    }
  } catch {
    // An unavailable candidate never causes another occurrence to be selected.
  }
  self.postMessage({ protocolVersion: 1, reference });
};
