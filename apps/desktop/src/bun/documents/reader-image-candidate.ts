import { dirname, join } from "node:path";

import { localImageReference } from "../../shared/local-images";
import { READER_IMAGE_SNAPSHOT_MAX_SLOTS } from "../../shared/reader-image-snapshot";
import { isCanonicalBase64, READER_SNAPSHOT_MAX_BYTES } from "../../shared/reader-snapshot";

import { resolveSaveWorkerEntry } from "./atomic-save";

interface CandidateWorker {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(request: { protocolVersion: 1; data: string }): void;
  terminate(): void;
}

function responseReferences(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 2) return [];
  const response = value as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(response, "protocolVersion") ||
      !Object.prototype.hasOwnProperty.call(response, "references") ||
      response.protocolVersion !== 1 || !Array.isArray(response.references) ||
      response.references.length > READER_IMAGE_SNAPSHOT_MAX_SLOTS)
    return [];
  const references: string[] = [];
  for (const reference of response.references as unknown[]) {
    if (typeof reference !== "string") return [];
    const path = localImageReference(reference);
    if (path === null || !/\.(?:png|jpe?g)$/i.test(path)) return [];
    references.push(reference);
  }
  return references;
}

/** One pure parser worker per eligible child. No file authorization enters it. */
export function findReaderImageCandidates(
  base64: string,
  signal?: AbortSignal,
  options: { createWorker?: (entry: string) => CandidateWorker; timeoutMs?: number } = {}
): Promise<readonly string[]> {
  if (signal?.aborted || !base64 || !isCanonicalBase64(base64, READER_SNAPSHOT_MAX_BYTES))
    return Promise.resolve([]);
  return new Promise(resolve => {
    let worker: CandidateWorker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (references: readonly string[] = []) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      clearTimeout(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        worker.onmessageerror = null;
        try { worker.terminate(); } catch { references = []; }
      }
      resolve(references);
    };
    const abort = () => finish();
    try {
      const saveEntry = resolveSaveWorkerEntry(import.meta.dir);
      if (!saveEntry) { finish(); return; }
      worker = (options.createWorker ?? (entry => new Worker(entry)))(
        join(dirname(saveEntry), "reader-image-candidate-worker.js")
      );
      worker.onmessage = event => finish(signal?.aborted ? [] : responseReferences(event.data));
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
