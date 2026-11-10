import type { createDocumentController } from "./documents";
import { allocateSecondaryPaneHeight, SECONDARY_MIN_HEIGHT } from "./secondary-pane-height";
import { removeSecondaryPaneHeight } from "./secondary-pane-removal";

export interface RealRegionAllocation {
  readonly ids: readonly string[];
  readonly heights: readonly number[];
  readonly totalHeight: number;
}

type Rejection = "full" | "keep-main" | "lab-limit" | "blocked" | "invalid";

function validAllocation(value: RealRegionAllocation) {
  if (!Array.isArray(value.ids) || !Array.isArray(value.heights) ||
      value.ids.length !== value.heights.length || value.ids.length > 2 ||
      !Number.isFinite(value.totalHeight) || value.totalHeight < 0) return false;
  const ids = new Set<string>();
  for (const id of value.ids) {
    if (typeof id !== "string" || !id || ids.has(id)) return false;
    ids.add(id);
  }
  let sum = 0;
  for (const height of value.heights) {
    if (!Number.isFinite(height) || height < SECONDARY_MIN_HEIGHT) return false;
    sum += height;
  }
  return !value.ids.length || Number.isFinite(sum) &&
    Math.abs(sum - value.totalHeight) <= Number.EPSILON * Math.max(1, sum, value.totalHeight) * 8;
}

/** Reconcile only identities; the real document controller owns every buffer. */
export function reconcileRealRegionAllocation(
  tabs: readonly { documentId: string }[],
  allocation: RealRegionAllocation
): RealRegionAllocation | undefined {
  if (!validAllocation(allocation)) return undefined;
  const live = new Set<string>();
  for (const tab of tabs) {
    if (!tab.documentId || live.has(tab.documentId)) return undefined;
    live.add(tab.documentId);
  }
  let result = allocation;
  for (const id of allocation.ids) {
    if (live.has(id)) continue;
    const index = result.ids.indexOf(id);
    const heights = removeSecondaryPaneHeight(result.heights, index);
    if (!heights) return undefined;
    result = { ids: result.ids.filter(value => value !== id), heights, totalHeight: result.totalHeight };
  }
  return result;
}

export function projectRealRegionDocuments<T extends { documentId: string }>(
  tabs: readonly T[],
  activeId: string | null | undefined,
  allocation: RealRegionAllocation,
  preferredMainId?: string | null
) {
  const current = reconcileRealRegionAllocation(tabs, allocation);
  if (!current) return undefined;
  const secondaryIds = new Set(current.ids);
  const main = tabs.filter(tab => !secondaryIds.has(tab.documentId));
  const byId = new Map(tabs.map(tab => [tab.documentId, tab]));
  return {
    main,
    mainCurrent: main.find(tab => tab.documentId === activeId) ??
      main.find(tab => tab.documentId === preferredMainId) ?? main[0] ?? null,
    secondary: current.ids.map(id => byId.get(id)!),
    allocation: current,
  };
}

type Controller = Pick<ReturnType<typeof createDocumentController>,
  "getSnapshot" | "canSelectFolder" | "hasSaves" | "isEditorInputBlocked">;

export function moveRealRegionDocument(
  controller: Controller,
  allocation: RealRegionAllocation,
  target: "main" | "secondary"
): { ok: true; allocation: RealRegionAllocation } | { ok: false; reason: Rejection } {
  const before = controller.getSnapshot();
  if (!before.snapshot || controller.isEditorInputBlocked() || controller.hasSaves() ||
      !controller.canSelectFolder() || controller.getSnapshot() !== before) return { ok: false, reason: "blocked" };
  const projection = projectRealRegionDocuments(before.tabs, before.snapshot.documentId, allocation);
  if (!projection || !before.tabs.some(tab => tab.documentId === before.snapshot?.documentId)) return { ok: false, reason: "invalid" };
  if (before.tabs.length > 3) return { ok: false, reason: "lab-limit" };
  const current = projection.allocation;
  const index = current.ids.indexOf(before.snapshot.documentId);
  if (target === "main") {
    if (index < 0) return { ok: false, reason: "blocked" };
    const heights = removeSecondaryPaneHeight(current.heights, index);
    return heights ? { ok: true, allocation: { ids: current.ids.filter((_, at) => at !== index), heights, totalHeight: current.totalHeight } }
      : { ok: false, reason: "invalid" };
  }
  if (index >= 0) return { ok: false, reason: "blocked" };
  if (current.ids.length >= 2) return { ok: false, reason: "lab-limit" };
  if (projection.main.length <= 1) return { ok: false, reason: "keep-main" };
  const added = allocateSecondaryPaneHeight(current.totalHeight, current.heights);
  if (!added.ok) return { ok: false, reason: added.reason };
  return { ok: true, allocation: {
    ids: [...current.ids, before.snapshot.documentId], heights: added.heights, totalHeight: current.totalHeight,
  } };
}

export function canMoveRealRegionDocument(
  controller: Controller,
  allocation: RealRegionAllocation,
  target: "main" | "secondary"
) {
  return moveRealRegionDocument(controller, allocation, target).ok;
}

/** Move the slot and its owned height together, without activating either document. */
export function reorderRealRegionDocuments(
  controller: Controller,
  allocation: RealRegionAllocation,
  sourceId: string,
  targetId: string,
  placement: "before" | "after"
): { ok: true; allocation: RealRegionAllocation } | { ok: false; reason: Rejection } {
  const before = controller.getSnapshot();
  if (!before.snapshot || controller.isEditorInputBlocked() || controller.hasSaves() ||
      !controller.canSelectFolder() || controller.getSnapshot() !== before)
    return { ok: false, reason: "blocked" };
  if (before.tabs.length > 3) return { ok: false, reason: "lab-limit" };
  const current = reconcileRealRegionAllocation(before.tabs, allocation);
  // A stale placement must not also reconcile a closed slot as a side effect.
  if (current !== allocation || (placement !== "before" && placement !== "after"))
    return { ok: false, reason: "invalid" };
  const source = allocation.ids.indexOf(sourceId);
  const target = allocation.ids.indexOf(targetId);
  if (source < 0 || target < 0) return { ok: false, reason: "invalid" };
  if (source === target) return { ok: true, allocation };
  const ids = allocation.ids.slice();
  const heights = allocation.heights.slice();
  const [id] = ids.splice(source, 1);
  const [height] = heights.splice(source, 1);
  const destination = ids.indexOf(targetId) + (placement === "after" ? 1 : 0);
  if (destination === source) return { ok: true, allocation };
  ids.splice(destination, 0, id);
  heights.splice(destination, 0, height);
  return { ok: true, allocation: { ids, heights, totalHeight: allocation.totalHeight } };
}
