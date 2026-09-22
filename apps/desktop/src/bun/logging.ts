import { appendFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";

import { getAppHomePath } from "@agentic-markdown/shared/server";

import { type LogEvent, serializeLogEvent } from "../shared/logging";

// Implementation quotas, not performance targets. One active + one previous file.
export const LOG_FILE_BYTES = 256 * 1024;
export const LOG_QUEUE_LIMIT = 128;

export function createLocalLogger(
  directory: string,
  { maxFileBytes = LOG_FILE_BYTES, maxQueued = LOG_QUEUE_LIMIT } = {}
) {
  if (
    !Number.isSafeInteger(maxFileBytes) ||
    maxFileBytes < 1 ||
    !Number.isSafeInteger(maxQueued) ||
    maxQueued < 1
  ) {
    throw new Error("Invalid local log quota.");
  }
  const active = join(directory, "app.log");
  const previous = join(directory, "app.previous.log");
  const queue: string[] = [];
  let pending: Promise<void> | null = null;
  let initialized = false;
  let disabled = false;
  let bytes = 0;

  async function fileSize(path: string): Promise<number> {
    try {
      return (await stat(path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  async function drain(): Promise<void> {
    try {
      if (!initialized) {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        // Also enforce the quota when opening files from a prior process.
        if ((await fileSize(previous)) > maxFileBytes) await unlink(previous);
        bytes = await fileSize(active);
        if (bytes > maxFileBytes) {
          await unlink(active);
          bytes = 0;
        }
        initialized = true;
      }
      while (queue.length) {
        const line = queue.shift()!;
        const size = Buffer.byteLength(line);
        if (bytes + size > maxFileBytes) {
          await rename(active, previous);
          bytes = 0;
        }
        await appendFile(active, line, { mode: 0o600 });
        bytes += size;
      }
    } catch {
      // Logging must never reject into document reading or recursively log IO errors.
      // Disable for this process after failure, bounding repeated disk work too.
      disabled = true;
      queue.length = 0;
    }
  }

  function schedule(): void {
    pending ??= drain().finally(() => {
      pending = null;
      if (queue.length) schedule();
    });
  }

  return {
    log(event: unknown, metadata?: unknown): void {
      if (disabled || queue.length >= maxQueued) return;
      const line = serializeLogEvent(event, metadata);
      if (!line || Buffer.byteLength(line) > maxFileBytes) return;
      queue.push(line);
      schedule();
    },
    async flush(): Promise<void> {
      while (pending) await pending;
    },
  };
}

let appLogger: ReturnType<typeof createLocalLogger> | undefined;

export function logEvent(event: LogEvent): void {
  appLogger ??= createLocalLogger(join(getAppHomePath(), "logs"));
  appLogger.log(event);
}
