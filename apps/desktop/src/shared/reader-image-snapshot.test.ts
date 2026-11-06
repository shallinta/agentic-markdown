import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import { MAX_IMAGE_PIXELS } from "./local-images";
import {
  READER_IMAGE_SNAPSHOT_EVENT,
  READER_IMAGE_SNAPSHOT_MAX_BYTES,
  type ReaderImageSnapshot,
  parseReaderImageSnapshot,
  readerImageSnapshotDeliveryScript,
} from "./reader-image-snapshot";

const deliveryId = "da88d15c-e444-414b-98d5-a318a0b51034";
const otherId = "44c84af6-e395-479a-be3f-09458e74fec9";
const envelope = { protocolVersion: 1, deliveryId, slot: 0 } as const;
const unavailable = { ...envelope, status: "unavailable" } as const;
const image = {
  ...envelope, status: "image", mime: "image/png", width: 1, height: 1, data: "AA==",
} as const;

test("uses one fixed one-way event for either valid image format or unavailability", () => {
  const events: CustomEvent[] = [];
  const window = { dispatchEvent: (event: CustomEvent) => events.push(event) };
  const receipts: ReaderImageSnapshot[] = [image, { ...image, slot: 1, mime: "image/jpeg", data: "/9j/" }, unavailable];
  for (const value of receipts) {
    const script = readerImageSnapshotDeliveryScript(value, deliveryId);
    if (script === undefined) throw new Error("missing image delivery expression");
    runInNewContext(script, { CustomEvent, window });
    const event = events[events.length - 1];
    expect(event?.type).toBe(READER_IMAGE_SNAPSHOT_EVENT);
    expect(event?.detail).toEqual(value);
    expect(parseReaderImageSnapshot(event?.detail, deliveryId)).toEqual(value);
    expect(parseReaderImageSnapshot(event?.detail, otherId)).toBeUndefined();
  }
  expect(events).toHaveLength(3);
  expect(Object.keys(window)).toEqual(["dispatchEvent"]);
});

test("bounds exact decoded bytes and requires canonical padding", () => {
  const exact = Buffer.alloc(READER_IMAGE_SNAPSHOT_MAX_BYTES, 255).toString("base64");
  const over = Buffer.alloc(READER_IMAGE_SNAPSHOT_MAX_BYTES + 1, 255).toString("base64");
  expect(exact.length).toBe(over.length);
  expect(parseReaderImageSnapshot({ ...image, data: exact }, deliveryId)?.status).toBe("image");
  const script = readerImageSnapshotDeliveryScript({ ...image, data: exact }, deliveryId);
  if (script === undefined) throw new Error("missing maximum-size image delivery expression");
  const events: CustomEvent[] = [];
  runInNewContext(script, { CustomEvent, window: { dispatchEvent: (event: CustomEvent) => events.push(event) } });
  const receipt = parseReaderImageSnapshot(events[0]?.detail, deliveryId);
  expect(events).toHaveLength(1);
  expect(receipt?.status === "image" && receipt.data === exact).toBe(true);
  for (const data of [over, "", "AA", "AB==", "AAF=", "A===", "A=AA", "_w==", "AAA\n", '";window.injected=true;//']) {
    expect(parseReaderImageSnapshot({ ...image, data }, deliveryId)).toBeUndefined();
    expect(readerImageSnapshotDeliveryScript({ ...image, data }, deliveryId)).toBeUndefined();
  }
});

test("rejects invalid slot, version, delivery ID, MIME and dimensions", () => {
  expect(parseReaderImageSnapshot({ ...image, width: 4096, height: 4096 }, deliveryId)?.status).toBe("image");
  for (const fields of [
    { slot: 2 }, { slot: -1 }, { slot: "1" }, { protocolVersion: 2 }, { deliveryId: otherId }, { mime: "image/svg+xml" },
    { width: 0 }, { height: -1 }, { width: 1.5 }, { width: Infinity }, { height: "1" },
    { width: MAX_IMAGE_PIXELS + 1 }, { width: 4096, height: 4097 },
  ]) expect(parseReaderImageSnapshot({ ...image, ...fields }, deliveryId)).toBeUndefined();

  for (const bad of [deliveryId.replace("414b", "514b"), deliveryId.replace("98d5", "78d5"), `${deliveryId}\n`]) {
    expect(parseReaderImageSnapshot({ ...unavailable, deliveryId: bad }, bad)).toBeUndefined();
  }
});

test("rejects unlisted and inherited fields without invoking getters or toJSON", () => {
  const { data, ...missingData } = image;
  let invoked = false;
  const accessor = Object.defineProperty({ ...missingData }, "data", {
    get() { invoked = true; return data; },
  });
  const poisoned = { ...image, toJSON() { invoked = true; return {}; } };
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  for (const value of [
    { ...image, path: "/tmp/asset.png" }, { ...image, [Symbol("extra")]: true },
    { ...unavailable, data }, { ...unavailable, error: "opaque" },
    { ...missingData, identity: "extra" }, missingData, accessor, poisoned, proxy,
    Object.assign(Object.create({ data }), missingData),
  ]) {
    expect(parseReaderImageSnapshot(value, deliveryId)).toBeUndefined();
    expect(readerImageSnapshotDeliveryScript(value, deliveryId)).toBeUndefined();
  }
  expect(invoked).toBe(false);
});
