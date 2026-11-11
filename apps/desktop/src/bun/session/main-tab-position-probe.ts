import { join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import { MAIN_TAB_METADATA_MAX_TABS } from "../../shared/main-tab-checkpoint";
import {
  validMainTabPosition,
  type MainTabPosition,
} from "../../shared/main-tab-position";

import {
  MAIN_TAB_METADATA_MAX_BYTES,
  validMainTabSessionMetadata,
  type MainTabMetadata,
  type MainTabMetadataWrite,
} from "./main-tab-metadata";

export interface MainTabPositionProbeMetadata {
  tabs: (MainTabMetadata & { position?: MainTabPosition })[];
  activeIndex: number | null;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function validMainTabPositionProbeMetadata(
  value: unknown
): value is MainTabPositionProbeMetadata {
  if (!object(value) || Object.keys(value).sort().join() !== "activeIndex,tabs")
    return false;
  const sourceTabs = value.tabs;
  if (!Array.isArray(sourceTabs)) return false;
  const length = sourceTabs.length;
  if (
    !Number.isSafeInteger(length) ||
    length < 0 ||
    length > MAIN_TAB_METADATA_MAX_TABS
  )
    return false;
  const tabs: Record<string, unknown>[] = [];
  for (let index = 0; index < length; index++) {
    const item: unknown = sourceTabs[index];
    if (!object(item)) return false;
    const { position, ...base } = item;
    if (
      Object.prototype.hasOwnProperty.call(item, "position") &&
      !validMainTabPosition(position)
    )
      return false;
    tabs.push(base);
  }
  return validMainTabSessionMetadata({ tabs, activeIndex: value.activeIndex });
}

/** Isolated schema experiment; never imports or opens the production checkpoint filename. */
export function createMainTabPositionProbeStore(directory: string) {
  const store = createSettingsStore<MainTabPositionProbeMetadata>(
    join(directory, "main-tab-position-probe.json"),
    (value) =>
      validMainTabPositionProbeMetadata(value)
        ? value
        : { tabs: [], activeIndex: null },
    {
      maxBytes: MAIN_TAB_METADATA_MAX_BYTES,
      validateData: validMainTabPositionProbeMetadata,
    }
  );
  let closed = false;
  const pending = new Set<Promise<MainTabMetadataWrite>>();
  return {
    read: () =>
      store.observePersisted((result) =>
        result.status === "valid"
          ? result.format === "version1"
            ? { status: "valid" as const, data: result.data }
            : { status: "legacy" as const }
          : result
      ),
    write(value: unknown): Promise<MainTabMetadataWrite> {
      if (closed || pending.size >= 64)
        return Promise.resolve({
          status: "rejected",
          reason: closed ? "closed" : "queue-full",
        });
      let captured: MainTabPositionProbeMetadata;
      let serialized: string;
      try {
        if (
          !object(value) ||
          Object.keys(value).sort().join() !== "activeIndex,tabs"
        )
          return Promise.resolve({ status: "rejected", reason: "invalid" });
        const source = { tabs: value.tabs, activeIndex: value.activeIndex };
        if (!validMainTabPositionProbeMetadata(source))
          return Promise.resolve({ status: "rejected", reason: "invalid" });
        const sourceTabs = source.tabs;
        const length = sourceTabs.length;
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > MAIN_TAB_METADATA_MAX_TABS
        )
          return Promise.resolve({ status: "rejected", reason: "invalid" });
        // Project primitives explicitly: never serialize caller objects or use their iterators.
        captured = { activeIndex: source.activeIndex, tabs: [] };
        for (let index = 0; index < length; index++) {
          const tab = sourceTabs[index];
          const item: MainTabPositionProbeMetadata["tabs"][number] = {
            rootId: tab.rootId,
            relativePath: tab.relativePath,
            fingerprint: tab.fingerprint,
            pinned: tab.pinned,
            mode: tab.mode,
          };
          if (Object.prototype.hasOwnProperty.call(tab, "position")) {
            const position = tab.position!;
            const anchor = position.anchor;
            item.position = {
              version: position.version,
              offset: position.offset,
              anchor: {
                kind: anchor.kind,
                hash: anchor.hash,
                occurrence: anchor.occurrence,
              },
            };
          }
          captured.tabs.push(item);
        }
        if (!validMainTabPositionProbeMetadata(captured))
          return Promise.resolve({ status: "rejected", reason: "invalid" });
        serialized = JSON.stringify(captured);
        if (
          Buffer.byteLength(
            `${JSON.stringify({ version: 1, data: captured }, null, 2)}\n`
          ) > MAIN_TAB_METADATA_MAX_BYTES
        )
          return Promise.resolve({ status: "rejected", reason: "capacity" });
      } catch {
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      }
      // updateObserved synchronously admits to the shared same-path queue. No second queue.
      const next = (async (): Promise<MainTabMetadataWrite> => {
        const result = await store.updateObserved((_before, format) => {
          if (format === "legacy") throw Error("Legacy probe protected");
          return captured;
        });
        if (
          result.attempted &&
          result.persisted.status === "valid" &&
          result.persisted.format === "version1" &&
          JSON.stringify(result.persisted.data) === serialized
        )
          return { status: "committed" };
        if (result.attempted) return { status: "unknown", reason: "io" };
        const current = await store.readPersisted();
        return {
          status: "rejected",
          reason:
            current.status === "valid"
              ? current.format === "legacy"
                ? "legacy"
                : "io"
              : current.status === "missing"
                ? "io"
                : current.status,
        };
      })().catch((): MainTabMetadataWrite => ({
        status: "unknown",
        reason: "io",
      }));
      pending.add(next);
      void next.then(() => pending.delete(next));
      return next;
    },
    async close() {
      closed = true;
      await Promise.all(pending);
    },
  };
}
