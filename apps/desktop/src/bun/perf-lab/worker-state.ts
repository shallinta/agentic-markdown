import { syntheticDigest } from "../../shared/perf-lab";

export type WorkerOperation =
  | { op: "text"; text: string; final: boolean }
  | {
      op: "patch";
      baseline: string;
      version: number;
      from: number;
      to: number;
      insert: string;
    }
  | { op: "binary"; buffer: ArrayBuffer };

export function createPerfWorkerState(limit: number) {
  let parts: string[] = [],
    base = "",
    totalBytes = 0,
    version = 0,
    digest = "";
  return {
    run(message: WorkerOperation) {
      const start = performance.now();
      if (message.op === "text") {
        const bytes = Buffer.byteLength(message.text, "utf8");
        if (
          version ||
          !bytes ||
          parts.length >= 1024 ||
          totalBytes + bytes > limit
        )
          throw Error("INVALID");
        totalBytes += bytes;
        parts.push(message.text);
        if (message.final) {
          if (totalBytes !== limit) throw Error("INVALID");
          base = parts.join("");
          parts = [];
          digest = syntheticDigest(base);
          version = 1;
        }
      } else if (message.op === "patch") {
        if (
          !version ||
          digest !== message.baseline ||
          version !== message.version ||
          !Number.isSafeInteger(message.from) ||
          !Number.isSafeInteger(message.to) ||
          message.from < 0 ||
          message.to < message.from ||
          message.to > base.length ||
          message.insert.length > 1024
        )
          throw Error("INVALID");
        const updated =
          base.slice(0, message.from) + message.insert + base.slice(message.to);
        if (Buffer.byteLength(updated, "utf8") > limit + 4096)
          throw Error("INVALID");
        base = updated;
        digest = syntheticDigest(base);
        version++;
        totalBytes = Buffer.byteLength(base, "utf8");
      } else {
        if (
          !(message.buffer instanceof ArrayBuffer) ||
          message.buffer.byteLength !== limit ||
          version
        )
          throw Error("INVALID");
        base = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(message.buffer);
        totalBytes = message.buffer.byteLength;
        digest = syntheticDigest(base);
        version = 1;
      }
      return {
        bytes: totalBytes,
        digest,
        version,
        workerMs: performance.now() - start,
        ownedTextUnits:
          base.length + parts.reduce((sum, item) => sum + item.length, 0),
      };
    },
  };
}
