import { expect, test } from "bun:test";

import { parseReadingMarkdown } from "./canonical-parser";
import { createReaderImageSlot } from "./reader-image-slot";

const deliveryId = "da88d15c-e444-414b-98d5-a318a0b51034";
const nextId = "44c84af6-e395-479a-be3f-09458e74fec9";
const envelope = { protocolVersion: 1, deliveryId, slot: 0 } as const;
const unavailable = { ...envelope, status: "unavailable" } as const;
const image = { ...envelope, status: "image", mime: "image/png", width: 1, height: 1, data: "AA==" } as const;

test("holds a first valid receipt until the exact AST occurrence is known", () => {
  const { children: [paragraph] } = parseReadingMarkdown("![first](image.png) ![second](image.png)");
  if (paragraph?.type !== "paragraph") throw new Error("missing image paragraph");
  const [first, , second] = paragraph.children;
  if (first?.type !== "image" || second?.type !== "image") throw new Error("missing image nodes");
  expect(first.url).toBe(second.url);

  const slot = createReaderImageSlot(deliveryId);
  expect(slot.receive({ ...image, deliveryId: nextId })).toBe(false);
  expect(slot.receive({ ...image, data: "AB==" })).toBe(false);
  expect(slot.receive(image)).toBe(true);
  expect(slot.get(first)).toBeUndefined();
  expect(slot.setTargets([first])).toBe(true);
  expect(slot.get(first)).toEqual(image);
  expect(slot.setTargets([second])).toBe(false);
  expect(slot.get(second)).toBeUndefined();
  expect(slot.receive(unavailable)).toBe(false);
  slot.expire();
  expect(slot.get(first)).toEqual(image);
  slot.close();
  expect(slot.get(first)).toBeUndefined();
});

test("unavailability is terminal when the image target is already mounted", () => {
  const target = {};
  const slot = createReaderImageSlot(deliveryId);
  expect(slot.setTargets([target])).toBe(true);
  expect(slot.get(target)).toBeUndefined();
  expect(slot.receive(unavailable)).toBe(true);
  expect(slot.get(target)).toEqual(unavailable);
  expect(slot.receive(image)).toBe(false);
});

test("timeout drops buffered bytes and close or a new reader rejects a late old receipt", () => {
  const target = {};
  const timedOut = createReaderImageSlot(deliveryId);
  expect(timedOut.receive(image)).toBe(true);
  timedOut.expire();
  expect(timedOut.setTargets([target])).toBe(false);
  expect(timedOut.get(target)).toBeUndefined();
  expect(timedOut.receive(image)).toBe(false);

  const old = createReaderImageSlot(deliveryId);
  old.close();
  const next = createReaderImageSlot(nextId);
  expect(next.setTargets([target])).toBe(true);
  expect(old.receive(image)).toBe(false);
  expect(next.receive(image)).toBe(false);
  expect(next.receive({ ...image, deliveryId: nextId })).toBe(true);
  expect(next.get(target)?.deliveryId).toBe(nextId);
});

test("slot one waits for slot zero's terminal state and maps to a separate exact node", () => {
  const a = { reference: "same.png" }, b = { reference: "same.png" }, extra = { reference: "same.png" };
  const second = { ...image, slot: 1 } as const;
  const slot = createReaderImageSlot(deliveryId);
  expect(slot.setTargets([a, a])).toBe(false);
  expect(slot.setTargets([a, b, extra])).toBe(false);
  expect(slot.receive(second)).toBe(false);
  expect(slot.receive(unavailable)).toBe(true);
  expect(slot.receive(image)).toBe(false);
  expect(slot.receive(second)).toBe(true);
  expect(slot.settled()).toBe(true);
  expect(slot.setTargets([a, b])).toBe(true);
  expect(slot.get(a)).toEqual(unavailable);
  expect(slot.get(b)).toEqual(second);
  expect(slot.get(extra)).toBeUndefined();
  expect(slot.receive(second)).toBe(false);
});

test("bound expiry preserves settled slot zero and discards late slot one", () => {
  const a = {}, b = {};
  const slot = createReaderImageSlot(deliveryId);
  expect(slot.setTargets([a, b])).toBe(true);
  expect(slot.receive(image)).toBe(true);
  expect(slot.settled()).toBe(false);
  slot.expire();
  expect(slot.settled()).toBe(true);
  expect(slot.receive({ ...image, slot: 1 })).toBe(false);
  expect(slot.get(a)).toEqual(image);
  expect(slot.get(b)).toBeUndefined();
});
