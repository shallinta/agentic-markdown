import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readdirSync,
} from "node:fs";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface NativeWatch {
  watchCreate(limit: number): object;
  watchAdd(instance: object, fd: number): number;
  watchRemove(instance: object, id: number): number;
  watchPoll(
    instance: object,
    limit: number
  ): {
    events: { id: number; flags: number }[];
    saturated: boolean;
  };
  watchClose(instance: object): number;
  watchCount(instance: object): number;
}
const native = createRequire(import.meta.url)(
  join(import.meta.dir, "../../../dist-native/save-primitives.node")
) as NativeWatch;
let directory: string;
const instances: object[] = [];
const create = (limit = 8) => {
  const value = native.watchCreate(limit);
  instances.push(value);
  return value;
};
const add = (instance: object) => {
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    return native.watchAdd(instance, fd);
  } finally {
    closeSync(fd);
  }
};
const observed = async (instance: object) => {
  for (let i = 0; i < 100; i++) {
    const result = native.watchPoll(instance, 128);
    if (result.events.length) return result;
    await Bun.sleep(2);
  }
  throw Error("directory change did not arrive");
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "native-directory-watch-"));
});
afterEach(async () => {
  for (const instance of instances.splice(0)) native.watchClose(instance);
  await rm(directory, { recursive: true, force: true });
  await rm(`${directory}-moved`, { recursive: true, force: true });
});

test("directory watches own duplicated descriptors, stay inode-bound, and return bounded hints", async () => {
  const instance = create();
  const id = add(instance);
  expect(native.watchCount(instance)).toBe(1);
  expect(native.watchPoll(instance, 8)).toEqual({
    events: [],
    saturated: false,
  });
  await writeFile(join(directory, "new.md"), "sample");
  const change = await observed(instance);
  expect(
    change.events.some((event) => event.id === id && event.flags !== 0)
  ).toBe(true);
  await rename(directory, `${directory}-moved`);
  const renamed = await observed(instance);
  expect(
    renamed.events.some(
      (event) => event.id === id && (event.flags & 0x20) !== 0
    )
  ).toBe(true);
  // A change in the renamed original directory is still reported under its
  // original registration, not automatically rebound to any replacement path.
  await writeFile(join(`${directory}-moved`, "second.md"), "sample");
  expect(
    (await observed(instance)).events.some((event) => event.id === id)
  ).toBe(true);
  native.watchClose(instance);
  expect(native.watchCount(instance)).toBe(0);
  expect(() => native.watchPoll(instance, 8)).toThrow();
  expect(native.watchClose(instance)).toBe(0);
});

test("branded instances, exact arguments and directory-only descriptors reject without leaks", async () => {
  expect(() => native.watchCreate(0)).toThrow();
  expect(() => native.watchCreate(513)).toThrow();
  expect(() => native.watchCreate(1.5)).toThrow();
  expect(() => native.watchClose({})).toThrow();
  expect(() => native.watchPoll({}, 8)).toThrow();
  const instance = create();
  await writeFile(join(directory, "file.md"), "not a directory");
  const fd = openSync(join(directory, "file.md"), constants.O_RDONLY);
  const count = readdirSync("/dev/fd").length;
  try {
    for (let i = 0; i < 100; i++)
      expect(() => native.watchAdd(instance, fd)).toThrow();
    expect(readdirSync("/dev/fd").length).toBe(count);
    expect(fstatSync(fd).isFile()).toBe(true);
    expect(native.watchCount(instance)).toBe(0);
    expect(() => native.watchPoll(instance, 0)).toThrow();
    expect(() => native.watchPoll(instance, 129)).toThrow();
    expect(() => native.watchRemove(instance, NaN)).toThrow();
    expect(() => native.watchRemove(instance, 1.5)).toThrow();
    expect(() =>
      native.watchRemove(instance, Number.MAX_SAFE_INTEGER + 1)
    ).toThrow();
  } finally {
    closeSync(fd);
  }
});

test("instance and environment budgets are enforced, stale ids cannot remove a reused descriptor", async () => {
  const first = create(1),
    second = create(512);
  const old = add(first);
  expect(() => add(first)).toThrow();
  native.watchRemove(first, old);
  const current = add(first);
  expect(current).toBeGreaterThan(old);
  expect(native.watchRemove(first, old)).toBe(0);
  const other = add(second);
  expect(other).toBeGreaterThan(current);
  native.watchRemove(first, other);
  native.watchRemove(second, current);
  expect(native.watchCount(first)).toBe(1);
  expect(native.watchCount(second)).toBe(1);
  await writeFile(join(directory, "reuse.md"), "sample");
  expect(
    (await observed(first)).events.every((event) => event.id === current)
  ).toBe(true);
  for (let i = 0; i < 510; i++) add(second);
  expect(native.watchCount(second)).toBe(511);
  expect(() => add(second)).toThrow();
  native.watchRemove(first, current);
  add(second);
  expect(native.watchCount(second)).toBe(512);
  const empty = native.watchPoll(second, 1);
  expect(empty.events.length).toBeLessThanOrEqual(1);
  for (let i = 0; i < 6; i++) create(1);
  expect(() => create(1)).toThrow();
  native.watchClose(first);
  const replacement = create(1);
  expect(native.watchCount(replacement)).toBe(0);
  native.watchClose(second);
  expect(add(replacement)).toBeGreaterThan(other);
});

test("worker environment termination releases its descriptors without closing another environment", async () => {
  const instance = create();
  const id = add(instance);
  const source = openSync(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY
  );
  const identity = fstatSync(source, { bigint: true });
  closeSync(source);
  const matching = () =>
    readdirSync("/dev/fd").filter((value) => {
      try {
        const stat = fstatSync(Number(value), { bigint: true });
        return stat.dev === identity.dev && stat.ino === identity.ino;
      } catch {
        return false;
      }
    }).length;
  const baseline = matching();
  const worker = new Worker(
    new URL("./directory-watch-test-worker.ts", import.meta.url).href
  );
  try {
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = () => resolve();
      worker.onerror = reject;
    });
    worker.postMessage({ path: directory });
    await ready;
    expect(matching()).toBe(baseline + 1);
    worker.terminate();
    for (let i = 0; matching() !== baseline && i < 100; i++) await Bun.sleep(2);
    expect(matching()).toBe(baseline);
    expect(native.watchCount(instance)).toBe(1);
    await writeFile(join(directory, "other-env.md"), "sample");
    expect(
      (await observed(instance)).events.some((event) => event.id === id)
    ).toBe(true);
  } finally {
    worker.terminate();
  }
});
