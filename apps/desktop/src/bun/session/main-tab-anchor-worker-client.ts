import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { MAX_DOCUMENT_BYTES } from "../../shared/documents";
import {
  validMainTabCheckpointViewport,
  type MainTabCheckpointViewport,
} from "../../shared/main-tab-checkpoint";

import {
  copyStoredMainTabPosition,
  type StoredMainTabPosition,
} from "./main-tab-position-codec";

let anchorInFlight = false;

export function resolveMainTabAnchorWorkerEntry(moduleDirectory: string) {
  const inSource =
    basename(moduleDirectory) === "session" &&
    basename(join(moduleDirectory, "..")) === "bun" &&
    basename(join(moduleDirectory, "../..")) === "src";
  return inSource
    ? join(moduleDirectory, "main-tab-anchor-worker.ts")
    : join(moduleDirectory, "../native/main-tab-anchor-worker.js");
}

type AnchorWorkerRequest = { raw: string } & (
  | { viewport: MainTabCheckpointViewport }
  | { position: StoredMainTabPosition }
);

/** Bound the work shared by saving and restoring positions in all window lifetimes. */
function runAnchorWorker<T>(
  request: AnchorWorkerRequest,
  parseResponse: (value: unknown) => T | undefined,
  signal?: AbortSignal
): Promise<T | undefined> {
  const { raw } = request;
  if (
    anchorInFlight ||
    signal?.aborted ||
    raw.length > MAX_DOCUMENT_BYTES ||
    Buffer.byteLength(raw, "utf8") > MAX_DOCUMENT_BYTES
  )
    return Promise.resolve(undefined);
  const entry = resolveMainTabAnchorWorkerEntry(import.meta.dir);
  if (!existsSync(entry)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(entry);
    } catch {
      resolve(undefined);
      return;
    }
    anchorInFlight = true;
    let settled = false;
    const finish = (value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abandon);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      try { worker.terminate(); } catch { value = undefined; }
      anchorInFlight = false;
      resolve(value);
    };
    const abandon = () => finish();
    const timer = setTimeout(abandon, 5_000);
    worker.onmessage = (event: MessageEvent<unknown>) =>
      finish(signal?.aborted ? undefined : parseResponse(event.data));
    worker.onerror = (event) => { event.preventDefault(); abandon(); };
    worker.onmessageerror = abandon;
    signal?.addEventListener("abort", abandon, { once: true });
    if (signal?.aborted) { abandon(); return; }
    try { worker.postMessage(request); } catch { abandon(); }
  });
}

export function captureMainTabBlockAnchor(
  raw: string,
  viewport: MainTabCheckpointViewport,
  signal?: AbortSignal
) {
  return runAnchorWorker({ raw, viewport }, copyStoredMainTabPosition, signal);
}

export function resolveMainTabBlockAnchor(
  raw: string,
  position: StoredMainTabPosition,
  signal?: AbortSignal
) {
  return runAnchorWorker(
    { raw, position },
    (value) => validMainTabCheckpointViewport(value) ? value : undefined,
    signal
  );
}
