import type { DocumentTransport } from "../client/documents";

import { electrobun } from "./electrobun";

export function createNativeDocumentTransport(): DocumentTransport {
    const rpc = electrobun.rpc;
    const unavailable = () => Promise.reject(new Error("RPC unavailable"));
    return {
      removeStandalone: request => rpc ? rpc.request.removeStandalone(request) : unavailable(),
      observeDocument: (request) =>
        rpc
          ? rpc.request.observeDocument(request, { maxRequestTime: 4000 })
          : unavailable(),
      openWorkspaceDocument: (request) =>
        rpc ? rpc.request.openWorkspaceDocument(request) : unavailable(),
      checkDocumentWriteCapability: (request) =>
        rpc
          ? rpc.request.checkDocumentWriteCapability(request, {
              maxRequestTime: 4000,
            })
          : unavailable(),
      cancelDocument: (request) =>
        rpc ? rpc.request.cancelDocument(request) : unavailable(),
      selectDocument: (request) =>
        rpc ? rpc.request.selectDocument(request) : unavailable(),
      revealDocument: (request) =>
        rpc ? rpc.request.revealDocument(request) : unavailable(),
      openDefaultDocument: (request) =>
        rpc ? rpc.request.openDefaultDocument(request) : unavailable(),
      readDocument: (request) =>
        rpc ? rpc.request.readDocument(request) : unavailable(),
      saveDocument: (request) =>
        rpc ? rpc.request.saveDocument(request) : unavailable(),
      waitForDocumentSaves: (request) =>
        rpc ? rpc.request.waitForDocumentSaves(request) : unavailable(),
      releaseDocument: (request) =>
        rpc ? rpc.request.releaseDocument(request) : unavailable(),
    };
}
