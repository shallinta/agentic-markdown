import { lstatSync } from "node:fs";
import { resolve } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import {
  MAIN_TAB_METADATA_MAX_BYTES,
  exactCheckpointBytes,
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

/** Isolated probe only. The ordinary checkpoint file is not a source for this store. */
export function createMixedMainTabMetadataStore(isolatedDir: string) {
  const path = resolve(isolatedDir, "main-tab-session-mixed-probe.json");
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
    const next = tail.then(operation).catch(() => reject("io"));
    tail = next.finally(() => {
      queued--;
    });
    return next;
  }
  async function read(): Promise<MixedMainTabMetadataRead> {
    const persisted = await store.readPersisted();
    if (persisted.status !== "valid") return persisted;
    if (persisted.format !== "version1") return { status: "legacy" };
    const decoded = decodeMixedMainTabMetadata(persisted.data);
    return decoded.status === "valid"
      ? decoded
      : { status: decoded.status === "future" ? "future" : "corrupt" };
  }
  return {
    read() {
      return enqueue(read, (status) => ({ status }));
    },
    write(
      value: unknown,
      current: () => boolean
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
      const encoded = JSON.stringify(candidate);
      return enqueue<MainTabMetadataWrite>(
        async () => {
          if (!admitted()) return { status: "rejected", reason: "stale" };
          let protectedFormat: "legacy" | "future" | undefined;
          let originalBytes: string | undefined;
          let observedOriginal = false;
          const publicationCurrent = () => {
            if (!admitted() || !observedOriginal) return false;
            if (originalBytes !== undefined) {
              live = exactCheckpointBytes(path, originalBytes, () => live);
              return live;
            }
            try {
              lstatSync(path);
              live = false;
            } catch (error) {
              live =
                !!error &&
                typeof error === "object" &&
                "code" in error &&
                error.code === "ENOENT";
            }
            return live;
          };
          const result = await store.updateObserved(
            (previous, format, original) => {
              originalBytes = original;
              observedOriginal = true;
              if (format === "legacy") protectedFormat = "legacy";
              else if (
                format === "version1" &&
                decodeMixedMainTabMetadata(previous).status === "future"
              )
                protectedFormat = "future";
              if (protectedFormat)
                throw Error("Protected mixed session format");
              return candidate;
            },
            publicationCurrent
          );
          if ("stale" in result && result.stale)
            return { status: "rejected", reason: "stale" };
          if (result.attempted) {
            const persisted = result.persisted;
            return persisted.status === "valid" &&
              persisted.format === "version1" &&
              JSON.stringify(persisted.data) === encoded
              ? { status: "committed" }
              : { status: "unknown", reason: "io" };
          }
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
      closed = true;
      await tail;
    },
  };
}
