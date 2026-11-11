import { isDocumentSnapshot } from "./document-snapshot";
import type { DocumentSnapshot } from "./documents";
import { validRootRosterId } from "./root-roster";

export type MainTabRecoveryRequest = {
  protocolVersion: 1;
  requestId: string;
} & (
  | { op: "open"; root: string; generation: number; expectedRootId: string }
  | { op: "finish"; adopted: boolean }
  | { op: "pair-item"; index: 0 | 1 }
);
export type MainTabRecoveryResponse = {
  protocolVersion: 1;
  requestId: string;
} & (
  | {
      status: "ready";
      snapshot: DocumentSnapshot;
      mode: "editing" | "source";
      pinned: boolean;
    }
  | { status: "pair"; activeIndex: 0 | 1 }
  | {
      status: "pair-item";
      index: 0 | 1;
      snapshot: DocumentSnapshot;
      mode: "editing" | "source";
      pinned: boolean;
    }
  | { status: "finished" | "rejected" | "unknown" }
);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export function validMainTabRecoveryRequest(
  v: unknown
): v is MainTabRecoveryRequest {
  if (
    !object(v) ||
    v.protocolVersion !== 1 ||
    typeof v.requestId !== "string" ||
    !v.requestId.length ||
    v.requestId.length > 80
  )
    return false;
  if (v.op === "pair-item")
    return (
      Object.keys(v).sort().join() === "index,op,protocolVersion,requestId" &&
      (v.index === 0 || v.index === 1)
    );
  if (v.op === "finish")
    return (
      Object.keys(v).sort().join() === "adopted,op,protocolVersion,requestId" &&
      typeof v.adopted === "boolean"
    );
  return (
    v.op === "open" &&
    Object.keys(v).sort().join() ===
      "expectedRootId,generation,op,protocolVersion,requestId,root" &&
    validRootRosterId(v.root) &&
    validRootRosterId(v.expectedRootId) &&
    Number.isSafeInteger(v.generation) &&
    Number(v.generation) >= 1
  );
}
export function validMainTabRecoveryResponse(
  v: unknown,
  requestId: string
): v is MainTabRecoveryResponse {
  if (!object(v) || v.protocolVersion !== 1 || v.requestId !== requestId)
    return false;
  if (v.status === "pair")
    return (
      Object.keys(v).sort().join() ===
        "activeIndex,protocolVersion,requestId,status" &&
      (v.activeIndex === 0 || v.activeIndex === 1)
    );
  if (v.status === "ready" || v.status === "pair-item")
    return (
      Object.keys(v).sort().join() ===
        (v.status === "ready"
          ? "mode,pinned,protocolVersion,requestId,snapshot,status"
          : "index,mode,pinned,protocolVersion,requestId,snapshot,status") &&
      (v.status === "ready" || v.index === 0 || v.index === 1) &&
      isDocumentSnapshot(v.snapshot) &&
      v.snapshot.explicitStandalone === false &&
      (v.mode === "editing" || v.mode === "source") &&
      typeof v.pinned === "boolean"
    );
  return (
    Object.keys(v).sort().join() === "protocolVersion,requestId,status" &&
    ["finished", "rejected", "unknown"].includes(String(v.status))
  );
}
