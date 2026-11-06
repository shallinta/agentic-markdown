import { expect, test } from "bun:test";

import { READER_IMAGE_SNAPSHOT_EVENT } from "../shared/reader-image-snapshot";

import { createReaderImageReceiver } from "./reader-image-receiver";

const deliveryId = "da88d15c-e444-414b-98d5-a318a0b51034";
const nextId = "44c84af6-e395-479a-be3f-09458e74fec9";
const image = { protocolVersion: 1, deliveryId, slot: 0, status: "image", mime: "image/png", width: 2, height: 2, data: "AA==" } as const;

function dispatch(events: EventTarget, detail: unknown) {
  events.dispatchEvent(new CustomEvent(READER_IMAGE_SNAPSHOT_EVENT, { detail }));
}

test("only the bound first valid event may publish to the selected occurrence", () => {
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
    expect(receiver.setTarget(first)).toBe(true);
    expect(receiver.getImage(first)).toEqual(image);
    expect(receiver.getImage(second)).toBeUndefined();
    dispatch(events, { ...image, mime: "image/jpeg" });
    expect(publications).toBe(1);
    expect(receiver.getImage(first)).toEqual(image);
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
    expect(expired.setTarget(target)).toBe(false);
    dispatch(events, image);
    expect(expired.getImage(target)).toBeUndefined();
  } finally {
    expired.close();
  }
  const closed = createReaderImageReceiver(events, deliveryId);
  expect(closed.setTarget(target)).toBe(true);
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
    expect(receiver.setTarget(target)).toBe(true);
    dispatch(events, { ...image, width: 2000, height: 2000 });
    expect(receiver.getImage(target)).toBeUndefined();
    dispatch(events, image);
    expect(receiver.getImage(target)).toBeUndefined();
  } finally {
    receiver.close();
  }
});
