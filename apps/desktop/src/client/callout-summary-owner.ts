import type { Text } from "@codemirror/state";

import {
  CALLOUT_SUMMARY_CONFIG,
  isCalloutSummaryResponse,
  type CalloutDefinitions,
  type CalloutSummaryRequest,
} from "./callout-summary-protocol";

export interface CalloutSummarySource {
  documentId: string;
  revision: number;
  doc: Text;
  rawText: string;
  identity: object;
  config: typeof CALLOUT_SUMMARY_CONFIG;
}
export interface CalloutSummaryWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: CalloutSummaryRequest): void;
  terminate(): void;
}
export type CalloutSummaryState =
  | { status: "idle" | "waiting" | "running" | "validating" | "failed" }
  | { status: "ready"; definitions: CalloutDefinitions };

/** Injectable task scheduling is only a clock seam, not a different execution path. */
export interface CalloutSummaryOwnerOptions {
  schedule?: (task: () => void, milliseconds: number) => () => void;
}
const scheduleTask = (task: () => void, milliseconds: number) => {
  const timer = setTimeout(task, milliseconds);
  return () => clearTimeout(timer);
};

/** One view owns one derived summary. Returning null from current revokes authority,
 * including controller/view mismatch, composition, source/safe mode and freezing.
 * The binding must observe after an accepted view update, not only before it. */
export function createCalloutSummaryOwner(
  current: () => CalloutSummarySource | null,
  factory: () => CalloutSummaryWorker,
  options: CalloutSummaryOwnerOptions = {}
) {
  const schedule = options.schedule ?? scheduleTask;
  let state: CalloutSummaryState = { status: "idle" };
  let captured: CalloutSummarySource | null = null;
  let generation = 0;
  let disposed = false;
  let candidate = false;
  let worker: CalloutSummaryWorker | undefined;
  let cancelTask: (() => void) | undefined;
  let cancelDeadline: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: CalloutSummaryState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const matches = () => {
    const source = current();
    return (
      !disposed &&
      candidate &&
      !!source &&
      !!captured &&
      source.documentId === captured.documentId &&
      source.revision === captured.revision &&
      source.doc === captured.doc &&
      source.rawText === captured.rawText &&
      source.identity === captured.identity &&
      source.config === captured.config
    );
  };
  const stopWorker = () => {
    if (!worker) return;
    const stopped = worker;
    worker = undefined;
    stopped.onmessage = stopped.onerror = stopped.onmessageerror = null;
    stopped.terminate();
  };
  const stop = () => {
    cancelTask?.();
    cancelDeadline?.();
    cancelTask = cancelDeadline = undefined;
    stopWorker();
  };
  const reset = () => {
    generation++;
    stop();
    captured = null;
    if (state.status !== "idle") publish({ status: "idle" });
  };
  const valid = (id: number) => id === generation && matches();
  const fail = (id: number) => {
    if (
      id !== generation ||
      state.status === "ready" ||
      state.status === "failed" ||
      state.status === "idle"
    )
      return;
    stop();
    if (!matches()) reset();
    else publish({ status: "failed" });
  };
  const begin = (id: number) => {
    cancelTask = undefined;
    if (!valid(id)) {
      if (id === generation) reset();
      return;
    }
    const source = captured!;
    publish({ status: "running" });
    if (!valid(id)) {
      if (id === generation) reset();
      return;
    }
    try {
      worker = factory();
      worker.onerror = worker.onmessageerror = () => fail(id);
      worker.onmessage = (event) => {
        if (id !== generation || state.status !== "running") return;
        if (!valid(id)) {
          if (id === generation) reset();
          return;
        }
        const response = event.data;
        if (
          !isCalloutSummaryResponse(response) ||
          response.requestId !== id ||
          response.documentId !== source.documentId ||
          response.revision !== source.revision ||
          response.config !== source.config
        ) {
          fail(id);
          return;
        }
        // The response is finite by the worker's validated input. Do not truncate
        // the set: references beyond an arbitrary cap still change semantics.
        // The fixed worker owns label normalization. Here validate the typed
        // shape in slices; Set hashing/clone time is not a hard runtime budget.
        stopWorker();
        cancelDeadline?.();
        cancelDeadline = undefined;
        const labels = response.definitions;
        const definitions = new Set<string>();
        let index = 0;
        let offset = 0;
        publish({ status: "validating" });
        const step = () => {
          cancelTask = undefined;
          if (!valid(id)) {
            if (id === generation) reset();
            return;
          }
          let nodes = 0,
            characters = 0;
          while (index < labels.length && nodes < 2048 && characters < 8192) {
            const label = labels[index];
            nodes++;
            if (typeof label !== "string" || label.length === 0) {
              fail(id);
              return;
            }
            const consumed = Math.min(
              label.length - offset,
              4096,
              8192 - characters
            );
            offset += consumed;
            characters += consumed;
            if (offset === label.length) {
              definitions.add(label);
              index++;
              offset = 0;
            }
          }
          if (index === labels.length)
            publish({ status: "ready", definitions });
          else cancelTask = schedule(step, 0);
        };
        // Collection validation yields to a task rather than scanning in this callback.
        if (valid(id)) cancelTask = schedule(step, 0);
        else if (id === generation) reset();
      };
      cancelDeadline = schedule(() => fail(id), 15000);
      worker.postMessage({
        requestId: id,
        documentId: source.documentId,
        revision: source.revision,
        config: source.config,
        text: source.rawText,
      });
    } catch {
      fail(id);
    }
  };
  const observe = (hasCandidate: boolean) => {
    if (disposed) return;
    candidate = hasCandidate;
    if (captured && matches()) return;
    reset();
    // A synchronous subscriber may have already observed the replacement source.
    if (captured && matches()) return;
    const source = current();
    if (!candidate || !source) return;
    captured = { ...source };
    const id = generation;
    if (source.config !== CALLOUT_SUMMARY_CONFIG) {
      publish({ status: "failed" });
      return;
    }
    publish({ status: "waiting" });
    if (valid(id)) cancelTask = schedule(() => begin(id), 120);
    else if (id === generation) reset();
  };
  return {
    getSnapshot: () => state,
    isCurrent: (definitions: CalloutDefinitions) =>
      state.status === "ready" &&
      state.definitions === definitions &&
      matches(),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    observe,
    retry() {
      if (disposed || state.status !== "failed" || !matches()) return false;
      reset();
      observe(candidate);
      return true;
    },
    cancel() {
      candidate = false;
      reset();
    },
    dispose() {
      disposed = true;
      listeners.clear();
      candidate = false;
      reset();
    },
  };
}
