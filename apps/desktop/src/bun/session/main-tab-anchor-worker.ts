import { validMainTabCheckpointViewport } from "../../shared/main-tab-checkpoint";

import { encodeMainTabPosition } from "./main-tab-position-codec";
import { createMarkdownBlockAnchorProbe } from "./markdown-block-anchor-probe";

self.onmessage = (event: MessageEvent<unknown>) => {
  self.onmessage = null;
  const input = event.data;
  if (!input || typeof input !== "object" || !("raw" in input) ||
    !("viewport" in input) || typeof input.raw !== "string" ||
    !validMainTabCheckpointViewport(input.viewport)) {
    self.postMessage(undefined);
    return;
  }
  const probe = createMarkdownBlockAnchorProbe(input.raw);
  const position = probe.status === "ready" ? probe.capturePosition(input.viewport) : undefined;
  const stored = position?.anchor && encodeMainTabPosition(position);
  self.postMessage(stored);
};
