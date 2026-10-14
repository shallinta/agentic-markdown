export interface RecentFile {
  id: string;
  kind: "file";
  path: string;
  name: string;
  accessedAt: number;
}
export type RecentFailure =
  "future" | "corrupt" | "too-large" | "io" | "queue-full" | "invalid";
export type RecentResponse =
  | { available: true; entries: RecentFile[]; warning?: RecentFailure }
  | { available: false; reason: RecentFailure };
export interface RecentRequest {
  op: "list" | "remove" | "clear";
  id?: string;
}
export const RECENT_LIMIT = 20;
export const RECENT_MAX_BYTES = 997056;
export function isRecentResponse(value: unknown): value is RecentResponse {
  if (!value || typeof value !== "object") return false;
  const r = value as RecentResponse;
  const failure = (reason: unknown) =>
    typeof reason === "string" &&
    ["future", "corrupt", "too-large", "io", "queue-full", "invalid"].includes(
      reason
    );
  return r.available === true
    ? Object.keys(r).every((k) =>
        ["available", "entries", "warning"].includes(k)
      ) &&
        isRecentData({ entries: r.entries }) &&
        (r.warning === undefined || failure(r.warning))
    : r.available === false &&
        Object.keys(r).sort().join() === "available,reason" &&
        failure(r.reason);
}
export function isRecentData(
  value: unknown
): value is { entries: RecentFile[] } {
  if (
    !value ||
    typeof value !== "object" ||
    Object.keys(value).length !== 1 ||
    !("entries" in value) ||
    !Array.isArray(value.entries) ||
    value.entries.length > RECENT_LIMIT
  )
    return false;
  const ids = new Set<string>(),
    paths = new Set<string>();
  return value.entries.every((e: unknown) => {
    if (!e || typeof e !== "object") return false;
    const item = e as RecentFile;
    if (
      Object.keys(item).sort().join() !== "accessedAt,id,kind,name,path" ||
      typeof item.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        item.id
      ) ||
      item.kind !== "file" ||
      typeof item.path !== "string" ||
      !item.path.startsWith("/") ||
      item.path.length > 4096 ||
      item.path.includes("\0") ||
      !/\.(md|markdown)$/i.test(item.path) ||
      typeof item.name !== "string" ||
      !item.name.length ||
      item.name.length > 4096 ||
      item.name.includes("\0") ||
      !Number.isSafeInteger(item.accessedAt) ||
      item.accessedAt < 0 ||
      ids.has(item.id) ||
      paths.has(item.path)
    )
      return false;
    ids.add(item.id);
    paths.add(item.path);
    return true;
  });
}
