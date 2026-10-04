import { dirname, join } from "node:path";

import { resolveSaveWorkerEntry } from "../documents/atomic-save";

/** Caller serializes operations; exactly one Worker and one outstanding message. */
export function createScanWorker() {
  let worker: Worker | undefined;
  let serial = 0;
  let active:
    | { id: number; resolve: (value: unknown) => void; reject: () => void }
    | undefined;
  let disposed = false;
  return {
    call(message: Record<string, unknown>): Promise<unknown> {
      if (disposed || active) return Promise.reject(Error());
      if (!worker) {
        const entry = resolveSaveWorkerEntry(
          join(import.meta.dir, "../documents")
        );
        if (!entry) return Promise.reject(Error());
        worker = new Worker(join(dirname(entry), "scan-worker.js"));
        worker.onmessage = (event) => {
          const response: unknown = event.data;
          if (
            !active ||
            !response ||
            typeof response !== "object" ||
            !("id" in response) ||
            response.id !== active.id
          )
            return;
          const pending = active;
          active = undefined;
          if ("ok" in response && response.ok === true && "result" in response)
            pending.resolve(response.result);
          else pending.reject();
          if (disposed) worker?.terminate();
        };
        worker.onerror = () => {
          const pending = active;
          active = undefined;
          disposed = true;
          pending?.reject();
          worker?.terminate();
        };
      }
      return new Promise((resolve, reject) => {
        active = { id: ++serial, resolve, reject: () => reject(Error()) };
        worker!.postMessage({ ...message, id: serial });
      });
    },
    dispose() {
      disposed = true;
      if (!active) worker?.terminate();
    },
  };
}
