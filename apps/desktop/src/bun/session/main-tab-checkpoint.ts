import {
  validMainTabCheckpointTabs,
  type MainTabSourceInput,
} from "../../shared/main-tab-checkpoint";

import {
  captureMainTabMetadataInput,
  createMainTabMetadataBinder,
} from "./main-tab-binder";
import {
  createMainTabCheckpointMetadataStore,
  type MainTabMetadataWrite,
  type MainTabMetadataObservation,
} from "./main-tab-metadata";
import type { StoredMainTabPosition } from "./main-tab-position-codec";

export type MainTabCheckpointWrite =
  | MainTabMetadataWrite
  | { status: "rejected"; reason: "empty" | "unavailable" };

/** Internal only: neither opens documents nor chooses when a checkpoint is taken. */
export function createGuardedMainTabCheckpoint(
  directory: string,
  dependencies: Parameters<typeof createMainTabMetadataBinder>[0]
) {
  const binder = createMainTabMetadataBinder(dependencies);
  const store = createMainTabCheckpointMetadataStore(directory);
  let closed = false;
  let known = new Map<string, StoredMainTabPosition>();
  const sourceKey = (tab: MainTabSourceInput) =>
    JSON.stringify([tab.handle, tab.documentId, tab.revision, tab.hash]);
  let queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async read() {
      await tail;
      return store.read();
    },
    write(
      input: unknown,
      current: () => boolean,
      signal?: AbortSignal
    ): Promise<MainTabCheckpointWrite> {
      if (closed || queued >= 64)
        return Promise.resolve({
          status: "rejected",
          reason: closed ? "closed" : "queue-full",
        });
      let valid = true;
      const admitted = () => {
        try {
          valid = valid && !signal?.aborted && current() === true;
        } catch {
          valid = false;
        }
        return valid;
      };
      if (!admitted())
        return Promise.resolve({ status: "rejected", reason: "stale" });
      // Copy before queueing; physical authority proofs execute one at a time.
      let captured: ReturnType<typeof captureMainTabMetadataInput>;
      const measured: (StoredMainTabPosition | undefined)[] = [];
      const resets: boolean[] = [];
      try {
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          Object.keys(input).sort().join() !== "activeIndex,tabs" ||
          !("tabs" in input) ||
          !("activeIndex" in input) ||
          !validMainTabCheckpointTabs(input.tabs)
        )
          return Promise.resolve({ status: "rejected", reason: "invalid" });
        const rows = input.tabs.map((tab) => {
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
        captured = captureMainTabMetadataInput({
          tabs: rows,
          activeIndex: input.activeIndex,
        });
      } catch {
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      }
      if (!captured)
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      queued++;
      const next = tail
        .then(async (): Promise<MainTabCheckpointWrite> => {
          if (!admitted()) return { status: "rejected", reason: "stale" };
          const bound = await binder.bind(captured, signal);
          if (!admitted()) return { status: "rejected", reason: "stale" };
          if (bound.status !== "ready")
            return { status: "rejected", reason: bound.status };
          if (!bound.data.tabs.length)
            return { status: "rejected", reason: "empty" };
          const observation = await store.readObserved();
          if (!admitted() || !bound.current())
            return { status: "rejected", reason: "stale" };
          if (
            observation.status !== "valid" &&
            observation.status !== "missing"
          )
            return { status: "rejected", reason: observation.status };
          const ownsObservation = store.ownsObservation(observation);
          const positions = captured.tabs.map(
            (tab, index) =>
              measured[index] ??
              (ownsObservation && !resets[index]
                ? known.get(sourceKey(tab))
                : undefined)
          );
          const oldPositions =
            observation.status === "valid" ? observation.positioned : undefined;
          if (
            oldPositions &&
            bound.data.tabs.some(
              (tab, index) =>
                !positions[index] &&
                !(resets[index] && ownsObservation) &&
                oldPositions.tabs.some(
                  (old) =>
                    old.position &&
                    old.rootId === tab.rootId &&
                    old.relativePath === tab.relativePath &&
                    old.fingerprint === tab.fingerprint
                )
            )
          )
            return { status: "rejected", reason: "unavailable" };
          const withPositions = !!oldPositions || positions.some(Boolean);
          const result = withPositions
            ? await store.writeViewportPositions(
                {
                  schemaVersion: 2,
                  tabs: bound.data.tabs.map((tab, index) =>
                    positions[index]
                      ? { ...tab, position: positions[index] }
                      : tab
                  ),
                  activeIndex: bound.data.activeIndex,
                },
                () => admitted() && bound.current(),
                observation.status === "valid" ? observation : undefined,
                observation.status === "missing"
              )
            : await store.write(
                bound.data,
                () => admitted() && bound.current()
              );
          if (result.status === "committed")
            known = new Map(
              captured.tabs.flatMap((tab, index) =>
                positions[index]
                  ? [[sourceKey(tab), positions[index]] as const]
                  : []
              )
            );
          else if (result.status === "unknown") known.clear();
          return result;
        })
        .catch((): MainTabCheckpointWrite => ({
          status: "unknown",
          reason: "io",
        }));
      tail = next.finally(() => {
        queued--;
      });
      return next;
    },
    clear(current: () => boolean): Promise<MainTabCheckpointWrite> {
      if (closed || queued >= 64)
        return Promise.resolve({
          status: "rejected",
          reason: closed ? "closed" : "queue-full",
        });
      queued++;
      const next = tail
        .then(async () => {
          const result = await store.clearOwned(current);
          if (result.status === "committed" || result.status === "unknown")
            known.clear();
          return result;
        })
        .catch((): MainTabCheckpointWrite => ({
          status: "unknown",
          reason: "io",
        }));
      tail = next.finally(() => {
        queued--;
      });
      return next;
    },
    claim(
      receipt: MainTabMetadataObservation,
      current: () => boolean,
      sources?: readonly MainTabSourceInput[]
    ): Promise<boolean> {
      if (closed || queued >= 64) return Promise.resolve(false);
      const captured =
        sources && receipt.status === "valid"
          ? captureMainTabMetadataInput({
              tabs: sources,
              activeIndex: receipt.data.activeIndex,
            })
          : undefined;
      if (
        receipt.status === "valid" &&
        receipt.positioned &&
        captured?.tabs.length !== receipt.data.tabs.length
      )
        return Promise.resolve(false);
      queued++;
      const next = tail
        .then(async () => {
          const claimed = await store.claimObservation(receipt, current);
          if (claimed) known.clear();
          if (
            claimed &&
            receipt.status === "valid" &&
            receipt.positioned &&
            captured &&
            current()
          )
            known = new Map(
              captured.tabs.flatMap((tab, index) =>
                receipt.positioned!.tabs[index].position
                  ? [
                      [
                        sourceKey(tab),
                        receipt.positioned!.tabs[index].position,
                      ] as const,
                    ]
                  : []
              )
            );
          return claimed;
        })
        .catch(() => false);
      tail = next.finally(() => {
        queued--;
      });
      return next;
    },
    async drain() {
      await tail;
      await store.drain();
    },
    async close() {
      closed = true;
      await tail;
      await store.close();
    },
  };
}
