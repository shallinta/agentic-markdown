import {
  CANONICAL_CONFIG,
  isCanonicalRequest,
  type CanonicalRequest,
  type CanonicalResult,
} from "./current-canonical-protocol";

export interface CanonicalSource {
  documentId: string;
  revision: number;
  text: string;
  /** Stable editor session identity detects reload with a reset revision. */
  identity: object;
}
export interface CurrentCanonicalWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(value: CanonicalRequest): void;
  terminate(): void;
}
export type CurrentCanonicalState =
  | { status: "idle" | "running" | "failed" }
  | { status: "ready"; result: CanonicalResult };

/** A single, lazy current-document consumer; no background queue or cross-tab cache. */
export function createCurrentCanonical(
  current: () => CanonicalSource | null,
  factory: () => CurrentCanonicalWorker
) {
  let state: CurrentCanonicalState = { status: "idle" };
  let captured: CanonicalSource | null = null;
  let generation = 0;
  let disposed = false;
  let stop: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: CurrentCanonicalState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const matches = () => {
    const source = current();
    return (
      !!source &&
      !!captured &&
      source.documentId === captured.documentId &&
      source.revision === captured.revision &&
      source.identity === captured.identity &&
      source.text === captured.text
    );
  };
  const cancel = () => {
    ++generation;
    stop?.();
    stop = undefined;
    captured = null;
    publish({ status: "idle" });
  };
  return {
    getSnapshot: () => state,
    isCurrent: (result: CanonicalResult) =>
      state.status === "ready" && state.result === result && matches(),
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cancel,
    dispose(this: void) {
      disposed = true;
      cancel();
      listeners.clear();
    },
    invalidate(this: void) {
      if (captured && !matches()) cancel();
    },
    request(this: void): Promise<CanonicalResult | null> {
      if (disposed) return Promise.resolve(null);
      cancel();
      const source = current();
      if (!source) return Promise.resolve(null);
      captured = source;
      const id = generation;
      const request = { ...source, requestId: id, config: CANONICAL_CONFIG };
      if (!isCanonicalRequest(request)) {
        captured = null;
        publish({ status: "failed" });
        return Promise.resolve(null);
      }
      publish({ status: "running" });
      return new Promise((resolve) => {
        let worker: CurrentCanonicalWorker | undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let settled = false;
        const finish = (result: CanonicalResult | null, failed = false) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (worker) {
            worker.onmessage = worker.onerror = worker.onmessageerror = null;
            worker.terminate();
          }
          if (id === generation) {
            stop = undefined;
            if (result && matches()) publish({ status: "ready", result });
            else {
              captured = null;
              publish({ status: failed ? "failed" : "idle" });
              result = null;
            }
          } else result = null;
          resolve(result);
        };
        stop = () => finish(null);
        try {
          worker = factory();
          worker.onerror = worker.onmessageerror = () => finish(null, true);
          worker.onmessage = (event) => {
            const data = event.data as {
              ok?: boolean;
              result?: CanonicalResult;
            } | null;
            const result = data?.result;
            if (
              !data?.ok ||
              result?.requestId !== id ||
              result.documentId !== source.documentId ||
              result.revision !== source.revision ||
              result.config !== CANONICAL_CONFIG ||
              result.tree?.type !== "root" ||
              !Array.isArray(result.tree.children) ||
              !Number.isFinite(result.milliseconds) ||
              result.milliseconds < 0
            ) {
              finish(null, true);
              return;
            }
            finish(result);
          };
          timer = setTimeout(() => finish(null, true), 15000);
          // Do not clone editor identity or unrelated controller state into the Worker.
          worker.postMessage({
            requestId: id,
            documentId: source.documentId,
            revision: source.revision,
            config: CANONICAL_CONFIG,
            text: source.text,
          });
        } catch {
          finish(null, true);
        }
      });
    },
  };
}
