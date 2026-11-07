import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "./local-images";
import {
  isCanonicalBase64,
  isReaderSnapshotDeliveryId,
  readerSnapshotOwnValue,
} from "./reader-snapshot";

export const READER_IMAGE_SNAPSHOT_EVENT = "agentic-markdown:reader-image-snapshot";
export const READER_IMAGE_SNAPSHOT_MAX_BYTES = MAX_IMAGE_BYTES;
export const READER_IMAGE_SNAPSHOT_MAX_SLOTS = 2;
export type ReaderImageSnapshotSlot = 0 | 1;

interface ReaderImageEnvelope {
  protocolVersion: 1;
  deliveryId: string;
  slot: ReaderImageSnapshotSlot;
}
export type ReaderImageSnapshot = ReaderImageEnvelope & (
  | { status: "unavailable" }
  | { status: "image"; mime: "image/png" | "image/jpeg"; width: number; height: number; data: string }
);

/** Retained Base64, decoded pixels and presentation reservation. */
export function readerImageSnapshotCost(data: string, width: number, height: number): number {
  return data.length * 2 + width * height * 8;
}

/** Returns only the validated fields, without retaining the original event object. */
export function parseReaderImageSnapshot(value: unknown, expectedDeliveryId: string): ReaderImageSnapshot | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    if (Array.isArray(value)) return undefined;
    const keyCount = Reflect.ownKeys(value).length;
    if (keyCount !== 4 && keyCount !== 8) return undefined;
    const deliveryId = readerSnapshotOwnValue(value, "deliveryId");
    const slot = readerSnapshotOwnValue(value, "slot");
    if (readerSnapshotOwnValue(value, "protocolVersion") !== 1 || (slot !== 0 && slot !== 1) ||
        !isReaderSnapshotDeliveryId(deliveryId) || deliveryId !== expectedDeliveryId) return undefined;

    const envelope = { protocolVersion: 1, deliveryId, slot } as const;
    const status = readerSnapshotOwnValue(value, "status");
    if (status === "unavailable" && keyCount === 4) return { ...envelope, status };
    if (status !== "image" || keyCount !== 8) return undefined;

    const mime = readerSnapshotOwnValue(value, "mime");
    const width = readerSnapshotOwnValue(value, "width");
    const height = readerSnapshotOwnValue(value, "height");
    const data = readerSnapshotOwnValue(value, "data");
    if ((mime !== "image/png" && mime !== "image/jpeg") ||
        typeof width !== "number" || !Number.isSafeInteger(width) || width <= 0 ||
        typeof height !== "number" || !Number.isSafeInteger(height) || height <= 0 ||
        width * height > MAX_IMAGE_PIXELS || !isCanonicalBase64(data, READER_IMAGE_SNAPSHOT_MAX_BYTES) || !data) {
      return undefined;
    }
    return { ...envelope, status, mime, width, height, data };
  } catch {
    return undefined;
  }
}

/** One-way event, with no callback or reference to host capabilities. */
export function readerImageSnapshotDeliveryScript(value: unknown, expectedDeliveryId: string): string | undefined {
  const receipt = parseReaderImageSnapshot(value, expectedDeliveryId);
  if (!receipt) return undefined;
  return `window.dispatchEvent(new CustomEvent(${JSON.stringify(READER_IMAGE_SNAPSHOT_EVENT)}, {detail: ${JSON.stringify(receipt)}}));`;
}
