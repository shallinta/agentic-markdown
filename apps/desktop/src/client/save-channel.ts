import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { rawHash, rawPatch, validMirror } from "../shared/save-content";

export async function incrementalSave(
  request: Omit<SaveDocumentRequest, "content" | "mirror">,
  baseline: DocumentSnapshot,
  text: string,
  send: (request: SaveDocumentRequest) => Promise<unknown>,
  diagnostics: (value: {
    mode: "patch" | "resync";
    payloadBytes: number;
  }) => void
) {
  const targetHash = await rawHash(text);
  let params: SaveDocumentRequest = {
    ...request,
    mirror: baseline.mirror ?? {
      token: baseline.handle,
      revision: 0,
      hash: baseline.hash,
    },
    content: { kind: "patch", ...rawPatch(baseline.text, text), targetHash },
  };
  const transmit = () => {
    diagnostics({
      mode: params.content.kind,
      payloadBytes: new TextEncoder().encode(JSON.stringify(params)).length,
    });
    return send(params);
  };
  let response = await transmit();
  if (response && typeof response === "object") {
    const value = response as Record<string, unknown>;
    if (
      value.protocolVersion === 1 &&
      value.requestId === params.requestId &&
      value.ok === false &&
      value.error === "MIRROR_MISMATCH" &&
      validMirror(value.recovery) &&
      value.recovery.hash === targetHash &&
      value.recovery.revision === request.bufferRevision
    ) {
      params = {
        ...params,
        requestId: crypto.randomUUID(),
        mirror: value.recovery,
        content: { kind: "resync", text, targetHash },
      };
      response = await transmit();
    }
  }
  if (response && typeof response === "object") {
    const value = response as Record<string, unknown>;
    if (value.protocolVersion !== 1 || value.requestId !== params.requestId)
      throw new Error("Invalid save envelope");
    if (value.ok === true) {
      const snapshot = value.snapshot as Record<string, unknown> | undefined;
      if (
        !snapshot ||
        "text" in snapshot ||
        !validMirror(snapshot.mirror) ||
        snapshot.mirror.hash !== targetHash ||
        snapshot.mirror.revision !== request.bufferRevision ||
        snapshot.hash !== targetHash
      )
        throw new Error("Invalid saved content identity");
      return {
        response: { ...value, snapshot: { ...snapshot, text } },
        requestId: params.requestId,
      };
    }
  }
  return { response, requestId: params.requestId };
}
