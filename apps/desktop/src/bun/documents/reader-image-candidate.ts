import { dirname, join } from "node:path";

import { localImageReference } from "../../shared/local-images";
import { isCanonicalBase64, READER_SNAPSHOT_MAX_BYTES } from "../../shared/reader-snapshot";

import { resolveSaveWorkerEntry } from "./atomic-save";

interface CandidateWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(request: { protocolVersion: 1; data: string }): void;
  terminate(): void;
}

function responseReference(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2) return undefined;
  const response = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(response, "protocolVersion") ||
      !Object.prototype.hasOwnProperty.call(response, "reference") ||
      response.protocolVersion !== 1 || typeof response.reference !== "string")
    return undefined;
  const path = localImageReference(response.reference);
  return path !== null && /\.(?:png|jpe?g)$/i.test(path) ? response.reference : undefined;
}

/** One pure parser worker per eligible child. No file authorization enters it. */
export function findSavedReaderImageCandidate(
  base64: string,
  signal?: AbortSignal,
  options: { createWorker?: (entry: string) => CandidateWorker; timeoutMs?: number } = {}
): Promise<string | undefined> {
  if (signal?.aborted || !base64 || !isCanonicalBase64(base64, READER_SNAPSHOT_MAX_BYTES))
    return Promise.resolve(undefined);
  return new Promise(resolve => {
    let worker: CandidateWorker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (reference?: string) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try { worker.terminate(); } catch { reference = undefined; }
      }
      resolve(reference);
    };
    const abort = () => finish();
    try {
      const saveEntry = resolveSaveWorkerEntry(import.meta.dir);
      if (!saveEntry) { finish(); return; }
      worker = (options.createWorker ?? (entry => new Worker(entry)))(
        join(dirname(saveEntry), "reader-image-candidate-worker.js")
      );
      worker.onmessage = event => finish(signal?.aborted ? undefined : responseReference(event.data));
      worker.onerror = event => { event.preventDefault(); finish(); };
      worker.onmessageerror = () => finish();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { finish(); return; }
      timer = setTimeout(abort, options.timeoutMs ?? 5_000);
      worker.postMessage({ protocolVersion: 1, data: base64 });
    } catch {
      finish();
    }
  });
}
