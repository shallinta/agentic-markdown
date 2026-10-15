import {
  FRONTMATTER_DIAGNOSTIC_CONFIG,
  FRONTMATTER_DIAGNOSTIC_LIMIT,
  validFrontmatterDiagnostic,
  type FrontmatterDiagnosticRequest,
  type FrontmatterDiagnosticResult,
} from "./frontmatter-diagnostic-protocol";

export interface FrontmatterDiagnosticWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(value: FrontmatterDiagnosticRequest): void;
  terminate(): void;
}
export type DiagnosticOutcome =
  | { status: "ready"; result: FrontmatterDiagnosticResult }
  | { status: "unavailable" | "cancelled" };
/** One in-flight task; caller owns the current document/header/composition ticket. */
export function createFrontmatterDiagnosticOwner(
  factory: () => FrontmatterDiagnosticWorker,
  timeout = 1500
) {
  let generation = 0,
    disposed = false,
    stop: (() => void) | undefined;
  const cancel = () => {
    ++generation;
    const previous = stop;
    stop = undefined;
    previous?.();
  };
  return {
    cancel,
    dispose() {
      disposed = true;
      cancel();
    },
    request(body: string): Promise<DiagnosticOutcome> {
      cancel();
      if (disposed || body.length > FRONTMATTER_DIAGNOSTIC_LIMIT)
        return Promise.resolve({ status: "unavailable" });
      const id = generation;
      return new Promise((resolve) => {
        let worker: FrontmatterDiagnosticWorker | undefined,
          timer: ReturnType<typeof setTimeout> | undefined,
          settled = false;
        const finish = (outcome: DiagnosticOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (worker) {
            worker.onmessage = worker.onerror = worker.onmessageerror = null;
            try {
              worker.terminate();
            } catch {
              /* Retired generation still cannot publish. */
            }
            worker = undefined;
          }
          if (id === generation) stop = undefined;
          resolve(id === generation ? outcome : { status: "cancelled" });
        };
        stop = () => finish({ status: "cancelled" });
        try {
          worker = factory();
          worker.onerror = worker.onmessageerror = () =>
            finish({ status: "unavailable" });
          worker.onmessage = (event) => {
            const value = event.data as {
              config?: unknown;
              requestId?: unknown;
              result?: unknown;
            } | null;
            if (
              value?.config !== FRONTMATTER_DIAGNOSTIC_CONFIG ||
              value.requestId !== id ||
              !validFrontmatterDiagnostic(value.result, body.length)
            )
              finish({ status: "unavailable" });
            else finish({ status: "ready", result: value.result });
          };
          timer = setTimeout(() => finish({ status: "unavailable" }), timeout);
          worker.postMessage({
            config: FRONTMATTER_DIAGNOSTIC_CONFIG,
            requestId: id,
            body,
          });
        } catch {
          finish({ status: "unavailable" });
        }
      });
    },
  };
}
