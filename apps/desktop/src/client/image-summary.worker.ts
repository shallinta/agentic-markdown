import { summarizeImages } from "./image-summary";
import { isImageSummaryRequest } from "./image-summary-protocol";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (!isImageSummaryRequest(event.data)) {
    self.postMessage(null);
    return;
  }
  const { text, ...identity } = event.data;
  try {
    self.postMessage({ ...identity, summary: summarizeImages(text) });
  } catch {
    self.postMessage(null);
  }
});
