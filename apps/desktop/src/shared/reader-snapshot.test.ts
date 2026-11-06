import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import {
  READER_SNAPSHOT_EVENT,
  READER_SNAPSHOT_MAX_BYTES,
  decodeReaderSnapshot,
  decodeReaderSnapshotDelivery,
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

test("only an exact, valid body envelope carries a trusted image delivery ID", () => {
  const deliveryId = "da88d15c-e444-414b-98d5-a318a0b51034";
  const text = "\uFEFF# 已保存 📖\r\n";
  const data = Buffer.from(text).toString("base64");
  const value = { protocolVersion: 1, deliveryId, data };
  const script = readerSnapshotDeliveryScript(data, deliveryId);
  if (script === undefined) throw new Error("missing body delivery expression");
  const events: CustomEvent[] = [];
  runInNewContext(script, { CustomEvent, window: { dispatchEvent: (event: CustomEvent) => events.push(event) } });
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe(READER_SNAPSHOT_EVENT);
  expect(events[0]?.detail).toEqual(value);
  expect(decodeReaderSnapshotDelivery(events[0]?.detail)).toEqual({ text, deliveryId });
  expect(decodeReaderSnapshotDelivery(data)).toEqual({ text });
  expect(decodeReaderSnapshotDelivery({ ...value, data: "" })).toEqual({ text: "", deliveryId });
  expect(decodeReaderSnapshot(value)).toBeUndefined();
  expect(readerSnapshotDeliveryScript(data, `${deliveryId}";window.injected=1`)).toBeUndefined();
  let read = false;
  const accessor = { protocolVersion: 1, deliveryId, get data() { read = true; return data; } };
  for (const invalid of [
    { ...value, path: "/tmp/body.md" }, { ...value, [Symbol("extra")]: true },
    { ...value, protocolVersion: 2 }, { ...value, deliveryId: deliveryId.replace("414b", "514b") },
    { ...value, data: "AB==" }, { ...value, data: "/w==" }, accessor,
  ]) expect(decodeReaderSnapshotDelivery(invalid)).toBeUndefined();
  expect(read).toBe(false);
});

test("rejects noncanonical, invalid UTF-8 and over-limit snapshots", () => {
  for (const value of ["Zg", "Zh==", "Zm9=", "====", "Zm=g", "SGVsbG8\n", "-w==", '";alert(1)//']) {
    expect(decodeReaderSnapshot(value)).toBeUndefined();
    expect(readerSnapshotDeliveryScript(value)).toBeUndefined();
  }
  expect(decodeReaderSnapshot({ data: "Zg==" })).toBeUndefined();
  expect(decodeReaderSnapshot("/w==")).toBeUndefined();
  const start = "\uFEFF# 中文 📖\r\n";
  const end = "\r\n保存快照末尾 `</script>`\r\n";
  const exact = start + "x".repeat(READER_SNAPSHOT_MAX_BYTES - Buffer.byteLength(start + end)) + end;
  const within = Buffer.from(exact).toString("base64");
  const oversized = Buffer.from(`${exact}x`).toString("base64");
  expect(within.length).toBe(oversized.length);
  const script = readerSnapshotDeliveryScript(within);
  if (script === undefined) throw new Error("missing maximum-size delivery expression");
  const events: CustomEvent[] = [];
  runInNewContext(script, { CustomEvent, window: { dispatchEvent: (event: CustomEvent) => events.push(event) } });
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe(READER_SNAPSHOT_EVENT);
  expect(decodeReaderSnapshot(events[0]?.detail)).toBe(exact);
  expect(readerSnapshotDeliveryScript(oversized)).toBeUndefined();
  expect(decodeReaderSnapshot(oversized)).toBeUndefined();
});
