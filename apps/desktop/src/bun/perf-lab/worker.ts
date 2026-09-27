import { createPerfWorkerState, type WorkerOperation } from "./worker-state";

let state: ReturnType<typeof createPerfWorkerState> | undefined;
self.onmessage = (
  event: MessageEvent<{
    sequence: number;
    limit: number;
    operation: WorkerOperation;
  }>
) => {
  try {
    state ??= createPerfWorkerState(event.data.limit);
    self.postMessage({
      ok: true,
      sequence: event.data.sequence,
      ...state.run(event.data.operation),
    });
  } catch {
    self.postMessage({ ok: false, sequence: event.data.sequence });
  }
};
