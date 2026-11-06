import { MAX_IMAGE_CACHE_BYTES } from "../shared/local-images";
import {
  parseReaderImageSnapshot,
  READER_IMAGE_SNAPSHOT_MAX_SLOTS,
  readerImageSnapshotCost,
  type ReaderImageSnapshot,
} from "../shared/reader-image-snapshot";

interface Slot {
  target?: object;
  receipt?: ReaderImageSnapshot;
}

/** Create only after receiving the body and its expected image delivery ID. */
export function createReaderImageSlot(expectedDeliveryId: string) {
  const slots: Slot[] = Array.from({ length: READER_IMAGE_SNAPSHOT_MAX_SLOTS }, () => ({}));
  let accepting = true;
  let targetsBound = false;
  let nextSlot = 0;
  let slotLimit = READER_IMAGE_SNAPSHOT_MAX_SLOTS;
  let used = 0;
  const settled = () => !accepting || nextSlot >= slotLimit;

  function close() {
    accepting = false;
    slots.length = 0;
    used = 0;
  }

  return {
    receive(value: unknown): boolean {
      if (settled()) return false;
      const next = parseReaderImageSnapshot(value, expectedDeliveryId);
      if (!next || settled() || next.slot !== nextSlot) return false;
      const slot = slots[nextSlot++];
      const bytes = next.status === "image" ? readerImageSnapshotCost(next.data, next.width, next.height) : 0;
      if (used + bytes > MAX_IMAGE_CACHE_BYTES) {
        const { protocolVersion, deliveryId, slot: index } = next;
        slot.receipt = { protocolVersion, deliveryId, slot: index, status: "unavailable" };
      } else {
        slot.receipt = next;
        used += bytes;
      }
      return true;
    },
    setTargets(nodes: readonly object[]): boolean {
      if (!accepting || targetsBound || !nodes.length || nodes.length > READER_IMAGE_SNAPSHOT_MAX_SLOTS ||
          new Set(nodes).size !== nodes.length) return false;
      targetsBound = true;
      slotLimit = nodes.length;
      slots.length = slotLimit;
      for (const [index, node] of nodes.entries()) slots[index].target = node;
      return true;
    },
    get(node: object): ReaderImageSnapshot | undefined {
      return slots.find(({ target }) => node === target)?.receipt;
    },
    expire() {
      if (targetsBound) accepting = false;
      else close();
    },
    settled,
    close,
  };
}
