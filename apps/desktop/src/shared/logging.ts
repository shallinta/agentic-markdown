const EVENTS = [
  "app.started",
  "app.stopped",
  "app.start_failed",
  "app.cleanup_failed",
  "app.shutdown_failed",
  "env.hydration_failed",
  "updater.start_failed",
  "updater.check_failed",
  "updater.settings_load_failed",
  "updater.settings_save_failed",
  "renderer.start_failed",
  "renderer.locale_failed",
  "window.development_server",
  "window.packaged_assets",
  "security.external_url_blocked",
] as const;

export type LogEvent = (typeof EVENTS)[number];
const allowedEvents = new Set<string>(EVENTS);

/** Construct from a whitelist; never inspect or serialize arbitrary metadata. */
export function serializeLogEvent(
  event: unknown,
  metadata?: unknown
): string | null {
  if (typeof event !== "string" || !allowedEvents.has(event)) return null;
  let count: number | undefined;
  try {
    if (metadata && typeof metadata === "object") {
      // Data descriptors exclude getters, which could throw or execute code.
      const value: unknown = Object.getOwnPropertyDescriptor(
        metadata,
        "count"
      )?.value;
      if (
        typeof value === "number" &&
        Number.isSafeInteger(value) &&
        value >= 0
      ) {
        count = Math.min(value, 1_000_000);
      }
    }
  } catch {
    // A hostile proxy is treated exactly like absent metadata.
  }
  return (
    JSON.stringify({ event, ...(count === undefined ? {} : { count }) }) + "\n"
  );
}

/** Renderer fallback remains anonymous even when the host bridge is unavailable. */
export function logRendererEvent(event: LogEvent): void {
  const line = serializeLogEvent(event);
  if (line) console.info(line.trimEnd());
}
