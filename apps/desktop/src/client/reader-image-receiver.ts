import { READER_IMAGE_SNAPSHOT_EVENT } from "../shared/reader-image-snapshot";

import { createReaderImageSlot } from "./reader-image-slot";

/** The expected ID comes from the validated one-shot body delivery. */
export function createReaderImageReceiver(events: EventTarget, deliveryId: string, timeoutMs = 5000) {
  const slot = createReaderImageSlot(deliveryId);
  const listeners = new Set<() => void>();
  function stopListening() {
    events.removeEventListener(READER_IMAGE_SNAPSHOT_EVENT, receive);
  }
  function receive(event: Event) {
    if (!(event instanceof CustomEvent) || !slot.receive(event.detail)) return;
    if (slot.settled()) stopListening();
    for (const listener of listeners) listener();
  }
  const timer = setTimeout(() => {
    stopListening();
    slot.expire();
  }, timeoutMs);
  function close() {
    clearTimeout(timer);
    stopListening();
    events.removeEventListener("pagehide", close);
    slot.close();
    listeners.clear();
  }
  events.addEventListener(READER_IMAGE_SNAPSHOT_EVENT, receive);
  events.addEventListener("pagehide", close, { once: true });
  return {
    setTargets(nodes: readonly object[]) {
      const bound = slot.setTargets(nodes);
      if (slot.settled()) stopListening();
      return bound;
    },
    getImage(node: object) {
      const receipt = slot.get(node);
      return receipt?.status === "image" ? receipt : undefined;
    },
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close,
  };
}

export type ReaderImageReceiver = ReturnType<typeof createReaderImageReceiver>;
