import { expect, test } from "bun:test";

import {
  createReadingCodeCopy,
  type CodeCopyStatus,
} from "./reading-code-copy";

test("gesture writes exact payload synchronously, rejects repeats and waits for success", async () => {
  let resolve!: () => void;
  const calls: string[] = [],
    states: CodeCopyStatus[] = [];
  const copy = createReadingCodeCopy(
    () => true,
    (text) => {
      calls.push(text);
      return new Promise<void>((done) => {
        resolve = done;
      });
    },
    (state) => states.push(state)
  );
  expect(copy.copy("x\r\n  ")).toBe(true);
  expect(calls).toEqual(["x\r\n  "]);
  expect(states).toEqual(["pending"]);
  expect(copy.copy("different")).toBe(false);
  resolve();
  await Promise.resolve();
  expect(states).toEqual(["pending", "success"]);
});
test("stale identity blocks start and late completion, dispose does not claim revocation", async () => {
  let current = false,
    resolve!: () => void,
    calls = 0;
  const states: CodeCopyStatus[] = [];
  const copy = createReadingCodeCopy(
    () => current,
    () => {
      calls++;
      return new Promise<void>((done) => {
        resolve = done;
      });
    },
    (status) => states.push(status)
  );
  expect(copy.copy("x")).toBe(false);
  expect(calls).toBe(0);
  current = true;
  copy.copy("x");
  current = false;
  resolve();
  await Promise.resolve();
  expect(states).toEqual(["pending", "idle"]);
  current = true;
  copy.copy("y");
  copy.cancel();
  resolve();
  await Promise.resolve();
  expect(states).toEqual(["pending", "idle", "pending"]);
  expect(calls).toBe(2);
});
test("sync unavailable and async denied both report failure and allow explicit retry", async () => {
  const states: CodeCopyStatus[] = [];
  let mode = 0;
  const copy = createReadingCodeCopy(
    () => true,
    () => {
      if (mode++ === 0) throw Error("unavailable");
      return Promise.reject(new Error("denied"));
    },
    (state) => states.push(state)
  );
  expect(copy.copy("")).toBe(true);
  expect(states).toEqual(["failed"]);
  expect(copy.copy("")).toBe(true);
  await Promise.resolve();
  expect(states).toEqual(["failed", "pending", "failed"]);
});
