import { captureMainTabMetadataInput } from "./main-tab-binder";
import {
  readMainTabCheckpointCoexistence,
  type MainTabCheckpointCoexistenceRead,
} from "./main-tab-checkpoint-coexistence";
import {
  createMainTabCheckpointMetadataStore,
  type MainTabMetadataWrite,
} from "./main-tab-metadata";
import { createMainTabMixedMetadataBinder } from "./main-tab-mixed-binder";
import { createMixedMainTabCheckpointMetadataStore } from "./main-tab-mixed-metadata-store";

type MixedCheckpointWrite =
  | MainTabMetadataWrite
  | { status: "rejected"; reason: "unavailable" | "empty" };

/** Trusted backend candidate: no automatic triggers, restoration, or document reads. */
export function createGuardedMixedMainTabCheckpoint(
  dataDir: string,
  dependencies: Parameters<typeof createMainTabMixedMetadataBinder>[0]
) {
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
      try {
        input = captureMainTabMetadataInput(value);
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
          return mixed.write(bound.data, () => admitted() && bound.current());
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
