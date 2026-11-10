import type { createDocumentController } from "./documents";

export function projectRealRegionDocuments<T extends { documentId: string }>(
  tabs: readonly T[],
  activeId: string | null | undefined,
  secondaryId: string | null
) {
  const secondary = tabs.find(tab => tab.documentId === secondaryId) ?? null;
  const main = secondary ? tabs.filter(tab => tab !== secondary) : tabs;
  return {
    main,
    mainCurrent: main.find(tab => tab.documentId === activeId) ?? main[0] ?? null,
    secondary,
    secondaryId: secondary?.documentId ?? null,
  };
}

type Controller = Pick<ReturnType<typeof createDocumentController>,
  "getSnapshot" | "canSelectFolder" | "hasSaves" | "isEditorInputBlocked">;

export function moveRealRegionDocument(
  controller: Controller,
  secondaryId: string | null,
  target: "main" | "secondary"
): { ok: true; secondaryId: string | null } | { ok: false } {
  const before = controller.getSnapshot();
  if ((target === "secondary" ? before.tabs.length !== 2 : before.tabs.length < 1 || before.tabs.length > 2) || !before.snapshot ||
      (before.tabs.length === 2 && before.tabs[0].documentId === before.tabs[1].documentId) ||
      !before.tabs.some(tab => tab.documentId === before.snapshot?.documentId) ||
      controller.isEditorInputBlocked() || controller.hasSaves() ||
      !controller.canSelectFolder() || controller.getSnapshot() !== before) return { ok: false };
  const projection = projectRealRegionDocuments(before.tabs, before.snapshot.documentId, secondaryId);
  if (target === "main")
    return projection.secondaryId === before.snapshot.documentId
      ? { ok: true, secondaryId: null } : { ok: false };
  return projection.secondaryId === null
    ? { ok: true, secondaryId: before.snapshot.documentId } : { ok: false };
}

export function canMoveRealRegionDocument(
  controller: Controller,
  secondaryId: string | null,
  target: "main" | "secondary"
) {
  return moveRealRegionDocument(controller, secondaryId, target).ok;
}
