import { MAX_IMAGE_CACHE_BYTES } from "../shared/local-images";
import { READER_IMAGE_SNAPSHOT_EVENT } from "../shared/reader-image-snapshot";

import { createReaderImageSlot } from "./reader-image-slot";

/** The expected ID comes from the validated one-shot body delivery. */
export function createReaderImageReceiver(events: EventTarget, deliveryId: string, timeoutMs = 5000) {
  const slot = createReaderImageSlot(deliveryId);
  const listeners = new Set<() => void>();
  function receive(event: Event) {
    if (!(event instanceof CustomEvent) || !slot.receive(event.detail)) return;
    events.removeEventListener(READER_IMAGE_SNAPSHOT_EVENT, receive);
    for (const listener of listeners) listener();
  }
  const timer = setTimeout(() => {
    events.removeEventListener(READER_IMAGE_SNAPSHOT_EVENT, receive);
    slot.expire();
  }, timeoutMs);
  function close() {
    clearTimeout(timer);
    events.removeEventListener(READER_IMAGE_SNAPSHOT_EVENT, receive);
    events.removeEventListener("pagehide", close);
    slot.close();
    listeners.clear();
  }
  events.addEventListener(READER_IMAGE_SNAPSHOT_EVENT, receive);
  events.addEventListener("pagehide", close, { once: true });
  return {
    setTarget(node: object) {
      return slot.setTarget(node);
    },
    getImage(node: object) {
      const receipt = slot.get(node);
      if (receipt?.status !== "image") return undefined;
      // Same retained + presentation accounting as the existing local image pool.
      const bytes = receipt.data.length * 2 + receipt.width * receipt.height * 8;
      return bytes <= MAX_IMAGE_CACHE_BYTES ? receipt : undefined;
    },
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close,
  };
}

export type ReaderImageReceiver = ReturnType<typeof createReaderImageReceiver>;
