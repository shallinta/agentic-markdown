import { validRootRosterId } from "./root-roster";
import { hashPattern } from "./save-content";

export const MAIN_TAB_METADATA_MAX_TABS = 64;
export interface MainTabSourceInput {
  handle: string;
  documentId: string;
  revision: number;
  hash: string;
  pinned: boolean;
  mode: "editing" | "source";
}
export interface MainTabCheckpointRequest {
  protocolVersion: 1;
  tabs: readonly MainTabSourceInput[];
  activeIndex: number;
}
export interface MainTabCheckpointResponse {
  protocolVersion: 1;
  status: "committed" | "rejected" | "unknown";
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function validMainTabCheckpointRequest(
  value: unknown
): value is MainTabCheckpointRequest {
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== "activeIndex,protocolVersion,tabs" ||
    value.protocolVersion !== 1 ||
    !validMainTabSourceTabs(value.tabs) ||
    value.tabs.length < 1 ||
    typeof value.activeIndex !== "number" ||
    !Number.isSafeInteger(value.activeIndex) ||
    value.activeIndex < 0 ||
    value.activeIndex >= value.tabs.length
  )
    return false;
  return true;
}

export function validMainTabSourceTabs(
  value: unknown
): value is readonly MainTabSourceInput[] {
  if (!Array.isArray(value) || value.length > MAIN_TAB_METADATA_MAX_TABS)
    return false;
  const handles = new Set<string>(),
    ids = new Set<string>();
  for (const tab of value as unknown[]) {
    if (
      !object(tab) ||
      Object.keys(tab).sort().join() !==
        "documentId,handle,hash,mode,pinned,revision" ||
      !validRootRosterId(tab.handle) ||
      !validRootRosterId(tab.documentId) ||
      typeof tab.revision !== "number" ||
      !Number.isSafeInteger(tab.revision) ||
      tab.revision < 1 ||
      typeof tab.hash !== "string" ||
      !hashPattern.test(tab.hash) ||
      typeof tab.pinned !== "boolean" ||
      (tab.mode !== "editing" && tab.mode !== "source") ||
      handles.has(tab.handle) ||
      ids.has(tab.documentId)
    )
      return false;
    handles.add(tab.handle);
    ids.add(tab.documentId);
  }
  return true;
}
export function validMainTabCheckpointResponse(
  value: unknown
): value is MainTabCheckpointResponse {
  return (
    object(value) &&
    Object.keys(value).sort().join() === "protocolVersion,status" &&
    value.protocolVersion === 1 &&
    (value.status === "committed" ||
      value.status === "rejected" ||
      value.status === "unknown")
  );
}
