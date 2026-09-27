import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

export function requestText(
  request: SaveDocumentRequest,
  baseline: DocumentSnapshot
) {
  const c = request.content;
  return c.kind === "resync"
    ? c.text
    : baseline.text.slice(0, c.from) + c.insert + baseline.text.slice(c.to);
}
export function savedReply(
  request: SaveDocumentRequest,
  baseline: DocumentSnapshot
) {
  const text = requestText(request, baseline);
  const { text: _ignored, ...metadata } = baseline;
  void _ignored;
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    ok: true,
    savedBufferRevision: request.bufferRevision,
    snapshot: {
      ...metadata,
      revision: baseline.revision + 1,
      hash: request.content.targetHash,
      mirror: {
        token: crypto.randomUUID(),
        revision: request.bufferRevision,
        hash: request.content.targetHash,
      },
      byteLength: new TextEncoder().encode(text).length,
      fidelity: analyzeTextFidelity(text),
    },
  };
}
export async function waitCaptured(ready: () => boolean) {
  for (let i = 0; i < 100 && !ready(); i++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  if (!ready()) throw new Error("Save request was not captured");
}
