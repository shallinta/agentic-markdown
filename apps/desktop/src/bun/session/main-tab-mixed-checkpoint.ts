import { resolve } from "node:path";

import {
  validMainTabCheckpointTabs,
  type MainTabCheckpointViewport,
  type MainTabSourceInput,
} from "../../shared/main-tab-checkpoint";

import { captureMainTabBlockAnchor } from "./main-tab-anchor-worker-client";
import { captureMainTabMetadataInput } from "./main-tab-binder";
import {
  readMainTabCheckpointCoexistence,
  type MainTabCheckpointCoexistenceRead,
} from "./main-tab-checkpoint-coexistence";
import {
  createMainTabCheckpointMetadataStore,
  checkpointPublicationGuard,
  type MainTabMetadataWrite,
  MAIN_TAB_METADATA_MAX_BYTES,
} from "./main-tab-metadata";
import { createMainTabMixedMetadataBinder } from "./main-tab-mixed-binder";
import {
  decodeMixedMainTabMetadata,
  type MixedMainTabRow,
} from "./main-tab-mixed-metadata";
import { createMixedMainTabCheckpointMetadataStore } from "./main-tab-mixed-metadata-store";
import {
  copyStoredMainTabPosition,
  type StoredMainTabPosition,
} from "./main-tab-position-codec";

type MixedCheckpointWrite =
  | MainTabMetadataWrite
  | { status: "rejected"; reason: "unavailable" | "empty" };

/** Trusted backend candidate: no automatic triggers or restoration; optional saved-source enrichment. */
export function createGuardedMixedMainTabCheckpoint(
  dataDir: string,
  dependencies: Parameters<typeof createMainTabMixedMetadataBinder>[0] & {
    captureViewportSource?(
      tab: MainTabSourceInput,
      current: () => boolean
    ): Promise<{ raw: string; current(): boolean } | undefined>;
    captureViewportAnchor?: typeof captureMainTabBlockAnchor;
  }
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
      const resets: boolean[] = [];
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
          resets.push(tab.resetViewport === true);
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
          const decodedLegacy =
            legacy.status === "valid" && legacy.positioned
              ? decodeMixedMainTabMetadata(legacy.positioned)
              : undefined;
          const legacyCandidate =
            decodedLegacy?.status === "valid" ? decodedLegacy.data : undefined;
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
          let enriched:
            { index: number; position: StoredMainTabPosition } | undefined;
          let proof: (() => boolean) | undefined;
          let sourceLive = true;
          const sourceCurrent = () => {
            try {
              sourceLive =
                sourceLive &&
                admitted() &&
                bound.current() &&
                (!proof || proof() === true);
            } catch {
              sourceLive = false;
            }
            return sourceLive;
          };
          const sameGeometry = (
            a: MainTabCheckpointViewport,
            b: MainTabCheckpointViewport
          ) =>
            a.from === b.from && a.offset === b.offset && a.ratio === b.ratio;
          if (dependencies.captureViewportSource && measured.some(Boolean)) {
            const existing = await mixed.read();
            if (!sourceCurrent())
              return { status: "rejected", reason: "stale" };
            if (existing.status !== "valid" && existing.status !== "missing")
              return { status: "rejected", reason: existing.status };
            const candidate =
              existing.status === "valid" ? existing.data : legacyCandidate;
            const previous = new Map(
              candidate?.tabs.map((row) => [key(row), row.position])
            );
            const candidates = measured
              .map((viewport, index) => ({ viewport, index }))
              .filter(({ viewport, index }) => {
                if (!viewport) return false;
                const old = previous.get(key(bound.data.tabs[index]));
                return (
                  resets[index] ||
                  !old ||
                  !sameGeometry(viewport, old) ||
                  (!!old.block &&
                    old.block.contentHash !== captured.tabs[index].hash)
                );
              });
            const selected =
              candidates.find((item) => item.index === captured.activeIndex) ??
              candidates[0];
            if (selected) {
              let source: { raw: string; current(): boolean } | undefined;
              try {
                source = await dependencies.captureViewportSource(
                  captured.tabs[selected.index],
                  () => admitted() && bound.current()
                );
              } catch {
                /* Unavailable source is not a parser fallback. */
              }
              if (source) proof = () => source.current();
              if (!sourceCurrent())
                return { status: "rejected", reason: "stale" };
              if (!source) return { status: "rejected", reason: "unavailable" };
              let anchor: StoredMainTabPosition | undefined;
              try {
                anchor = copyStoredMainTabPosition(
                  await (
                    dependencies.captureViewportAnchor ??
                    captureMainTabBlockAnchor
                  )(source.raw, selected.viewport!, signal)
                );
              } catch {
                /* Parser failure preserves the measured coordinates. */
              }
              if (!sourceCurrent())
                return { status: "rejected", reason: "stale" };
              if (
                anchor?.block?.contentHash ===
                  captured.tabs[selected.index].hash &&
                sameGeometry(anchor, selected.viewport!)
              )
                enriched = { index: selected.index, position: anchor };
            }
          }
          return mixed.write(
            bound.data,
            () => sourceCurrent() && (!requiresDirectory || directoryCurrent()),
            (previous, owned) => {
              requiresDirectory = previous === undefined;
              const old = previous ?? legacyCandidate;
              const positions = new Map(
                old?.tabs.map((row) => [key(row), row.position])
              );
              if (
                !owned &&
                bound.data.tabs.some(
                  (row, index) =>
                    resets[index] && positions.get(key(row)) !== undefined
                )
              )
                return undefined;
              const result = {
                ...bound.data,
                tabs: bound.data.tabs.map((row, index) => {
                  const saved = positions.get(key(row)),
                    viewport = measured[index];
                  const reuse =
                    !resets[index] &&
                    saved &&
                    (!viewport ||
                      (saved.from === viewport.from &&
                        saved.offset === viewport.offset &&
                        saved.ratio === viewport.ratio &&
                        saved.block?.contentHash ===
                          captured.tabs[index].hash));
                  const position = reuse
                    ? saved
                    : enriched?.index === index
                      ? enriched.position
                      : viewport;
                  return position ? { ...row, position } : row;
                }),
              };
              if (
                enriched &&
                Buffer.byteLength(
                  `${JSON.stringify({ version: 1, data: result }, null, 2)}\n`
                ) > MAIN_TAB_METADATA_MAX_BYTES
              ) {
                const row = result.tabs[enriched.index];
                if (row.position === enriched.position)
                  result.tabs[enriched.index] = {
                    ...row,
                    position: measured[enriched.index]!,
                  };
              }
              return result;
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
