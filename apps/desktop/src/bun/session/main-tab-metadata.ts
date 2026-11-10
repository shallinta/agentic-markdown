import { extname, join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import { validRootRosterId } from "../../shared/root-roster";
import { WORKSPACE_MAX_ROOTS } from "../../shared/workspace";
import { validExpansionPath } from "../workspace/expansion-store";

export const MAIN_TAB_METADATA_MAX_TABS = 64;
export const MAIN_TAB_METADATA_MAX_BYTES = 256 * 1024;
export interface MainTabMetadata {
  rootId: string;
  relativePath: string;
  fingerprint: string;
  pinned: boolean;
  mode: "editing" | "source";
}
export interface MainTabSessionMetadata {
  tabs: MainTabMetadata[];
  activeIndex: number | null;
}
export type MainTabMetadataFailure =
  | "legacy"
  | "future"
  | "corrupt"
  | "too-large"
  | "io"
  | "invalid"
  | "capacity"
  | "closed"
  | "queue-full";
export type MainTabMetadataRead =
  | { status: "valid"; data: MainTabSessionMetadata }
  | { status: "missing" | MainTabMetadataFailure };
export type MainTabMetadataWrite =
  | { status: "committed" }
  | { status: "rejected" | "unknown"; reason: MainTabMetadataFailure };
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();
// fileFingerprint is `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`. Metadata is
// descriptive only; matching it never grants access to the historical file.
const fingerprint = /^(0|[1-9]\d{0,19}):(0|[1-9]\d{0,19}):(0|-?[1-9]\d{0,29})$/;
export function validMainTabSessionMetadata(
  value: unknown
): value is MainTabSessionMetadata {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exact(value, ["tabs", "activeIndex"])
  )
    return false;
  const data = value as MainTabSessionMetadata;
  if (
    !Array.isArray(data.tabs) ||
    data.tabs.length > MAIN_TAB_METADATA_MAX_TABS
  )
    return false;
  if (
    data.tabs.length === 0
      ? data.activeIndex !== null
      : !Number.isSafeInteger(data.activeIndex) ||
        data.activeIndex === null ||
        data.activeIndex < 0 ||
        data.activeIndex >= data.tabs.length
  )
    return false;
  const paths = new Set<string>(),
    roots = new Set<string>();
  for (const item of data.tabs as unknown[]) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !exact(item, ["rootId", "relativePath", "fingerprint", "pinned", "mode"])
    )
      return false;
    const tab = item as MainTabMetadata;
    if (
      !validRootRosterId(tab.rootId) ||
      !validExpansionPath(tab.relativePath) ||
      ![".md", ".markdown"].includes(extname(tab.relativePath).toLowerCase()) ||
      typeof tab.fingerprint !== "string" ||
      !fingerprint.test(tab.fingerprint) ||
      typeof tab.pinned !== "boolean" ||
      (tab.mode !== "editing" && tab.mode !== "source")
    )
      return false;
    const key = JSON.stringify([tab.rootId, tab.relativePath]);
    if (paths.has(key)) return false;
    paths.add(key);
    roots.add(tab.rootId);
    if (roots.size > WORKSPACE_MAX_ROOTS) return false;
  }
  return true;
}
const serializedBytes = (data: MainTabSessionMetadata) =>
  Buffer.byteLength(`${JSON.stringify({ version: 1, data }, null, 2)}\n`);

/** Isolated precursor only. No startup consumer, path lookup, or authority restoration. */
export function createMainTabMetadataStore(isolatedDir: string) {
  const store = createSettingsStore<MainTabSessionMetadata>(
    join(isolatedDir, "main-tab-session-probe.json"),
    (value) =>
      validMainTabSessionMetadata(value)
        ? value
        : { tabs: [], activeIndex: null },
    {
      maxBytes: MAIN_TAB_METADATA_MAX_BYTES,
      validateData: validMainTabSessionMetadata,
    }
  );
  let closed = false,
    queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(
    operation: () => Promise<T>,
    reject: (reason: MainTabMetadataFailure) => T
  ): Promise<T> {
    if (closed || queued >= 64)
      return Promise.resolve(reject(closed ? "closed" : "queue-full"));
    queued++;
    const next = tail.then(operation).catch(() => reject("io"));
    tail = next.finally(() => {
      queued--;
    });
    return next;
  }
  async function read(): Promise<MainTabMetadataRead> {
    const result = await store.readPersisted();
    return result.status === "valid"
      ? result.format === "version1"
        ? { status: "valid", data: result.data }
        : { status: "legacy" }
      : result;
  }
  return {
    read() {
      return enqueue(read, (status) => ({ status }));
    },
    write(value: unknown): Promise<MainTabMetadataWrite> {
      if (!validMainTabSessionMetadata(value))
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      if (serializedBytes(value) > MAIN_TAB_METADATA_MAX_BYTES)
        return Promise.resolve({ status: "rejected", reason: "capacity" });
      const captured: MainTabSessionMetadata = {
        tabs: value.tabs.map((tab) => ({ ...tab })),
        activeIndex: value.activeIndex,
      };
      return enqueue(
        async () => {
          let legacy = false;
          const result = await store.updateObserved((_previous, format) => {
            if (format === "legacy") {
              legacy = true;
              throw Error("Legacy session metadata");
            }
            return captured;
          });
          if (
            result.attempted &&
            result.persisted.status === "valid" &&
            result.persisted.format === "version1" &&
            JSON.stringify(result.persisted.data) === JSON.stringify(captured)
          )
            return { status: "committed" as const };
          const observed = await read();
          if (legacy)
            return { status: "rejected" as const, reason: "legacy" as const };
          if (observed.status !== "valid" && observed.status !== "missing")
            return { status: "rejected" as const, reason: observed.status };
          return { status: "unknown" as const, reason: "io" as const };
        },
        (reason) => ({ status: "rejected" as const, reason })
      );
    },
    async drain() {
      await tail;
    },
    async close() {
      closed = true;
      await tail;
    },
  };
}
