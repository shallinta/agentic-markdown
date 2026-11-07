import { expect, test } from "bun:test";

import { READER_IMAGE_SNAPSHOT_EVENT, READER_IMAGE_SNAPSHOT_MAX_BYTES } from "../shared/reader-image-snapshot";

import { createReaderImageReceiver } from "./reader-image-receiver";

const deliveryId = "da88d15c-e444-414b-98d5-a318a0b51034";
const nextId = "44c84af6-e395-479a-be3f-09458e74fec9";
const image = { protocolVersion: 1, deliveryId, slot: 0, status: "image", mime: "image/png", width: 2, height: 2, data: "AA==" } as const;

function dispatch(events: EventTarget, detail: unknown) {
  events.dispatchEvent(new CustomEvent(READER_IMAGE_SNAPSHOT_EVENT, { detail }));
}

test("only the first valid event for each slot may publish to its bound occurrence", () => {
  const events = new EventTarget();
  const first = { reference: "same.png" };
  const second = { reference: "same.png" };
  dispatch(events, image); // No image receiver before the validated body.
  const receiver = createReaderImageReceiver(events, deliveryId);
  let publications = 0;
  const unsubscribe = receiver.subscribe(() => publications++);
  try {
    expect(receiver.getImage(first)).toBeUndefined();
    dispatch(events, { ...image, deliveryId: nextId });
    dispatch(events, { ...image, path: "/private/asset.png" });
    expect(publications).toBe(0);
    dispatch(events, image);
    expect(publications).toBe(1);
    expect(receiver.getImage(first)).toBeUndefined();
    expect(receiver.setTargets([first, second])).toBe(true);
    expect(receiver.getImage(first)).toEqual(image);
    expect(receiver.getImage(second)).toBeUndefined();
    dispatch(events, { ...image, mime: "image/jpeg" });
    expect(publications).toBe(1);
    expect(receiver.getImage(first)).toEqual(image);
    const later = { ...image, slot: 1 } as const;
    dispatch(events, later);
    expect(publications).toBe(2);
    expect(receiver.getImage(second)).toEqual(later);
    dispatch(events, later);
    expect(publications).toBe(2);
  } finally {
    unsubscribe();
    receiver.close();
  }
});

test("expiration and pagehide discard early or late data", async () => {
  const events = new EventTarget();
  const target = {};
  const expired = createReaderImageReceiver(events, deliveryId, 0);
  try {
    dispatch(events, image);
    await Bun.sleep(5);
    expect(expired.setTargets([target])).toBe(false);
    dispatch(events, image);
    expect(expired.getImage(target)).toBeUndefined();
  } finally {
    expired.close();
  }
  const closed = createReaderImageReceiver(events, deliveryId);
  expect(closed.setTargets([target])).toBe(true);
  dispatch(events, image);
  expect(closed.getImage(target)).toEqual(image);
  events.dispatchEvent(new Event("pagehide"));
  dispatch(events, image);
  expect(closed.getImage(target)).toBeUndefined();
});

test("one valid but too costly raster stays a placeholder and cannot be retried", () => {
  const events = new EventTarget();
  const target = {};
  const receiver = createReaderImageReceiver(events, deliveryId);
  try {
    expect(receiver.setTargets([target])).toBe(true);
    dispatch(events, { ...image, width: 2000, height: 2000 });
    expect(receiver.getImage(target)).toBeUndefined();
    dispatch(events, image);
    expect(receiver.getImage(target)).toBeUndefined();
  } finally {
    receiver.close();
  }
});

test("two individually affordable rasters share the original retained and presentation budget", () => {
  const large = { ...image, width: 512, height: 512, data: Buffer.alloc(READER_IMAGE_SNAPSHOT_MAX_BYTES).toString("base64") };
  for (const second of [image, large]) {
    const events = new EventTarget();
    const a = {}, b = {};
    const receiver = createReaderImageReceiver(events, deliveryId);
    try {
      expect(receiver.setTargets([a, b])).toBe(true);
      const later = { ...second, slot: 1 as const };
      dispatch(events, large);
      dispatch(events, later);
      expect(receiver.getImage(a)).toEqual(large);
      expect(receiver.getImage(b)).toEqual(second === large ? undefined : later);
      dispatch(events, { ...image, slot: 1 });
      expect(receiver.getImage(b)).toEqual(second === large ? undefined : later);
    } finally {
      receiver.close();
    }
  }
});

test("an over-budget first raster does not block a valid second raster", () => {
  const events = new EventTarget();
  const a = {}, b = {};
  const receiver = createReaderImageReceiver(events, deliveryId);
  const second = { ...image, slot: 1 } as const;
  try {
    expect(receiver.setTargets([a, b])).toBe(true);
    dispatch(events, { ...image, width: 2000, height: 2000 });
    dispatch(events, second);
    expect(receiver.getImage(a)).toBeUndefined();
    expect(receiver.getImage(b)).toEqual(second);
  } finally {
    receiver.close();
  }
});
