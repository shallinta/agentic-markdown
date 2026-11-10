import {
  captureMainTabMetadataInput,
  createMainTabMetadataBinder,
} from "./main-tab-binder";
import {
  createMainTabCheckpointMetadataStore,
  type MainTabMetadataWrite,
} from "./main-tab-metadata";

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
      const captured = captureMainTabMetadataInput(input);
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
          return store.write(bound.data, () => admitted() && bound.current());
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
