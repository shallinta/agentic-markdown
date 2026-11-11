import {
  validMainTabCheckpointTabs,
  type MainTabSourceInput,
} from "../../shared/main-tab-checkpoint";

import { captureMainTabBlockAnchor } from "./main-tab-anchor-worker-client";
import {
  captureMainTabMetadataInput,
  createMainTabMetadataBinder,
} from "./main-tab-binder";
import {
  createMainTabCheckpointMetadataStore,
  type MainTabMetadataWrite,
  type MainTabMetadataObservation,
  MAIN_TAB_METADATA_MAX_BYTES,
  mainTabMetadataSerializedBytes,
} from "./main-tab-metadata";
import {
  copyStoredMainTabPosition,
  type StoredMainTabPosition,
} from "./main-tab-position-codec";

export type MainTabCheckpointWrite =
  | MainTabMetadataWrite
  | { status: "rejected"; reason: "empty" | "unavailable" };

/** Internal only: neither opens documents nor chooses when a checkpoint is taken. */
export function createGuardedMainTabCheckpoint(
  directory: string,
  dependencies: Parameters<typeof createMainTabMetadataBinder>[0] & {
    captureViewportAnchor?: typeof captureMainTabBlockAnchor;
    captureViewportSource?(
      tab: MainTabSourceInput,
      current: () => boolean
    ): Promise<{ raw: string; current(): boolean } | undefined>;
  }
) {
  const binder = createMainTabMetadataBinder(dependencies);
  const store = createMainTabCheckpointMetadataStore(directory);
  let closed = false;
  let ownedSources: readonly MainTabSourceInput[] = [];
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
          const prior = captured.tabs.map((tab, index) =>
            ownsObservation && !resets[index]
              ? known.get(sourceKey(tab))
              : undefined
          );
          const sameGeometry = (
            left: StoredMainTabPosition,
            right: StoredMainTabPosition
          ) =>
            left.from === right.from &&
            left.offset === right.offset &&
            left.ratio === right.ratio;
          const positions = captured.tabs.map((_tab, index) => {
            const measurement = measured[index],
              previous = prior[index];
            return measurement
              ? previous && sameGeometry(measurement, previous)
                ? previous
                : measurement
              : previous;
          });
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
          let sourceProof: (() => boolean) | undefined;
          let sourceValid = true;
          const currentSource = () => {
            try {
              sourceValid =
                sourceValid &&
                admitted() &&
                bound.current() &&
                (!sourceProof || sourceProof() === true);
            } catch {
              sourceValid = false;
            }
            return sourceValid;
          };
          if (dependencies.captureViewportSource) {
            const candidates = captured.tabs
              .map((_tab, index) => index)
              .filter(
                (index) => measured[index] && positions[index] !== prior[index]
              );
            const index =
              candidates.find((candidate) => prior[candidate] !== undefined) ??
              candidates[0];
            if (index !== undefined) {
              try {
                const source = await dependencies.captureViewportSource(
                  captured.tabs[index],
                  () => admitted() && bound.current()
                );
                if (source) sourceProof = () => source.current();
                if (!currentSource())
                  return { status: "rejected", reason: "stale" };
                if (source !== undefined) {
                  const anchor = copyStoredMainTabPosition(
                    await (
                      dependencies.captureViewportAnchor ??
                      captureMainTabBlockAnchor
                    )(source.raw, measured[index]!, signal)
                  );
                  if (!currentSource())
                    return { status: "rejected", reason: "stale" };
                  if (
                    anchor?.block?.contentHash === captured.tabs[index].hash &&
                    sameGeometry(anchor, measured[index]!)
                  ) {
                    const baseline = positions[index];
                    positions[index] = anchor;
                    const data = {
                      schemaVersion: 2 as const,
                      tabs: bound.data.tabs.map((tab, row) =>
                        positions[row]
                          ? { ...tab, position: positions[row] }
                          : tab
                      ),
                      activeIndex: bound.data.activeIndex,
                    };
                    if (
                      mainTabMetadataSerializedBytes(data) >
                      MAIN_TAB_METADATA_MAX_BYTES
                    )
                      positions[index] = baseline;
                  }
                }
              } catch {
                /* Enrichment is optional; retain the measured source fallback. */
              }
              if (!currentSource())
                return { status: "rejected", reason: "stale" };
            }
          }
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
                currentSource,
                observation.status === "valid" ? observation : undefined,
                observation.status === "missing"
              )
            : await store.write(bound.data, currentSource);
          if (result.status === "committed") {
            const data = withPositions
              ? {
                  schemaVersion: 2,
                  tabs: bound.data.tabs.map((tab, index) =>
                    positions[index]
                      ? { ...tab, position: positions[index] }
                      : tab
                  ),
                  activeIndex: bound.data.activeIndex,
                }
              : bound.data;
            ownedSources = store.ownsData(data) ? captured.tabs : [];
            known = new Map(
              captured.tabs.flatMap((tab, index) =>
                positions[index]
                  ? [[sourceKey(tab), positions[index]] as const]
                  : []
              )
            );
          } else if (result.status === "unknown") {
            known.clear();
            ownedSources = [];
          }
          return result;
        })
        .catch((): MainTabCheckpointWrite => {
          known.clear();
          ownedSources = [];
          return { status: "unknown", reason: "io" };
        });
      tail = next.finally(() => {
        queued--;
      });
      return next;
    },
    prune(
      source: { documentId: string; handle: string },
      current: () => boolean
    ): Promise<MainTabCheckpointWrite> {
      if (closed || queued >= 64)
        return Promise.resolve({
          status: "rejected",
          reason: closed ? "closed" : "queue-full",
        });
      const target = { documentId: source.documentId, handle: source.handle };
      queued++;
      const next = tail
        .then(async (): Promise<MainTabCheckpointWrite> => {
          const captured = ownedSources;
          const index = captured.findIndex(
            (tab) =>
              tab.documentId === target.documentId &&
              tab.handle === target.handle
          );
          if (index < 0) return { status: "rejected", reason: "not-owned" };
          const result = await store.pruneOwned(
            index,
            () => captured === ownedSources && current() === true
          );
          if (result.status === "committed") {
            known.delete(sourceKey(captured[index]));
            ownedSources = captured.filter((_tab, at) => at !== index);
          } else if (
            result.status === "unknown" ||
            result.reason === "not-owned"
          ) {
            known.clear();
            ownedSources = [];
          }
          return result;
        })
        .catch((): MainTabCheckpointWrite => {
          known.clear();
          ownedSources = [];
          return { status: "unknown", reason: "io" };
        });
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
          if (result.status === "committed" || result.status === "unknown") {
            known.clear();
            ownedSources = [];
          }
          return result;
        })
        .catch((): MainTabCheckpointWrite => {
          known.clear();
          ownedSources = [];
          return { status: "unknown", reason: "io" };
        });
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
        (receipt.positioned || sources !== undefined) &&
        captured?.tabs.length !== receipt.data.tabs.length
      )
        return Promise.resolve(false);
      queued++;
      const next = tail
        .then(async () => {
          const claimed = await store.claimObservation(receipt, current);
          if (claimed) {
            known.clear();
            ownedSources = captured?.tabs ?? [];
          }
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
