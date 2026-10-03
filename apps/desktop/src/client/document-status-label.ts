import type { WriteCapability } from "../shared/documents";

/** Compact status shared by the file tree and document tabs. */
export function documentCapabilitySuffix(capability: WriteCapability): string {
  return capability.writable
    ? ""
    : capability.reason === "readonly"
      ? " · 只读"
      : capability.reason === "invalid"
        ? " · 授权失效"
        : " · 权限确认中";
}

/** View read-only state is distinct from filesystem save permission. */
export function documentStatusLabel(
  mode: "editing" | "reading" | "source",
  capability: WriteCapability
): string {
  const label = {
    editing: "编辑模式",
    reading: "阅读模式",
    source: "源码模式",
  }[mode];
  const permission = capability.writable
    ? mode === "reading"
      ? "只读视图（已有未保存内容仍可保存）"
      : "可编辑"
    : capability.reason === "readonly"
      ? "只读：文件或父目录不允许安全写入；仍可选择、复制和滚动。"
      : capability.reason === "invalid"
        ? "只读：文件授权已失效，请重新选择文件。内存内容已保留。"
        : "只读：暂时无法确认写入能力，正在自动重试。内存内容已保留。";
  return `${label} · ${permission} · `;
}
