import type { RootAuthorization } from "./authorization";
import type { ScanBatch } from "./scan";

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const path = (value: unknown): value is string =>
  typeof value === "string" &&
  value.startsWith("/") &&
  value.length <= 4096 &&
  !value.includes("\0") &&
  (value === "/" ||
    value
      .split("/")
      .slice(1)
      .every((p) => !!p && p !== "." && p !== ".."));
const identity = (value: unknown) =>
  record(value) &&
  Object.keys(value).length === 2 &&
  path(value.path) &&
  typeof value.fingerprint === "string" &&
  /^\d{1,30}:\d{1,30}:-?\d{1,30}$/.test(value.fingerprint);
export interface ScanRequest {
  id: number;
  op:
    | "start"
    | "next"
    | "close"
    | "prioritize"
    | "watchStart"
    | "watchClose"
    | "watchDispose"
    | "watchTick";
  key: string;
  root?: RootAuthorization;
  path?: string;
  showHidden?: boolean;
  budget?: number;
}
export function validScanRequest(value: unknown): value is ScanRequest {
  if (
    !record(value) ||
    !Number.isSafeInteger(value.id) ||
    Number(value.id) <= 0 ||
    typeof value.key !== "string" ||
    !/^[a-f\d-]{36}:[1-9]\d{0,15}$/i.test(value.key)
  )
    return false;
  const keys =
    value.op === "start" || value.op === "watchStart"
      ? value.showHidden === undefined
        ? ["id", "op", "key", "root"]
        : ["id", "op", "key", "root", "showHidden"]
      : value.op === "watchTick"
        ? ["id", "op", "key", "budget"]
        : value.op === "prioritize"
          ? ["id", "op", "key", "path"]
          : ["id", "op", "key"];
  if (
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key) => keys.includes(key))
  )
    return false;
  if (value.op === "start" || value.op === "watchStart")
    return (
      (value.showHidden === undefined ||
        typeof value.showHidden === "boolean") &&
      record(value.root) &&
      Object.keys(value.root).length === 2 &&
      path(value.root.path) &&
      Array.isArray(value.root.directories) &&
      value.root.directories.length > 0 &&
      value.root.directories.length <= 256 &&
      value.root.directories.every(identity)
    );
  if (value.op === "prioritize") return path(value.path);
  if (value.op === "watchTick")
    return (
      Number.isSafeInteger(value.budget) &&
      Number(value.budget) >= 0 &&
      Number(value.budget) <= 4 * 1024 * 1024
    );
  return (
    value.op === "next" ||
    value.op === "close" ||
    value.op === "watchClose" ||
    value.op === "watchDispose"
  );
}
export function validScanBatch(value: unknown): value is ScanBatch {
  return (
    record(value) &&
    Object.keys(value).length === 6 &&
    typeof value.done === "boolean" &&
    typeof value.paused === "boolean" &&
    Number.isSafeInteger(value.examined) &&
    Number(value.examined) >= 0 &&
    Number(value.examined) <= 128 &&
    Number.isSafeInteger(value.errors) &&
    Number(value.errors) >= 0 &&
    Number(value.errors) <= 129 &&
    Number.isSafeInteger(value.queueBytes) &&
    Number(value.queueBytes) >= 0 &&
    Number(value.queueBytes) <= 2 * 1024 * 1024 &&
    Array.isArray(value.files) &&
    value.files.length <= 128 &&
    value.files.every(
      (file) =>
        record(file) &&
        Object.keys(file).length === 3 &&
        path(file.path) &&
        identity({ path: file.path, fingerprint: file.fingerprint }) &&
        Array.isArray(file.chain) &&
        file.chain.length <= 128 &&
        file.chain.every(identity)
    )
  );
}

export interface WatchBatch {
  roots: {
    key: string;
    status: "establishing" | "watching" | "limited";
    dirty: boolean;
  }[];
  bytes: number;
  queueBytes: number;
}
export function validWatchBatch(value: unknown): value is WatchBatch {
  return (
    record(value) &&
    Object.keys(value).length === 3 &&
    Number.isSafeInteger(value.bytes) &&
    Number(value.bytes) >= 0 &&
    Number(value.bytes) <= 2 * 1024 * 1024 &&
    Number.isSafeInteger(value.queueBytes) &&
    Number(value.queueBytes) >= 0 &&
    Number(value.queueBytes) <= 2 * 1024 * 1024 &&
    Array.isArray(value.roots) &&
    value.roots.length <= 32 &&
    value.roots.every(
      (row: unknown) =>
        record(row) &&
        Object.keys(row).length === 3 &&
        typeof row.key === "string" &&
        /^[a-f\d-]{36}:[1-9]\d{0,15}$/i.test(row.key) &&
        (row.status === "establishing" ||
          row.status === "watching" ||
          row.status === "limited") &&
        typeof row.dirty === "boolean"
    ) &&
    new Set((value.roots as WatchBatch["roots"]).map((row) => row.key)).size ===
      value.roots.length
  );
}
