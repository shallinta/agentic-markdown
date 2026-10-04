import { dirname, join } from "node:path";

import { type LocalImageResult } from "../../shared/local-images";

import { resolveSaveWorkerEntry } from "./atomic-save";
import { validImageWorkerResponse } from "./image-worker-protocol";
import type { ImageJob } from "./local-image-operation";

/** One worker, one active job and at most eight waiting. Timeout is not fd cancellation. */
export function createImageReader(
  options: { createWorker?: (entry: string) => Worker; timeoutMs?: number } = {}
) {
  let worker: Worker | undefined,
    disposed = false,
    stalled = false,
    sequence = 0;
  interface Job {
    id: number;
    input: ImageJob;
    resolve: (result: LocalImageResult) => void;
    timer?: ReturnType<typeof setTimeout>;
  }
  let active: Job | undefined;
  const queue: Job[] = [];
  const failure: LocalImageResult = { ok: false, error: "UNAVAILABLE" };
  const drain = () => {
    if (active || disposed || !queue.length) return;
    active = queue.shift()!;
    try {
      if (!worker) {
        const entry = resolveSaveWorkerEntry(import.meta.dir);
        if (!entry) throw Error();
        worker = (options.createWorker ?? ((path) => new Worker(path)))(
          join(dirname(entry), "image-worker.js")
        );
        worker.onmessage = (event: MessageEvent<unknown>) => {
          const message = event.data;
          if (
            !active ||
            !validImageWorkerResponse(message) ||
            message.id !== active.id
          )
            return;
          clearTimeout(active.timer);
          active.resolve(message.result);
          active = undefined;
          stalled = false;
          if (disposed) {
            worker?.terminate();
            worker = undefined;
          } else drain();
        };
        worker.onerror = () => {
          // A crashed native job cannot prove raw descriptors were closed. Fail
          // closed and never spawn repeated workers in this service lifetime.
          disposed = true;
          active?.resolve(failure);
          clearTimeout(active?.timer);
          active = undefined;
          for (const item of queue.splice(0)) item.resolve(failure);
        };
      }
      const current = active;
      current.timer = setTimeout(() => {
        stalled = true;
        current.resolve(failure);
        for (const item of queue.splice(0)) item.resolve(failure);
      }, options.timeoutMs ?? 10000);
      worker.postMessage({
        protocolVersion: 1,
        kind: "read-local-image",
        id: current.id,
        job: current.input,
      });
    } catch {
      active.resolve(failure);
      active = undefined;
      disposed = true;
      for (const item of queue.splice(0)) item.resolve(failure);
    }
  };
  return {
    read(input: ImageJob): Promise<LocalImageResult> {
      if (disposed || stalled) return Promise.resolve(failure);
      if (queue.length >= 8)
        return Promise.resolve({ ok: false, error: "BUSY" });
      return new Promise((resolve) => {
        queue.push({ id: ++sequence, input, resolve });
        drain();
      });
    },
    dispose() {
      disposed = true;
      for (const item of queue.splice(0)) item.resolve(failure);
      active?.resolve(failure);
      if (!active) {
        worker?.terminate();
        worker = undefined;
      }
    },
  };
}
