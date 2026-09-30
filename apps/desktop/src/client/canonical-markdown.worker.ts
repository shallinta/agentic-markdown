import { runCanonicalSample } from "./canonical-markdown";

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  try {
    self.postMessage({ ok: true, row: runCanonicalSample(event.data) });
  } catch {
    self.postMessage({ ok: false });
  }
});
