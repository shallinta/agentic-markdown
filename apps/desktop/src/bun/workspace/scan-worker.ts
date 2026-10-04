import { join } from "node:path";

import { createScan, SCAN_QUEUE_BYTES } from "./scan";
import { validScanRequest } from "./scan-protocol";

const scans = new Map<string, ReturnType<typeof createScan>>();
self.onmessage = async (event: MessageEvent<unknown>) => {
  if (!validScanRequest(event.data)) {
    const input = event.data;
    const id =
      input &&
      typeof input === "object" &&
      "id" in input &&
      Number.isSafeInteger(input.id)
        ? input.id
        : 0;
    self.postMessage({ id, ok: false });
    return;
  }
  const { id, op, key, root, path } = event.data;
  try {
    if (op === "start") {
      scans.get(key)?.close();
      if (scans.size >= 32 && !scans.has(key)) throw Error();
      scans.set(
        key,
        createScan(root!, join(import.meta.dir, "save-primitives.node"))
      );
    } else if (op === "close") {
      scans.get(key)?.close();
      scans.delete(key);
    } else if (op === "prioritize") scans.get(key)?.prioritize(path!);
    else if (op !== "next") throw Error();
    const otherBytes = [...scans].reduce(
      (sum, [other, scan]) => sum + (other === key ? 0 : scan.queueBytes()),
      0
    );
    const result =
      op === "next"
        ? await scans.get(key)?.next(Math.max(0, SCAN_QUEUE_BYTES - otherBytes))
        : null;
    if (op === "next" && !result) throw Error();
    self.postMessage({ id, ok: true, result });
  } catch {
    self.postMessage({ id, ok: false });
  }
};
