import { expect, test } from "bun:test";

import { MAX_DOCUMENT_BYTES } from "../../shared/documents";

import {
  copyStoredMainTabPosition,
  decodeMainTabPosition,
  encodeMainTabPosition,
} from "./main-tab-position-codec";
import { createMarkdownBlockAnchorProbe } from "./markdown-block-anchor-probe";

function probe(raw: string) {
  const result = createMarkdownBlockAnchorProbe(raw);
  if (result.status !== "ready") throw Error(result.status);
  return result;
}

test("a real block receipt survives JSON and preserves independent offsets and neighborhood", () => {
  const original = "\uFEFFbefore\r\n\r\n😀target\r\n\r\nafter";
  const source = probe(original);
  const receipt = source.capturePosition({
    from: original.indexOf("target"),
    offset: -2.25,
    blockOffset: -52.5,
    ratio: 0.25,
  });
  const stored = encodeMainTabPosition(receipt);
  if (!stored?.block) throw Error("Fixture block was not captured");
  expect(stored.offset).toBe(-2.25);
  expect(stored.block.offset).toBe(-52.5);
  const bytes = JSON.stringify(stored);
  expect(bytes).not.toContain("target");
  const read = decodeMainTabPosition(JSON.parse(bytes));
  expect(read).toEqual(receipt);
  expect(source.resolvePosition(read)).toEqual({
    status: "block",
    from: original.indexOf("😀"),
    to: original.indexOf("\r\n", original.indexOf("target")),
    offset: -52.5,
  });
  const changed = "intro\r\n\r\nbefore\r\n\r\nafter";
  expect(probe(changed).resolvePosition(read)).toEqual({
    status: "neighbor",
    side: "after",
    from: changed.indexOf("after"),
    to: changed.length,
  });
});

test("a source-only receipt omits the block and restores a ratio after truncation", () => {
  const receipt = probe("\uFEFF\r\n").capturePosition({
    from: 3,
    offset: 0,
    ratio: 0.75,
  });
  const stored = encodeMainTabPosition(receipt);
  expect(stored).toEqual({ from: 3, offset: 0, ratio: 0.75 });
  expect(Object.keys(stored ?? {}).sort()).toEqual(["from", "offset", "ratio"]);
  const read = decodeMainTabPosition(JSON.parse(JSON.stringify(stored)));
  expect(read).toEqual(receipt);
  expect(probe("").resolvePosition(read)).toEqual({
    status: "ratio",
    ratio: 0.75,
  });
});

test("the codec rejects out-of-range values, contradictory anchors and extra JSON fields", () => {
  const receipt = probe("first\n\nsecond").capturePosition({
    from: 0,
    offset: 0,
    ratio: 1,
  });
  const stored = encodeMainTabPosition(receipt);
  if (!stored?.block || !receipt?.anchor)
    throw Error("Fixture block was not captured");
  for (const bad of [
    { ...stored, path: "/private" },
    { ...stored, block: undefined },
    { ...stored, from: MAX_DOCUMENT_BYTES + 1 },
    { ...stored, from: -0 },
    { ...stored, offset: Infinity },
    { ...stored, ratio: 1.5 },
    { ...stored, block: { ...stored.block, occurrence: 1 } },
    { ...stored, block: { ...stored.block, before: stored.block.hash } },
    { ...stored, block: { ...stored.block, offset: undefined } },
    { ...stored, block: { ...stored.block, source: "text" } },
  ]) {
    expect(copyStoredMainTabPosition(bad)).toBeUndefined();
    expect(decodeMainTabPosition(bad)).toBeUndefined();
  }
  expect(encodeMainTabPosition({ ...receipt, blockOffset: 5 })).toBeUndefined();
  expect(
    encodeMainTabPosition({ ...receipt, anchor: undefined })
  ).toBeUndefined();
});

test("projection never calls accessors or keeps caller serialization hooks", () => {
  const receipt = probe("a").capturePosition({ from: 0, offset: 0, ratio: 0 });
  if (!receipt?.anchor) throw Error("Fixture block was not captured");
  let hooks = 0;
  const hook = () => {
    hooks++;
    return { raw: "private" };
  };
  Object.defineProperty(receipt.anchor.position.anchor, "toJSON", {
    value: hook,
  });
  const encoded = encodeMainTabPosition(receipt);
  if (!encoded?.block) throw Error("Fixture block was not encoded");
  Object.defineProperty(encoded.block, "toJSON", { value: hook });
  const copy = copyStoredMainTabPosition(encoded);
  expect(copy).toEqual(encoded);
  expect(JSON.stringify(copy)).not.toContain("private");
  Object.defineProperty(encoded.block, "hash", { enumerable: true, get: hook });
  Object.defineProperty(receipt, "ratio", { enumerable: true, get: hook });
  expect(copyStoredMainTabPosition(encoded)).toBeUndefined();
  expect(encodeMainTabPosition(receipt)).toBeUndefined();
  expect(hooks).toBe(0);
});
