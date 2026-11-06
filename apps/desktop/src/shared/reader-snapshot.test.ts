import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import {
  READER_SNAPSHOT_EVENT,
  READER_SNAPSHOT_MAX_BYTES,
  decodeReaderSnapshot,
  readerSnapshotDeliveryScript,
} from "./reader-snapshot";

test("dispatches only a fixed event with canonical base64, preserving saved UTF-8 bytes", () => {
  const original = '\uFEFF# 中文 📖\r\n\u2028</script> "); window.injected = true; //\r\n';
  const base64 = Buffer.from(original, "utf8").toString("base64");
  const script = readerSnapshotDeliveryScript(base64);
  expect(script).toBeDefined();
  if (script === undefined) throw new Error("missing delivery expression");
  const window = { dispatchEvent: (event: CustomEvent) => events.push(event) };
  const events: CustomEvent[] = [];
  runInNewContext(script, { CustomEvent, window });
  expect(Object.keys(window)).toEqual(["dispatchEvent"]);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe(READER_SNAPSHOT_EVENT);
  expect(events[0]?.detail).toBe(base64);
  expect(decodeReaderSnapshot(events[0]?.detail)).toBe(original);
  expect(decodeReaderSnapshot("")).toBe("");
});

test("rejects noncanonical, invalid UTF-8 and over-limit snapshots", () => {
  for (const value of ["Zg", "Zh==", "Zm9=", "====", "Zm=g", "SGVsbG8\n", "-w==", '";alert(1)//']) {
    expect(decodeReaderSnapshot(value)).toBeUndefined();
    expect(readerSnapshotDeliveryScript(value)).toBeUndefined();
  }
  expect(decodeReaderSnapshot({ data: "Zg==" })).toBeUndefined();
  expect(decodeReaderSnapshot("/w==")).toBeUndefined();
  const exact = "x".repeat(READER_SNAPSHOT_MAX_BYTES);
  const within = Buffer.from(exact).toString("base64");
  const oversized = Buffer.from(`${exact}x`).toString("base64");
  expect(within.length).toBe(oversized.length);
  expect(readerSnapshotDeliveryScript(within)).toBeDefined();
  expect(decodeReaderSnapshot(within)).toBe(exact);
  expect(readerSnapshotDeliveryScript(oversized)).toBeUndefined();
  expect(decodeReaderSnapshot(oversized)).toBeUndefined();
});
