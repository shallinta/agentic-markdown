import { parseReaderImageSnapshot, type ReaderImageSnapshot } from "../shared/reader-image-snapshot";

/** Create only after receiving the body and its expected image delivery ID. */
export function createReaderImageSlot(expectedDeliveryId: string) {
  let closed = false;
  let target: object | undefined;
  let receipt: ReaderImageSnapshot | undefined;

  function close() {
    closed = true;
    target = undefined;
    receipt = undefined;
  }

  return {
    receive(value: unknown): boolean {
      if (closed || receipt) return false;
      const next = parseReaderImageSnapshot(value, expectedDeliveryId);
      if (!next || closed || receipt) return false;
      receipt = next;
      return true;
    },
    setTarget(node: object): boolean {
      if (closed || target) return false;
      target = node;
      return true;
    },
    get(node: object): ReaderImageSnapshot | undefined {
      return node === target ? receipt : undefined;
    },
    expire() {
      if (!target || !receipt) close();
    },
    close,
  };
}
