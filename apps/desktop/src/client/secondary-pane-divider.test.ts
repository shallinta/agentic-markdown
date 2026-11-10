import { expect, test } from "bun:test";

import { resizeSecondaryPaneDivider } from "./secondary-pane-divider";

test("both directions change only the adjacent pair and preserve input", () => {
  const current = Object.freeze([40, 80, 100, 60]);
  expect(resizeSecondaryPaneDivider(current, 1, 12)).toEqual([40, 92, 88, 60]);
  expect(resizeSecondaryPaneDivider(current, 1, -12)).toEqual([
    40, 68, 112, 60,
  ]);
  expect(current).toEqual([40, 80, 100, 60]);
});

test("minimum endpoints clamp exactly and blocked or zero movements preserve identity", () => {
  expect(resizeSecondaryPaneDivider([50, 70], 0, 100)).toEqual([87, 33]);
  expect(resizeSecondaryPaneDivider([50, 70], 0, -100)).toEqual([33, 87]);
  const fixed = Object.freeze([33, 33]);
  expect(resizeSecondaryPaneDivider(fixed, 0, 10)).toBe(fixed);
  expect(resizeSecondaryPaneDivider(fixed, 0, -10)).toBe(fixed);
  expect(resizeSecondaryPaneDivider(fixed, 0, 0)).toBe(fixed);
  const current = Object.freeze([40, 60]);
  expect(resizeSecondaryPaneDivider(current, 0, 0)).toBe(current);
  expect(resizeSecondaryPaneDivider([33, 50], 0, 5)).toEqual([38, 45]);
});

test("fractional CSS model values retain total and exact untouched slots", () => {
  const original = Object.freeze([33, 55.125, 80.25, 49.375]);
  for (const delta of [0.1, -0.1, 12.375, -22.125, 47.25, 1e20, -1e20]) {
    const result = resizeSecondaryPaneDivider(original, 1, delta);
    expect(result).toBeDefined();
    if (!result) throw Error("Expected valid allocation");
    expect(result[0]).toBe(original[0]);
    expect(result[3]).toBe(original[3]);
    expect(result.every((height) => height >= 33)).toBe(true);
    expect(result[1] + result[2]).toBeCloseTo(original[1] + original[2], 12);
  }
});

test("invalid indices, geometry and sparse input return no allocation", () => {
  for (const index of [-1, 1, 2, 0.5, NaN, Infinity])
    expect(resizeSecondaryPaneDivider([50, 60], index, 1)).toBeUndefined();
  for (const delta of [NaN, Infinity, -Infinity])
    expect(resizeSecondaryPaneDivider([50, 60], 0, delta)).toBeUndefined();
  for (const current of [
    [],
    [50],
    [32.99999999999999, 50],
    [NaN, 50],
    [50, Infinity],
    new Array<number>(2),
    [Number.MAX_VALUE, Number.MAX_VALUE],
  ])
    expect(resizeSecondaryPaneDivider(current, 0, 1)).toBeUndefined();
});
