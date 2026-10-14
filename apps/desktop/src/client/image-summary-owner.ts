import type { Text } from "@codemirror/state";

import {
  imageResponseEnvelope,
  validateImageSummary,
  type ImageSummaryRequest,
} from "./image-summary-protocol";
import { IMAGE_SUMMARY_CONFIG, type ImageSummary } from "./image-summary-types";

export interface ImageSummaryIdentity {
  documentId: string;
  revision: number;
  doc: Text;
  rawText: string;
  identity: object;
}
export interface ImageSummaryWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: ImageSummaryRequest): void;
  terminate(): void;
}
export type ImageSummaryState =
  | { status: "idle" | "waiting" | "running" | "failed" }
  | { status: "ready"; summary: ImageSummary };
export function createImageSummaryOwner(
  current: () => ImageSummaryIdentity | null,
  factory: () => ImageSummaryWorker,
  notify: () => void,
  schedule = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  }
) {
  let state: ImageSummaryState = { status: "idle" },
    captured: ImageSummaryIdentity | null = null,
    generation = 0,
    disposed = false,
    wanted = false;
  let worker: ImageSummaryWorker | undefined,
    timer: (() => void) | undefined,
    deadline: (() => void) | undefined;
  const matches = () => {
    const s = current();
    return (
      !!s &&
      !!captured &&
      s.documentId === captured.documentId &&
      s.revision === captured.revision &&
      s.doc === captured.doc &&
      s.rawText === captured.rawText &&
      s.identity === captured.identity
    );
  };
  const stop = () => {
    timer?.();
    deadline?.();
    timer = deadline = undefined;
    if (worker) {
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
      worker = undefined;
    }
  };
  const reset = () => {
    generation++;
    stop();
    captured = null;
    state = { status: "idle" };
  };
  const valid = (id: number) =>
    !disposed && wanted && generation === id && matches();
  const fail = (id: number) => {
    if (generation !== id) return;
    stop();
    if (!valid(id)) reset();
    else state = { status: "failed" };
    notify();
  };
  const begin = (id: number) => {
    if (id !== generation) return;
    timer = undefined;
    if (!valid(id)) {
      reset();
      return;
    }
    state = { status: "running" };
    try {
      worker = factory();
      worker.onerror = worker.onmessageerror = () => fail(id);
      worker.onmessage = (event) => {
        if (!valid(id)) {
          if (generation === id) reset();
          return;
        }
        const response = event.data;
        if (
          !imageResponseEnvelope(response) ||
          response.requestId !== id ||
          response.documentId !== captured!.documentId ||
          response.revision !== captured!.revision
        ) {
          fail(id);
          return;
        }
        stop();
        deadline = schedule(() => fail(id), 15000);
        const validation = validateImageSummary(
          response.summary,
          captured!.rawText.length,
          captured!.doc.length
        );
        const step = () => {
          if (id !== generation) return;
          timer = undefined;
          if (!valid(id)) {
            if (generation === id) reset();
            return;
          }
          for (let work = 0; work < 32; work++) {
            const result = validation.next();
            if (result.done) {
              if (!result.value) {
                fail(id);
                return;
              }
              deadline?.();
              deadline = undefined;
              state = { status: "ready", summary: response.summary };
              notify();
              return;
            }
          }
          timer = schedule(step, 0);
        };
        step();
      };
      deadline = schedule(() => fail(id), 15000);
      worker.postMessage({
        requestId: id,
        documentId: captured!.documentId,
        revision: captured!.revision,
        config: IMAGE_SUMMARY_CONFIG,
        text: captured!.rawText,
      });
    } catch {
      fail(id);
    }
  };
  const observe = (candidate: boolean) => {
    wanted = candidate;
    if (disposed) return;
    if (!candidate || !current()) {
      reset();
      return;
    }
    if (captured && matches()) return;
    reset();
    captured = current();
    state = { status: "waiting" };
    const id = generation;
    timer = schedule(() => begin(id), 120);
  };
  return {
    observe,
    getSnapshot: () => state,
    isCurrent: () => !disposed && wanted && matches(),
    retry() {
      if (state.status !== "failed") return;
      reset();
      observe(wanted);
    },
    dispose() {
      disposed = true;
      reset();
    },
  };
}
