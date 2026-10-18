import { createRequire } from "node:module";
import { join } from "node:path";

import {
  encodeChanges,
  INDEX_LIMITS,
  keys,
  natural,
  record,
  scalar,
  validRequest,
} from "./protocol";
import type { IndexHit, IndexResult } from "./protocol";

interface NativeIndex {
  version(): number;
  open(path: Buffer, mode: number, generation: Buffer): object | number;
  call(
    handle: object,
    op: number,
    input: Buffer,
    output: Buffer,
    metadata: Buffer
  ): number;
  close(handle: object): number;
}
function isNative(value: unknown): value is NativeIndex {
  return (
    record(value) &&
    Object.getOwnPropertyNames(value).sort().join(",") ===
      "call,close,open,version" &&
    ["call", "close", "open", "version"].every(
      (key) => typeof value[key] === "function"
    )
  );
}
const loaded: unknown = createRequire(import.meta.url)(
  join(import.meta.dir, "index-primitives.node")
);
if (!isNative(loaded) || loaded.version() !== 1)
  throw Error("INDEX_UNAVAILABLE");
const native = loaded;
let handle: object | undefined;
let generation = 0;
let serial = 0;
let epoch: number | undefined;
let faulted = false;
const rejected = (
  error: "INPUT" | "LIMIT" | "SCHEMA" | "READONLY"
): IndexResult => ({ ok: false, error, accepted: false });
const unknown = (): IndexResult => ({
  ok: false,
  error: "UNKNOWN",
  accepted: true,
});
function invoke(
  op: number,
  input: Buffer
): { code: number; text: string; mutation: number; poisoned: boolean } {
  const output = Buffer.alloc(INDEX_LIMITS.output),
    metadata = Buffer.alloc(32);
  const code = native.call(handle!, op, input, output, metadata);
  const facts = Array.from({ length: 4 }, (_, i) =>
    Number(metadata.readBigUInt64LE(i * 8))
  );
  if (
    !natural(code) ||
    code > 8 ||
    !facts.every(natural) ||
    facts[1] > output.length ||
    facts[3] > 1
  )
    throw Error("INDEX_RESPONSE");
  generation = facts[0]!;
  return {
    code,
    text:
      code === 0
        ? new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            output.subarray(0, facts[1])
          )
        : "",
    mutation: facts[2],
    poisoned: facts[3] === 1,
  };
}
function failure(code: number, poisoned: boolean): IndexResult {
  if (poisoned || ![1, 2, 4, 7].includes(code)) {
    faulted = true;
    return unknown();
  }
  return rejected(
    code === 2
      ? "LIMIT"
      : code === 4
        ? "SCHEMA"
        : code === 7
          ? "READONLY"
          : "INPUT"
  );
}
function operate(op: string, payload: unknown): IndexResult {
  if (op === "close") {
    const old = handle;
    handle = undefined;
    const code = old ? native.close(old) : 0;
    return code === 0 ? { ok: true, generation } : unknown();
  }
  if (faulted) return unknown();
  if (op === "open") {
    if (
      handle ||
      !record(payload) ||
      !keys(payload, "mode,path") ||
      !scalar(payload.path, 4096) ||
      !payload.path.startsWith("/") ||
      payload.path.includes("\0") ||
      Buffer.byteLength(payload.path) > 4096 ||
      typeof payload.mode !== "string" ||
      !["create-new", "reader-only"].includes(payload.mode)
    )
      return rejected("INPUT");
    const metadata = Buffer.alloc(8);
    const result = native.open(
      Buffer.from(payload.path),
      payload.mode === "create-new" ? 0 : 1,
      metadata
    );
    if (typeof result === "number") return failure(result, false);
    handle = result;
    generation = Number(metadata.readBigUInt64LE());
    if (!natural(generation)) throw Error("INDEX_GENERATION");
    return { ok: true, generation };
  }
  if (!handle) return rejected("INPUT");
  if (op === "apply") {
    let bytes: Buffer;
    try {
      bytes = encodeChanges(payload);
    } catch {
      return rejected("INPUT");
    }
    const result = invoke(1, bytes);
    return result.code === 0
      ? { ok: true, generation }
      : failure(result.code, result.poisoned);
  }
  if (op === "query") {
    if (!scalar(payload, INDEX_LIMITS.query)) return rejected("INPUT");
    const result = invoke(3, Buffer.from(payload));
    if (result.code !== 0) return failure(result.code, result.poisoned);
    const hits: IndexHit[] = [];
    for (const row of result.text ? result.text.trimEnd().split("\n") : []) {
      const [tag, id, from, to, ...extra] = row.split("\t");
      if (
        tag !== "H" ||
        !id ||
        extra.length ||
        from === undefined ||
        to === undefined
      )
        throw Error("INDEX_HIT");
      hits.push({ id, from: Number(from), to: Number(to) });
    }
    return { ok: true, generation, hits };
  }
  return rejected("INPUT");
}
self.onmessage = (event: MessageEvent<unknown>) => {
  if (!validRequest(event.data)) throw Error("INDEX_REQUEST");
  const request = event.data;
  if ((epoch !== undefined && epoch !== request.epoch) || request.id <= serial)
    throw Error("INDEX_SEQUENCE");
  epoch = request.epoch;
  serial = request.id;
  let result: IndexResult;
  try {
    result = operate(request.op, request.payload);
  } catch {
    faulted = true;
    result = unknown();
  }
  self.postMessage({ version: 1, epoch, id: request.id, result });
  if (request.op === "close") self.onmessage = null;
};
