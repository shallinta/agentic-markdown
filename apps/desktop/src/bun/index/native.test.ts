import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { encodeChanges, record } from "./protocol";
import { resolveIndexResources } from "./resources";
import { createIndexSession } from "./session";

interface Native {
  open(path: Buffer, mode: number, generation: Buffer): object | number;
  call(
    handle: object,
    op: number,
    input: Buffer,
    output: Buffer,
    meta: Buffer
  ): number;
  close(handle: object): number;
}
interface TestNative extends Native {
  audit(path: Buffer): number;
  cleanupForTest(): number;
}
function isNative(value: unknown): value is Native {
  return (
    record(value) &&
    ["open", "call", "close"].every((k) => typeof value[k] === "function")
  );
}
function isTestNative(value: unknown): value is TestNative {
  return (
    isNative(value) &&
    "audit" in value &&
    typeof value.audit === "function" &&
    "cleanupForTest" in value &&
    typeof value.cleanupForTest === "function"
  );
}
function load(path: string) {
  const value: unknown = createRequire(import.meta.url)(path);
  if (!isNative(value)) throw Error("native shape");
  return value;
}
async function open(native: Native) {
  const root = await mkdtemp(join(tmpdir(), "f064c-native-")),
    path = join(root, "index"),
    metadata = Buffer.alloc(8);
  const handle = native.open(Buffer.from(path), 0, metadata);
  if (typeof handle === "number") throw Error("open failed");
  expect(metadata.readBigUInt64LE()).toBe(0n);
  return { root, path, handle };
}
test("formal ABI refuses test ops and overlapping buffers without mutation", async () => {
  const resources = resolveIndexResources(import.meta.dir);
  if (!resources) throw Error("build native first");
  const native = load(resources.native),
    { handle } = await open(native),
    meta = Buffer.alloc(32),
    out = Buffer.alloc(150000);
  for (const op of [4, 90, 91]) {
    expect(native.call(handle, op, Buffer.alloc(0), out, meta)).toBe(1);
    expect(meta.readBigUInt64LE(16)).toBe(0n);
  }
  expect(() =>
    native.call(handle, Number.NaN, Buffer.alloc(0), out, meta)
  ).toThrow();
  expect(() => native.call(handle, 1, out.subarray(0, 4), out, meta)).toThrow();
  expect(native.close(handle)).toBe(0);
  expect(native.close(handle)).toBe(5);
});

test("empty created cache reopens at generation zero", async () => {
  const root = await mkdtemp(join(tmpdir(), "f064c-empty-")),
    path = join(root, "index");
  const writer = createIndexSession();
  expect(await writer.open(path, "create-new")).toEqual({
    ok: true,
    generation: 0,
  });
  expect(await writer.close()).toEqual({ ok: true, generation: 0 });
  const reader = createIndexSession();
  expect(await reader.open(path, "reader-only")).toEqual({
    ok: true,
    generation: 0,
  });
  expect(await reader.query("x")).toEqual({
    ok: true,
    generation: 0,
    hits: [],
  });
  expect(await reader.close()).toEqual({ ok: true, generation: 0 });
}, 15000);

test("separate test addon panic poisons and preserves committed generation", async () => {
  const native = load(
    join(import.meta.dir, "../../../.index-test/index-primitives.node")
  );
  const { handle, path } = await open(native),
    out = Buffer.alloc(150000),
    meta = Buffer.alloc(32);
  const bytes = encodeChanges([
    { kind: "put", id: "a", path: "a", raw: "committed" },
  ]);
  expect(native.call(handle, 91, bytes, out, meta)).toBe(8);
  expect(meta.readBigUInt64LE()).toBe(1n);
  expect(meta.readBigUInt64LE(24)).toBe(1n);
  expect(native.call(handle, 3, Buffer.from("committed"), out, meta)).toBe(6);
  expect(native.close(handle)).toBe(0);
  const reader = createIndexSession();
  expect(await reader.open(path, "reader-only")).toEqual({
    ok: true,
    generation: 1,
  });
  expect(await reader.query("committed")).toEqual({
    ok: true,
    generation: 1,
    hits: [{ id: "a", from: 0, to: 9 }],
  });
  expect(await reader.close()).toEqual({ ok: true, generation: 1 });
}, 15000);

test("test-only cleanup closes resource but retained wrapper remains safe", async () => {
  const value: unknown = createRequire(import.meta.url)(
    join(import.meta.dir, "../../../.index-test/index-primitives.node")
  );
  if (!isTestNative(value)) throw Error("build test addon first");
  // Prior test opened a handle; audit is intentionally not used on this already-used env.
  const { handle } = await open(value);
  expect(value.cleanupForTest()).toBe(0);
  expect(value.close(handle)).toBe(5);
  expect(() =>
    value.call(
      handle,
      3,
      Buffer.from("x"),
      Buffer.alloc(150000),
      Buffer.alloc(32)
    )
  ).toThrow();
});
