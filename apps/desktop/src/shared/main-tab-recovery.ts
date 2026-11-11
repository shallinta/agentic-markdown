import { isDocumentSnapshot } from "./document-snapshot";
import type { DocumentSnapshot } from "./documents";
import { MAIN_TAB_METADATA_MAX_TABS } from "./main-tab-checkpoint";
import { validRootRosterId } from "./root-roster";

export type MainTabRecoveryRequest = {
  protocolVersion: 1;
  requestId: string;
} & (
  | { op: "open"; root: string; generation: number; expectedRootId: string }
  | { op: "finish"; adopted: boolean }
  | { op: "group-item"; index: number }
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
  | { status: "group"; count: number; activeIndex: number }
  | {
      status: "group-item";
      index: number;
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
  if (v.op === "group-item")
    return (
      Object.keys(v).sort().join() === "index,op,protocolVersion,requestId" &&
      Number.isSafeInteger(v.index) &&
      Number(v.index) >= 0 &&
      Number(v.index) < MAIN_TAB_METADATA_MAX_TABS
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
  if (v.status === "group")
    return (
      Object.keys(v).sort().join() ===
        "activeIndex,count,protocolVersion,requestId,status" &&
      Number.isSafeInteger(v.count) &&
      Number(v.count) >= 2 &&
      Number(v.count) <= MAIN_TAB_METADATA_MAX_TABS &&
      Number.isSafeInteger(v.activeIndex) &&
      Number(v.activeIndex) >= 0 &&
      Number(v.activeIndex) < Number(v.count)
    );
  if (v.status === "ready" || v.status === "group-item")
    return (
      Object.keys(v).sort().join() ===
        (v.status === "ready"
          ? "mode,pinned,protocolVersion,requestId,snapshot,status"
          : "index,mode,pinned,protocolVersion,requestId,snapshot,status") &&
      (v.status === "ready" ||
        (Number.isSafeInteger(v.index) &&
          Number(v.index) >= 0 &&
          Number(v.index) < MAIN_TAB_METADATA_MAX_TABS)) &&
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
