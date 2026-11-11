import { resolve } from "node:path";

import {
  validMainTabCheckpointTabs,
  type MainTabCheckpointViewport,
} from "../../shared/main-tab-checkpoint";

import { captureMainTabMetadataInput } from "./main-tab-binder";
import {
  readMainTabCheckpointCoexistence,
  type MainTabCheckpointCoexistenceRead,
} from "./main-tab-checkpoint-coexistence";
import {
  createMainTabCheckpointMetadataStore,
  checkpointPublicationGuard,
  type MainTabMetadataWrite,
} from "./main-tab-metadata";
import { createMainTabMixedMetadataBinder } from "./main-tab-mixed-binder";
import {
  decodeMixedMainTabMetadata,
  type MixedMainTabRow,
} from "./main-tab-mixed-metadata";
import { createMixedMainTabCheckpointMetadataStore } from "./main-tab-mixed-metadata-store";

type MixedCheckpointWrite =
  | MainTabMetadataWrite
  | { status: "rejected"; reason: "unavailable" | "empty" };

/** Trusted backend candidate: no automatic triggers, restoration, or document reads. */
export function createGuardedMixedMainTabCheckpoint(
  dataDir: string,
  dependencies: Parameters<typeof createMainTabMixedMetadataBinder>[0]
) {
  const directoryPath = resolve(dataDir, "main-tab-session-checkpoint.json");
  const binder = createMainTabMixedMetadataBinder(dependencies);
  const mixed = createMixedMainTabCheckpointMetadataStore(dataDir);
  const directory = createMainTabCheckpointMetadataStore(dataDir);
  let closed = false;
  let queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async read(): Promise<MainTabCheckpointCoexistenceRead> {
      await tail;
      if (closed) return { status: "closed" };
      const result = await readMainTabCheckpointCoexistence({
        mixed,
        directory,
      });
      return closed ? { status: "closed" } : result;
    },
    write(
      value: unknown,
      current: () => boolean,
      signal?: AbortSignal
    ): Promise<MixedCheckpointWrite> {
      if (closed || queued >= 64)
        return Promise.resolve({
          status: "rejected",
          reason: closed ? "closed" : "queue-full",
        });
      let input: ReturnType<typeof captureMainTabMetadataInput>;
      const measured: (MainTabCheckpointViewport | undefined)[] = [];
      try {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !== "activeIndex,tabs" ||
          !("tabs" in value) ||
          !("activeIndex" in value) ||
          !validMainTabCheckpointTabs(value.tabs)
        )
          return Promise.resolve({ status: "rejected", reason: "invalid" });
        const tabs = value.tabs.map((tab) => {
          if (tab.resetViewport) throw Error("Reset requires ownership");
          measured.push(
            tab.viewport
              ? {
                  from: tab.viewport.from,
                  offset: tab.viewport.offset,
                  ratio: tab.viewport.ratio,
                }
              : undefined
          );
          return {
            handle: tab.handle,
            documentId: tab.documentId,
            revision: tab.revision,
            hash: tab.hash,
            pinned: tab.pinned,
            mode: tab.mode,
          };
        });
        input = captureMainTabMetadataInput({
          tabs,
          activeIndex: value.activeIndex,
        });
      } catch {
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      }
      if (!input)
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      if (!input.tabs.length)
        return Promise.resolve({ status: "rejected", reason: "empty" });
      let live = true;
      const admitted = () => {
        try {
          live =
            live &&
            !closed &&
            !signal?.aborted &&
            current() === true &&
            !closed &&
            !signal?.aborted;
        } catch {
          live = false;
        }
        return live;
      };
      if (!admitted())
        return Promise.resolve({ status: "rejected", reason: "stale" });
      if (queued >= 64)
        return Promise.resolve({ status: "rejected", reason: "queue-full" });
      const captured = input;
      queued++;
      const next = tail
        .then(async (): Promise<MixedCheckpointWrite> => {
          if (!admitted()) return { status: "rejected", reason: "stale" };
          const bound = await binder.bind(captured, signal);
          if (!admitted()) return { status: "rejected", reason: "stale" };
          if (bound.status !== "ready")
            return { status: "rejected", reason: bound.status };
          const legacy = await directory.readObserved();
          if (!admitted() || !bound.current())
            return { status: "rejected", reason: "stale" };
          let requiresDirectory = false;
          const directoryCurrent =
            legacy.status === "valid"
              ? () => directory.exactCurrent(legacy)
              : legacy.status === "missing"
                ? checkpointPublicationGuard(
                    undefined,
                    directoryPath,
                    () => true
                  )
                : () => false;
          const key = (row: MixedMainTabRow) =>
            JSON.stringify(
              row.kind === "root"
                ? [row.kind, row.rootId, row.relativePath, row.fingerprint]
                : [row.kind, row.path, row.fingerprint]
            );
          return mixed.write(
            bound.data,
            () =>
              admitted() &&
              bound.current() &&
              (!requiresDirectory || directoryCurrent()),
            (previous) => {
              requiresDirectory = previous === undefined;
              const fallback =
                !previous && legacy.status === "valid" && legacy.positioned
                  ? decodeMixedMainTabMetadata(legacy.positioned)
                  : undefined;
              const old =
                previous ??
                (fallback?.status === "valid" ? fallback.data : undefined);
              const positions = new Map(
                old?.tabs.map((row) => [key(row), row.position])
              );
              return {
                ...bound.data,
                tabs: bound.data.tabs.map((row, index) => {
                  const saved = positions.get(key(row)),
                    viewport = measured[index];
                  const reuse =
                    saved &&
                    (!viewport ||
                      (saved.from === viewport.from &&
                        saved.offset === viewport.offset &&
                        saved.ratio === viewport.ratio &&
                        saved.block?.contentHash ===
                          captured.tabs[index].hash));
                  const position = reuse ? saved : viewport;
                  return position ? { ...row, position } : row;
                }),
              };
            }
          );
        })
        .catch((): MixedCheckpointWrite => ({
          status: "unknown",
          reason: "io",
        }));
      tail = next.finally(() => {
        queued--;
      });
      return next;
    },
    async drain() {
      await tail;
    },
    async close() {
      closed = true;
      await tail;
      await Promise.all([mixed.close(), directory.close()]);
    },
  };
}
