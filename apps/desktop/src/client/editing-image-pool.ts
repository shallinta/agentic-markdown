import {
  localImageReference,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_CACHE_BYTES,
  validLocalImageResponse,
  type LocalImageResult,
} from "../shared/local-images";

import type { ImageTransport } from "./local-images";

type Success = Extract<LocalImageResult, { ok: true }>;
export type EditingImageState =
  | { status: "loading" | "budget" | "failed" | "released" }
  | { status: "ready"; result: Success };
interface Lease {
  live: boolean;
  bytes: number;
  state: EditingImageState;
  notify: () => void;
}
interface Entry {
  key: string;
  reference: string;
  epoch: number;
  leases: Set<Lease>;
  status: "waiting" | "running" | "ready" | "budget" | "failed";
  cost: number;
  result?: Success;
}
/** Editing demand owns resources, not all references ever seen. A cancelled running
 * transport retains its slot until finally, including across asset epochs. */
export function createEditingImagePool(
  handle: string,
  transport: ImageTransport
) {
  let epoch = 0,
    disposed = false,
    running = false,
    retained = 0,
    presentation = 0,
    inflight = 0;
  const entries = new Map<string, Entry>();
  const pending = new Set<Entry>(),
    budgetBlocked = new Set<Entry>(),
    displayBlocked = new Set<Entry>();
  let dequeued = 0,
    capacityVisited = 0,
    capacityQueued = false;
  const publish = (lease: Lease, state: EditingImageState) => {
    lease.state = state;
    queueMicrotask(() => {
      if (lease.live) lease.notify();
    });
  };
  const alive = (entry: Entry) =>
    !disposed &&
    entry.epoch === epoch &&
    entries.get(entry.key) === entry &&
    entry.leases.size > 0;
  function display(entry: Entry) {
    if (!entry.result) return;
    displayBlocked.delete(entry);
    for (const lease of entry.leases) {
      if (lease.bytes) continue;
      const bytes = entry.result.width * entry.result.height * 4;
      if (retained + presentation + bytes <= MAX_IMAGE_CACHE_BYTES) {
        lease.bytes = bytes;
        presentation += bytes;
        publish(lease, { status: "ready", result: entry.result });
      } else {
        displayBlocked.add(entry);
        publish(lease, { status: "budget" });
      }
    }
  }
  function capacity() {
    if (capacityQueued) return;
    capacityQueued = true;
    queueMicrotask(() => {
      capacityQueued = false;
      if (disposed) return;
      for (const entry of budgetBlocked) {
        capacityVisited++;
        entry.status = "waiting";
        pending.add(entry);
      }
      budgetBlocked.clear();
      // Snapshot because display may remove/re-add the still blocked entry.
      for (const entry of [...displayBlocked]) {
        capacityVisited++;
        display(entry);
      }
      pump();
    });
  }
  async function read(entry: Entry) {
    const requestId = crypto.randomUUID();
    try {
      const value = await transport({
        protocolVersion: 1,
        requestId,
        handle,
        reference: entry.reference,
      });
      if (!alive(entry)) return;
      if (
        !validLocalImageResponse(value) ||
        value.requestId !== requestId ||
        !value.ok
      ) {
        entry.status = "failed";
        for (const lease of entry.leases) publish(lease, { status: "failed" });
        return;
      }
      const cost = value.data.length * 2 + value.width * value.height * 4;
      if (retained + presentation + cost > MAX_IMAGE_CACHE_BYTES) {
        entry.status = "budget";
        budgetBlocked.add(entry);
        for (const lease of entry.leases) publish(lease, { status: "budget" });
        return;
      }
      entry.result = value;
      entry.cost = cost;
      retained += cost;
      entry.status = "ready";
      display(entry);
    } catch {
      if (alive(entry)) {
        entry.status = "failed";
        for (const lease of entry.leases) publish(lease, { status: "failed" });
      }
    } finally {
      running = false;
      inflight = 0;
      queueMicrotask(pump);
    }
  }
  function pump() {
    if (disposed || running) return;
    // Insertion-ordered Set is an O(1) dequeue/cancel FIFO of live demand only.
    // Completed/failed entries are never rescanned when selecting the next item.
    const entry = pending.values().next().value;
    if (entry) {
      pending.delete(entry);
      dequeued++;
      entry.status = "running";
      running = true;
      inflight = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 * 2;
      void read(entry);
    }
  }
  let invalidating = false;
  function invalidate() {
    if (invalidating) return;
    invalidating = true;
    let failed = false,
      failure: unknown;
    epoch++;
    for (const entry of entries.values()) {
      for (const lease of entry.leases) {
        lease.live = false;
        lease.state = { status: "released" };
        try {
          lease.notify();
        } catch (error) {
          failed = true;
          failure = error;
        }
        lease.bytes = 0;
      }
      entry.leases.clear();
      entry.result = undefined;
      entry.cost = 0;
    }
    entries.clear();
    pending.clear();
    budgetBlocked.clear();
    displayBlocked.clear();
    retained = presentation = 0;
    invalidating = false;
    if (failed) throw failure;
  }
  return {
    acquire(reference: string, notify: () => void) {
      const key = localImageReference(reference);
      if (disposed || invalidating || key === null) return null;
      let entry = entries.get(key);
      if (!entry) {
        entry = {
          key,
          reference,
          epoch,
          leases: new Set(),
          status: "waiting",
          cost: 0,
        };
        entries.set(key, entry);
        pending.add(entry);
      }
      const lease: Lease = {
        live: true,
        bytes: 0,
        state: {
          status:
            entry.status === "failed"
              ? "failed"
              : entry.status === "budget"
                ? "budget"
                : "loading",
        },
        notify,
      };
      entry.leases.add(lease);
      if (entry.status === "ready") display(entry);
      pump();
      return {
        getSnapshot: () => lease.state,
        release() {
          if (!lease.live) return;
          lease.live = false;
          lease.state = { status: "released" };
          try {
            lease.notify();
          } finally {
            const before = retained + presentation;
            entry.leases.delete(lease);
            presentation -= lease.bytes;
            lease.bytes = 0;
            if (!entry.leases.size) {
              pending.delete(entry);
              budgetBlocked.delete(entry);
              displayBlocked.delete(entry);
              if (entries.get(key) === entry) entries.delete(key);
              retained -= entry.cost;
              entry.cost = 0;
              entry.result = undefined;
            }
            if (retained + presentation < before) capacity();
            else pump();
          }
        },
      };
    },
    invalidate,
    dispose() {
      if (disposed) return;
      disposed = true;
      invalidate();
    },
    diagnostics: () => ({
      entries: entries.size,
      retained,
      presentation,
      inflight,
      running,
    }),
    scheduling: () => ({ dequeued, waiting: pending.size, capacityVisited }),
  };
}
export type EditingImagePool = ReturnType<typeof createEditingImagePool>;
export type EditingImageLease = NonNullable<
  ReturnType<EditingImagePool["acquire"]>
>;
