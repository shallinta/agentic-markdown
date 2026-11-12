import { resolve } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import {
  MAIN_TAB_METADATA_MAX_BYTES,
  checkpointPublicationGuard,
  type MainTabMetadataWrite,
} from "./main-tab-metadata";
import {
  copyMixedMainTabMetadata,
  decodeMixedMainTabMetadata,
  type MixedMainTabMetadata,
} from "./main-tab-mixed-metadata";

type ReadFailure =
  | "legacy"
  | "future"
  | "corrupt"
  | "too-large"
  | "io"
  | "closed"
  | "queue-full";
type MixedMainTabMetadataRead =
  | { status: "valid"; data: MixedMainTabMetadata }
  | { status: "missing" | ReadFailure };

// Same-process writes to one fixed slot retire older ownership, including ABA.
const slotObservations = new Map<
  string,
  { token: object; stores: number; tail: Promise<unknown> }
>();

/** Isolated probe only. The ordinary checkpoint file is not a source for this store. */
export function createMixedMainTabMetadataStore(isolatedDir: string) {
  const store = createMixedStore(
    resolve(isolatedDir, "main-tab-session-mixed-probe.json")
  );
  return {
    read: () => store.read(),
    close: () => store.close(),
    write: (value: unknown, current: () => boolean) =>
      store.write(value, current),
  };
}

/** Dedicated production candidate slot; not connected to window events. */
export function createMixedMainTabCheckpointMetadataStore(dataDir: string) {
  const store = createMixedStore(
    resolve(dataDir, "main-tab-session-mixed-checkpoint.json")
  );
  const empty: MixedMainTabMetadata = {
    schemaVersion: 3,
    tabs: [],
    activeIndex: null,
  };
  return {
    ...store,
    pruneOwned(index: number, current: () => boolean) {
      return store.write(empty, current, (previous, owned) => {
        if (
          !owned ||
          !previous ||
          !Number.isSafeInteger(index) ||
          index < 0 ||
          index >= previous.tabs.length
        )
          return;
        const tabs = previous.tabs.filter((_row, at) => at !== index);
        const active = previous.activeIndex;
        const activeIndex = !tabs.length
          ? null
          : active === null
            ? 0
            : active > index
              ? active - 1
              : active === index
                ? Math.min(index, tabs.length - 1)
                : active;
        return { schemaVersion: 3, tabs, activeIndex };
      });
    },
    clearOwned(current: () => boolean) {
      return store.write(empty, current, (_previous, owned) =>
        owned ? empty : undefined
      );
    },
  };
}

function createMixedStore(path: string) {
  const observation = slotObservations.get(path) ?? {
    token: {},
    stores: 0,
    tail: Promise.resolve(),
  };
  observation.stores++;
  slotObservations.set(path, observation);
  let owner: { bytes: string; token: object } | undefined;
  const store = createSettingsStore<unknown>(path, (value) => value, {
    maxBytes: MAIN_TAB_METADATA_MAX_BYTES,
    // Classify future bodies separately while still refusing them in the update.
    validateData: (value) =>
      decodeMixedMainTabMetadata(value).status !== "invalid",
  });
  let closed = false;
  let queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(
    operation: () => Promise<T>,
    reject: (reason: ReadFailure) => T
  ): Promise<T> {
    if (closed || queued >= 64)
      return Promise.resolve(reject(closed ? "closed" : "queue-full"));
    queued++;
    const next = observation.tail.then(operation).catch(() => reject("io"));
    observation.tail = next;
    tail = next.finally(() => {
      queued--;
    });
    return next;
  }
  async function read(): Promise<MixedMainTabMetadataRead> {
    const persisted = await store.observePersisted((value, bytes) => {
      if (owner && (owner.token !== observation.token || owner.bytes !== bytes))
        owner = undefined;
      return value;
    });
    if (persisted.status !== "valid") return persisted;
    if (persisted.format !== "version1") return { status: "legacy" };
    const decoded = decodeMixedMainTabMetadata(persisted.data);
    return decoded.status === "valid"
      ? decoded
      : { status: decoded.status === "future" ? "future" : "corrupt" };
  }
  return {
    hasOwnership() {
      return !closed && !!owner && owner.token === observation.token;
    },
    read() {
      return enqueue(read, (status) => ({ status }));
    },
    write(
      value: unknown,
      current: () => boolean,
      merge?: (
        previous: MixedMainTabMetadata | undefined,
        owned: boolean
      ) => MixedMainTabMetadata | undefined
    ): Promise<MainTabMetadataWrite> {
      let live = true;
      const admitted = () => {
        try {
          live = live && current() === true;
        } catch {
          live = false;
        }
        return live;
      };
      if (!admitted())
        return Promise.resolve({ status: "rejected", reason: "stale" });
      let captured: MixedMainTabMetadata | undefined;
      try {
        captured = copyMixedMainTabMetadata(value);
      } catch {
        /* Inputs may include throwing getters. */
      }
      if (!captured)
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      const candidate = captured;
      if (
        Buffer.byteLength(
          `${JSON.stringify({ version: 1, data: candidate }, null, 2)}\n`
        ) > MAIN_TAB_METADATA_MAX_BYTES
      )
        return Promise.resolve({ status: "rejected", reason: "capacity" });
      let encoded = JSON.stringify(candidate);
      return enqueue<MainTabMetadataWrite>(
        async () => {
          if (!admitted()) return { status: "rejected", reason: "stale" };
          let protectedFormat: "legacy" | "future" | undefined;
          let mergeFailure: "invalid" | "capacity" | "not-owned" | undefined;
          let publishedBytes: string | undefined;
          let publicationCurrent: (() => boolean) | undefined;
          const result = await store.updateObserved(
            (previous, format, original) => {
              publicationCurrent = checkpointPublicationGuard(
                original,
                path,
                admitted,
                () => {
                  owner = undefined;
                  observation.token = {};
                }
              );
              const owned =
                !!owner &&
                owner.token === observation.token &&
                owner.bytes === original;
              if (!owned) owner = undefined;
              if (format === "legacy") protectedFormat = "legacy";
              else if (
                format === "version1" &&
                decodeMixedMainTabMetadata(previous).status === "future"
              )
                protectedFormat = "future";
              if (protectedFormat)
                throw Error("Protected mixed session format");
              const decoded =
                format === "missing"
                  ? undefined
                  : decodeMixedMainTabMetadata(previous);
              const proposed = merge
                ? merge(
                    decoded?.status === "valid" ? decoded.data : undefined,
                    owned
                  )
                : candidate;
              if (proposed === undefined) {
                mergeFailure = "not-owned";
                throw Error("Checkpoint is not owned");
              }
              const merged = copyMixedMainTabMetadata(proposed);
              if (!merged) {
                mergeFailure = "invalid";
                throw Error("Invalid merged checkpoint");
              }
              const bytes = `${JSON.stringify({ version: 1, data: merged }, null, 2)}\n`;
              if (Buffer.byteLength(bytes) > MAIN_TAB_METADATA_MAX_BYTES) {
                mergeFailure = "capacity";
                throw Error("Merged checkpoint capacity");
              }
              encoded = JSON.stringify(merged);
              if (bytes !== original) {
                publishedBytes = bytes;
              }
              return merged;
            },
            () => publicationCurrent?.() === true
          );
          if ("stale" in result && result.stale)
            return { status: "rejected", reason: "stale" };
          if (result.attempted) {
            if (publishedBytes !== undefined) observation.token = {};
            const persisted = result.persisted;
            if (
              persisted.status === "valid" &&
              persisted.format === "version1" &&
              JSON.stringify(persisted.data) === encoded
            ) {
              if (result.confirmed && publishedBytes !== undefined && !closed)
                owner = { bytes: publishedBytes, token: observation.token };
              else if (!result.confirmed) owner = undefined;
              return { status: "committed" };
            }
            owner = undefined;
            return { status: "unknown", reason: "io" };
          }
          if (mergeFailure) return { status: "rejected", reason: mergeFailure };
          if (protectedFormat)
            return { status: "rejected", reason: protectedFormat };
          const observed = await read();
          return observed.status === "valid" || observed.status === "missing"
            ? { status: "unknown", reason: "io" }
            : { status: "rejected", reason: observed.status };
        },
        (reason) => ({ status: "rejected", reason })
      );
    },
    async close() {
      if (closed) {
        await tail;
        return;
      }
      closed = true;
      owner = undefined;
      await tail;
      owner = undefined;
      if (--observation.stores === 0) slotObservations.delete(path);
    },
  };
}
