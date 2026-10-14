import { randomUUID } from "node:crypto";
import { basename, join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import {
  isRecentData,
  RECENT_LIMIT,
  RECENT_MAX_BYTES,
  type RecentResponse,
  type RecentFailure,
} from "../shared/recent-files";

export function createRecentFiles(
  settingsDir: string,
  notify: (reason: RecentFailure) => void = () => undefined
) {
  const store = createSettingsStore(
    join(settingsDir, "recent-files.json"),
    (value) => (isRecentData(value) ? value : { entries: [] }),
    { maxBytes: RECENT_MAX_BYTES, validateData: isRecentData }
  );
  let tail: Promise<unknown> = Promise.resolve(),
    queued = 0,
    warning: RecentFailure | undefined;
  const report = (reason: RecentFailure) => {
    warning = reason;
    try {
      notify(reason);
    } catch {
      /* Reporting must not fail document opening. */
    }
  };
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    if (queued >= 64) {
      report("queue-full");
      return Promise.reject(Error("RECENT_QUEUE_FULL"));
    }
    queued++;
    const next = tail.then(operation);
    tail = next
      .catch(() => undefined)
      .finally(() => {
        queued--;
      });
    return next;
  };
  const failure = (error: unknown): RecentFailure =>
    error instanceof Error
      ? ((
          {
            SETTINGS_VERSION_UNSUPPORTED: "future",
            SETTINGS_CORRUPT: "corrupt",
            SETTINGS_TOO_LARGE: "too-large",
            RECENT_QUEUE_FULL: "queue-full",
          } as Record<string, RecentFailure>
        )[error.message] ?? "io")
      : "io";
  const list = async (): Promise<RecentResponse> => {
    const state = await store.inspectState();
    return state.available
      ? {
          available: true,
          entries: state.data.entries,
          ...(warning ? { warning } : {}),
        }
      : { available: false, reason: state.reason };
  };
  return {
    recordSelected(metadata: Readonly<{ path: string; accessedAt: number }>) {
      const captured = { ...metadata };
      return enqueue(async () => {
        await store.update((previous) => ({
          entries: [
            {
              id:
                previous.entries.find((e) => e.path === captured.path)?.id ??
                randomUUID(),
              kind: "file" as const,
              path: captured.path,
              name: basename(captured.path),
              accessedAt: captured.accessedAt,
            },
            ...previous.entries.filter((e) => e.path !== captured.path),
          ].slice(0, RECENT_LIMIT),
        }));
      }).catch((error) => {
        report(failure(error));
      });
    },
    async request(input: unknown): Promise<RecentResponse> {
      if (!input || typeof input !== "object")
        return { available: false, reason: "invalid" };
      const r = input as { op?: unknown; id?: unknown };
      if (
        (r.op !== "list" && r.op !== "remove" && r.op !== "clear") ||
        Object.keys(r).some(
          (k) => k !== "op" && (r.op !== "remove" || k !== "id")
        ) ||
        (r.op === "remove" &&
          (typeof r.id !== "string" ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
              r.id
            )))
      )
        return { available: false, reason: "invalid" };
      try {
        return await enqueue(async () => {
          if (r.op !== "list") {
            await store.update((previous) => ({
              entries:
                r.op === "clear"
                  ? []
                  : previous.entries.filter((e) => e.id !== r.id),
            }));
            warning = undefined;
          }
          return list();
        });
      } catch (error) {
        const reason = failure(error);
        report(reason);
        return { available: false, reason };
      }
    },
    async find(id: string) {
      const result = await enqueue(list);
      return result.available
        ? result.entries.find((e) => e.id === id)
        : undefined;
    },
    async drain() {
      await tail;
    },
  };
}
