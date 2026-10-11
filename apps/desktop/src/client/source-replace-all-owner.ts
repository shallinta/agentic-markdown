import {
  validReplaceAllResult,
  type ReplaceAllRequest,
  type ReplaceAllResult,
} from "./source-replace-all-protocol";
import type { SearchOptions } from "./source-search-protocol";

export interface AllSource {
  session: object;
  text: object;
  raw: string;
  length: number;
  options: SearchOptions;
  replacement: string;
}
export interface AllWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(request: ReplaceAllRequest): void;
  terminate(): void;
}
export const allConditions = (s: AllSource) =>
  JSON.stringify([
    s.options.query,
    s.options.caseSensitive,
    s.options.wholeWord,
    s.replacement,
  ]);
export const sameAllSource = (a: AllSource, b: AllSource | null) =>
  !!b &&
  a.session === b.session &&
  a.text === b.text &&
  a.raw === b.raw &&
  allConditions(a) === allConditions(b);

/** Separate operation, no query/navigation queue. observe() is called synchronously. */
export function createReplaceAllOwner(
  factory: () => AllWorker,
  current: () => AllSource | null,
  receive: (result: ReplaceAllResult, source: AllSource) => void,
  status: (value: "idle" | "running" | "failed") => void,
  timeoutMs = 15000
) {
  let worker: AllWorker | undefined, source: AllSource | undefined;
  let failedSource: AllSource | undefined;
  let id = 0,
    disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clear = () => {
    const old = worker;
    worker = undefined;
    source = undefined;
    clearTimeout(timer);
    timer = undefined;
    if (old) {
      old.onmessage = old.onerror = old.onmessageerror = null;
      old.terminate();
    }
  };
  const cancel = () => {
    failedSource = undefined;
    clear();
    if (!disposed) status("idle");
  };
  const fail = () => {
    failedSource = source;
    clear();
    if (!disposed) status("failed");
  };
  return {
    running: () => !!worker,
    cancel,
    observe() {
      const captured = source ?? failedSource;
      if (captured && !sameAllSource(captured, current())) cancel();
    },
    start() {
      if (disposed || worker) return false;
      const now = current();
      if (!now?.options.query) return false;
      failedSource = undefined;
      source = { ...now, options: { ...now.options } };
      const snapshot = source,
        requestId = ++id;
      status("running");
      try {
        const created = factory();
        worker = created;
        const live = () =>
          !disposed && worker === created && source === snapshot;
        created.onerror = created.onmessageerror = () => {
          if (live()) fail();
        };
        created.onmessage = (event) => {
          if (!live()) return;
          if (!sameAllSource(snapshot, current())) {
            cancel();
            return;
          }
          if (!validReplaceAllResult(event.data, requestId, snapshot.length)) {
            fail();
            return;
          }
          const result = event.data;
          clear();
          status("idle");
          if (!disposed && sameAllSource(snapshot, current()))
            receive(result, snapshot);
        };
        timer = setTimeout(() => {
          if (live()) fail();
        }, timeoutMs);
        created.postMessage({
          id: requestId,
          raw: snapshot.raw,
          options: snapshot.options,
          replacement: snapshot.replacement,
        });
        return true;
      } catch {
        fail();
        return false;
      }
    },
    dispose() {
      disposed = true;
      failedSource = undefined;
      clear();
    },
  };
}
