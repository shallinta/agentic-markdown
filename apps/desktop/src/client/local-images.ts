import {
  localImageReference,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_CACHE_BYTES,
  validLocalImageResponse,
  type LocalImageRequest,
  type LocalImageResult,
} from "../shared/local-images";

export type ImageTransport = (request: LocalImageRequest) => Promise<unknown>;
const unavailable: LocalImageResult = { ok: false, error: "UNAVAILABLE" };
const reservation = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 * 2;

/** One reading generation owns all data; disposal rejects even late receipts. */
export function createLocalImages(handle: string, transport: ImageTransport) {
  let disposed = false;
  let used = 0;
  let inFlightBytes = 0;
  let running = false;
  let leases = 0;
  const entries = new Map<string, Promise<LocalImageResult>>();
  const queue: (() => Promise<void>)[] = [];
  const settle = new Set<(result: LocalImageResult) => void>();
  function pump() {
    if (running || disposed) return;
    const next = queue.shift();
    if (!next) return;
    running = true;
    void next().finally(() => {
      running = false;
      pump();
    });
  }
  const pool = {
    reservePresentation(result: LocalImageResult): (() => void) | null {
      if (disposed || !result.ok) return null;
      const bytes = result.width * result.height * 4;
      if (used + bytes > MAX_IMAGE_CACHE_BYTES) return null;
      used += bytes;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (!disposed) used = Math.max(0, used - bytes);
      };
    },
    retain() {
      leases++;
      return () => {
        leases--;
        // StrictMode replays effects without leaving the reading generation.
        queueMicrotask(() => {
          if (leases === 0) pool.dispose();
        });
      };
    },
    load(reference: string): Promise<LocalImageResult> {
      const key = localImageReference(reference);
      if (disposed || key === null) return Promise.resolve(unavailable);
      const existing = entries.get(key);
      if (existing) return existing;
      if (entries.size >= 256 || queue.length >= 64)
        return Promise.resolve(unavailable);
      const promise = new Promise<LocalImageResult>((resolve) => {
        settle.add(resolve);
        queue.push(async () => {
          let result = unavailable;
          // The one transport reservation is separate from retained resources.
          // Accounted peak is retained 24 MiB + at most 21.34 MiB in transit,
          // not a process RSS claim. Small later images must remain admissible.
          if (used < MAX_IMAGE_CACHE_BYTES && inFlightBytes === 0) {
            inFlightBytes = reservation;
            const requestId = crypto.randomUUID();
            try {
              const value = await transport({
                protocolVersion: 1,
                requestId,
                handle,
                reference,
              });
              if (
                !disposed &&
                value &&
                typeof value === "object" &&
                "protocolVersion" in value &&
                value.protocolVersion === 1 &&
                "requestId" in value &&
                value.requestId === requestId &&
                validLocalImageResponse(value)
              ) {
                const cost = value.ok
                  ? value.data.length * 2 + value.width * value.height * 4
                  : 0;
                if (used + cost <= MAX_IMAGE_CACHE_BYTES) {
                  result = value;
                  used += cost;
                }
              }
            } catch {
              /* No paths or asset bytes in logs. */
            } finally {
              inFlightBytes = 0;
            }
          }
          settle.delete(resolve);
          resolve(disposed ? unavailable : result);
        });
      });
      entries.set(key, promise);
      pump();
      return promise;
    },
    dispose() {
      disposed = true;
      queue.length = 0;
      entries.clear();
      used = 0;
      inFlightBytes = 0;
      for (const resolve of settle) resolve(unavailable);
      settle.clear();
    },
  };
  return pool;
}
export type LocalImages = ReturnType<typeof createLocalImages>;

export function imagePlaceholder(reference: string): string | null {
  try {
    const url = new URL(
      reference.startsWith("//") ? `https:${reference}` : reference
    );
    if (url.protocol === "https:" || url.protocol === "http:")
      return `远程图片未加载（${url.hostname}）`;
    return "图片地址不受支持";
  } catch {
    return localImageReference(reference) === null ? "图片地址不受支持" : null;
  }
}
