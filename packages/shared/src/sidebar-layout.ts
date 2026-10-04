export interface SidebarLayout {
  visible: boolean;
  expandedWidth: number;
}
export function isSidebarLayout(value: unknown): value is SidebarLayout {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    Object.keys(item).length === 2 &&
    typeof item.visible === "boolean" &&
    typeof item.expandedWidth === "number" &&
    Number.isFinite(item.expandedWidth) &&
    item.expandedWidth > 0 &&
    item.expandedWidth <= 100000
  );
}
