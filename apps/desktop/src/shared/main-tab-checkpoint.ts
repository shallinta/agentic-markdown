import { MAX_DOCUMENT_BYTES } from "./documents";
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
export interface MainTabCheckpointViewport {
  from: number;
  offset: number;
  ratio: number;
}
export interface MainTabCheckpointSourceInput extends MainTabSourceInput {
  viewport?: MainTabCheckpointViewport;
  resetViewport?: true;
}
export function validMainTabCheckpointViewport(
  value: unknown
): value is MainTabCheckpointViewport {
  return (
    object(value) &&
    Object.keys(value).sort().join() === "from,offset,ratio" &&
    typeof value.from === "number" &&
    Number.isSafeInteger(value.from) &&
    value.from >= 0 &&
    value.from <= MAX_DOCUMENT_BYTES &&
    !Object.is(value.from, -0) &&
    typeof value.offset === "number" &&
    Number.isFinite(value.offset) &&
    Math.abs(value.offset) <= Number.MAX_SAFE_INTEGER &&
    !Object.is(value.offset, -0) &&
    typeof value.ratio === "number" &&
    Number.isFinite(value.ratio) &&
    value.ratio >= 0 &&
    value.ratio <= 1 &&
    !Object.is(value.ratio, -0)
  );
}
export function validMainTabCheckpointTabs(
  value: unknown
): value is readonly MainTabCheckpointSourceInput[] {
  if (!Array.isArray(value) || value.length > MAIN_TAB_METADATA_MAX_TABS)
    return false;
  const base: MainTabSourceInput[] = [];
  const count = value.length;
  for (let index = 0; index < count; index++) {
    const row: unknown = value[index];
    if (!object(row)) return false;
    const hasViewport = Object.prototype.hasOwnProperty.call(row, "viewport");
    const hasReset = Object.prototype.hasOwnProperty.call(row, "resetViewport");
    const keys = [
      "documentId",
      "handle",
      "hash",
      "mode",
      "pinned",
      "revision",
      ...(hasViewport ? ["viewport"] : []),
      ...(hasReset ? ["resetViewport"] : []),
    ];
    if (
      Object.keys(row).sort().join() !== keys.sort().join() ||
      (hasViewport && !validMainTabCheckpointViewport(row.viewport)) ||
      (hasReset && row.resetViewport !== true)
    )
      return false;
    base.push({
      handle: row.handle,
      documentId: row.documentId,
      revision: row.revision,
      hash: row.hash,
      pinned: row.pinned,
      mode: row.mode,
    } as MainTabSourceInput);
  }
  return validMainTabSourceTabs(base);
}
export interface MainTabCheckpointWriteRequest {
  protocolVersion: 1;
  tabs: readonly MainTabCheckpointSourceInput[];
  activeIndex: number;
}
export type MainTabCheckpointRequest =
  | MainTabCheckpointWriteRequest
  | { protocolVersion: 1; op: "clear" }
  | { protocolVersion: 1; op: "prune"; documentId: string; handle: string };
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
    object(value) &&
    Object.keys(value).sort().join() ===
      "documentId,handle,op,protocolVersion" &&
    value.protocolVersion === 1 &&
    value.op === "prune" &&
    validRootRosterId(value.documentId) &&
    validRootRosterId(value.handle)
  )
    return true;
  if (
    object(value) &&
    Object.keys(value).sort().join() === "op,protocolVersion" &&
    value.protocolVersion === 1 &&
    value.op === "clear"
  )
    return true;
  if (
    !object(value) ||
    Object.keys(value).sort().join() !== "activeIndex,protocolVersion,tabs" ||
    value.protocolVersion !== 1 ||
    !validMainTabCheckpointTabs(value.tabs) ||
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
