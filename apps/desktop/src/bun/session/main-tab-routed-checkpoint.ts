import {
  validMainTabCheckpointTabs,
  type MainTabSourceInput,
} from "../../shared/main-tab-checkpoint";
import type { TrustedDocumentService } from "../documents";

import { createGuardedMainTabCheckpoint } from "./main-tab-checkpoint";
import type { MainTabMetadataObservation } from "./main-tab-metadata";
import { createGuardedMixedMainTabCheckpoint } from "./main-tab-mixed-checkpoint";

type Dependencies = Parameters<
  typeof createGuardedMixedMainTabCheckpoint
>[1] & {
  documents: Pick<
    TrustedDocumentService,
    "captureContentSearchBindings" | "captureViewportSource"
  >;
};
type Result = Awaited<
  ReturnType<ReturnType<typeof createGuardedMixedMainTabCheckpoint>["write"]>
>;

/** A single main-window lifetime, routed only by currently trusted grants. */
export function createRoutedMainTabCheckpoint(
  dataDir: string,
  dependencies: Dependencies
) {
  const directory = createGuardedMainTabCheckpoint(dataDir, {
    ...dependencies,
    captureViewportSource: (tab, current) =>
      dependencies.documents.captureViewportSource(tab, current),
  });
  const mixed = createGuardedMixedMainTabCheckpoint(dataDir, {
    ...dependencies,
    captureViewportSource: (tab, current) =>
      dependencies.captureViewportSource
        ? dependencies.captureViewportSource(tab, current)
        : dependencies.documents.captureViewportSource(tab, current, "mixed"),
  });
  let mixedActive = false,
    closed = false,
    queued = 0;
  let tail: Promise<unknown> = Promise.resolve();
  function enqueue<T>(
    current: () => boolean,
    operation: (check: () => boolean) => Promise<T>,
    reject: (reason: "closed" | "queue-full" | "stale" | "io") => T
  ): Promise<T> {
    if (closed || queued >= 64)
      return Promise.resolve(reject(closed ? "closed" : "queue-full"));
    let live = true;
    const check = () => {
      try {
        live = live && !closed && current() === true && !closed;
      } catch {
        live = false;
      }
      return live;
    };
    if (!check()) return Promise.resolve(reject("stale"));
    if (queued >= 64) return Promise.resolve(reject("queue-full"));
    queued++;
    const next = tail
      .then(() => (check() ? operation(check) : reject("stale")))
      .catch(() => reject("io"));
    tail = next.finally(() => {
      queued--;
    });
    return next;
  }
  const failure = (reason: "closed" | "queue-full" | "stale" | "io"): Result =>
    reason === "io"
      ? { status: "unknown", reason }
      : { status: "rejected", reason };
  async function mutate(
    check: () => boolean,
    operation: (writer: typeof mixed | typeof directory) => Promise<Result>
  ): Promise<Result> {
    const results: Result[] = [];
    if (mixedActive) results.push(await operation(mixed));
    if (check()) results.push(await operation(directory));
    else results.push({ status: "rejected", reason: "stale" });
    if (results.some((result) => result.status === "unknown"))
      return { status: "unknown", reason: "io" };
    const committed = results.some((result) => result.status === "committed");
    const failed = results.some(
      (result) => result.status === "rejected" && result.reason !== "not-owned"
    );
    if (committed && failed) return { status: "unknown", reason: "io" };
    if (committed) return { status: "committed" };
    return check()
      ? (results.find(
          (result) =>
            result.status === "rejected" && result.reason !== "not-owned"
        ) ?? results[results.length - 1])
      : { status: "rejected", reason: "stale" };
  }
  return {
    write(value: unknown, current: () => boolean): Promise<Result> {
      let input: {
        tabs: import("../../shared/main-tab-checkpoint").MainTabCheckpointSourceInput[];
        activeIndex: number;
      };
      try {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !== "activeIndex,tabs" ||
          !("tabs" in value) ||
          !("activeIndex" in value) ||
          !validMainTabCheckpointTabs(value.tabs) ||
          !value.tabs.length ||
          typeof value.activeIndex !== "number" ||
          !Number.isSafeInteger(value.activeIndex) ||
          value.activeIndex < 0 ||
          value.activeIndex >= value.tabs.length
        )
          return Promise.resolve({ status: "rejected", reason: "invalid" });
        input = {
          activeIndex: value.activeIndex,
          tabs: value.tabs.map((tab) => ({
            ...tab,
            ...(tab.viewport ? { viewport: { ...tab.viewport } } : {}),
          })),
        };
      } catch {
        return Promise.resolve({ status: "rejected", reason: "invalid" });
      }
      return enqueue(
        current,
        async (check) => {
          const captured = dependencies.documents.captureContentSearchBindings(
            input.tabs.map((tab) => tab.handle)
          );
          if (!check()) return { status: "rejected", reason: "stale" };
          if (captured?.bindings.length !== input.tabs.length)
            return { status: "rejected", reason: "unavailable" };
          const proof = () => check() && captured.current() === true;
          if (!proof()) return { status: "rejected", reason: "stale" };
          let standalone = false;
          for (let index = 0; index < input.tabs.length; index++) {
            const tab = input.tabs[index],
              binding = captured.bindings[index];
            if (
              binding?.handle !== tab.handle ||
              binding.documentId !== tab.documentId ||
              binding.hash !== tab.hash ||
              binding.revision !== tab.revision
            )
              return { status: "rejected", reason: "unavailable" };
            if (!binding.scope && binding.verifyStandalone) standalone = true;
            else if (!binding.scope || binding.verifyStandalone)
              return { status: "rejected", reason: "unavailable" };
          }
          if (!standalone && !mixedActive) return directory.write(input, proof);
          const first = await mixed.write(input, proof, undefined, {
            requireOwned: !standalone,
          });
          mixedActive ||= first.status === "committed" && mixed.hasOwnership();
          if (standalone) return first;
          const second: Result = proof()
            ? await directory.write(input, proof)
            : { status: "rejected", reason: "stale" };
          if (first.status === "committed" && second.status === "committed")
            return first;
          if (first.status === "rejected" && second.status === "rejected")
            return first.reason === "not-owned" ? second : first;
          return { status: "unknown", reason: "io" };
        },
        failure
      );
    },
    claim(
      receipt: MainTabMetadataObservation,
      current: () => boolean,
      sources?: readonly MainTabSourceInput[]
    ) {
      return enqueue(
        current,
        (check) => directory.claim(receipt, check, sources),
        () => false
      );
    },
    prune(
      source: { documentId: string; handle: string },
      current: () => boolean
    ) {
      const captured = { documentId: source.documentId, handle: source.handle };
      return enqueue(
        current,
        (check) => mutate(check, (writer) => writer.prune(captured, check)),
        failure
      );
    },
    clear(current: () => boolean) {
      return enqueue(
        current,
        (check) => mutate(check, (writer) => writer.clear(check)),
        failure
      );
    },
    async close() {
      closed = true;
      await tail;
      await Promise.all([directory.close(), mixed.close()]);
    },
  };
}
