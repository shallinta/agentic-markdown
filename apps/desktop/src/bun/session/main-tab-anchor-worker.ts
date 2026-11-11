import { validMainTabCheckpointViewport } from "../../shared/main-tab-checkpoint";

import { decodeMainTabPosition, encodeMainTabPosition } from "./main-tab-position-codec";
import { createMarkdownBlockAnchorProbe } from "./markdown-block-anchor-probe";

self.onmessage = (event: MessageEvent<unknown>) => {
  self.onmessage = null;
  self.postMessage(handleAnchorRequest(event.data));
};

function handleAnchorRequest(input: unknown) {
  if (!input || typeof input !== "object" || !("raw" in input) ||
      typeof input.raw !== "string" || Object.keys(input).length !== 2) return;
  if ("viewport" in input && validMainTabCheckpointViewport(input.viewport)) {
    const probe = createMarkdownBlockAnchorProbe(input.raw);
    if (probe.status !== "ready") return;
    const position = probe.capturePosition(input.viewport);
    if (position?.anchor) return encodeMainTabPosition(position);
  } else if ("position" in input) {
    const receipt = decodeMainTabPosition(input.position);
    if (!receipt?.anchor) return;
    const probe = createMarkdownBlockAnchorProbe(input.raw);
    if (probe.status !== "ready") return;
    const resolved = probe.resolvePosition(receipt);
    if (resolved.status === "block" || resolved.status === "neighbor") {
      return {
        from: resolved.from,
        offset: resolved.status === "block" ? resolved.offset ?? 0 : 0,
        ratio: receipt.ratio,
      };
    }
  }
}
