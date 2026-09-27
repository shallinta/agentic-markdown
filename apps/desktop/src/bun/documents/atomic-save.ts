import { existsSync } from "node:fs";
import { join, basename } from "node:path";

import type { DocumentErrorCode } from "../../shared/documents";

import type { SingleFileAuthorization } from "./path-authorization";

export interface AtomicSaveInput {
  authorization: Omit<SingleFileAuthorization, "file">;
  expectedHash: string;
  text: string;
}
export type AtomicSaveResult =
  | { ok: true; fingerprint: string; hash: string; byteLength: number }
  | { ok: false; error: DocumentErrorCode };

/** Electrobun 2 packages main in app/bun and copied native assets in app/native. */
export function resolveSaveWorkerEntry(
  moduleDirectory: string,
  exists: (path: string) => boolean = existsSync
): string | null {
  const sourceModule =
    basename(moduleDirectory) === "documents" &&
    basename(join(moduleDirectory, "..")) === "bun" &&
    basename(join(moduleDirectory, "../..")) === "src";
  const entry = sourceModule
    ? join(moduleDirectory, "../../../dist-native/save-worker.js")
    : join(moduleDirectory, "../native/save-worker.js");
  return exists(entry) ? entry : null;
}

/** No timeout terminates an in-flight writer: its durable/uncertain outcome is awaited. */
export function atomicSave(input: AtomicSaveInput): Promise<AtomicSaveResult> {
  if (process.platform !== "darwin")
    return Promise.resolve({ ok: false, error: "UNSUPPORTED_SAVE" });
  const entry = resolveSaveWorkerEntry(import.meta.dir);
  if (!entry) return Promise.resolve({ ok: false, error: "SAVE_FAILED" });
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(entry);
    } catch {
      resolve({ ok: false, error: "SAVE_FAILED" });
      return;
    }
    let settled = false;
    const finish = (result: AtomicSaveResult) => {
      if (settled) return;
      settled = true;
      // The worker replies only after its descriptors and temporary file are cleaned.
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (event: MessageEvent<AtomicSaveResult>) =>
      finish(event.data);
    worker.onerror = () => finish({ ok: false, error: "SAVE_UNCERTAIN" });
    worker.postMessage(input);
  });
}
