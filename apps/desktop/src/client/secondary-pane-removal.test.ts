import { expect, test } from "bun:test";

import { removeSecondaryPaneHeight } from "./secondary-pane-removal";

test("first and middle transfer downward; last transfers upward without changing other slots", () => {
  const current = Object.freeze([33, 46, 55]);
  expect(removeSecondaryPaneHeight(current, 0)).toEqual([79, 55]);
  expect(removeSecondaryPaneHeight(current, 1)).toEqual([33, 101]);
  expect(removeSecondaryPaneHeight(current, 2)).toEqual([33, 101]);
  expect(current).toEqual([33, 46, 55]);
  expect(removeSecondaryPaneHeight([40, 50, 60, 70], 1)).toEqual([40, 110, 70]);
});

test("one survivor occupies the whole space; removing the last slot returns empty", () => {
  const one = removeSecondaryPaneHeight([79, 55], 0);
  expect(one).toEqual([134]);
  if (!one) throw Error("Expected survivor");
  expect(removeSecondaryPaneHeight(one, 0)).toEqual([]);
  expect(one).toEqual([134]);
  expect(removeSecondaryPaneHeight(Object.freeze([33]), 0)).toEqual([]);
});

test("fractional model heights retain the receiver sum and untouched slots exactly", () => {
  const current = Object.freeze([33.125, 46.25, 55.5, 67.75]);
  const result = removeSecondaryPaneHeight(current, 1);
  expect(result).toEqual([33.125, 101.75, 67.75]);
  expect(result?.reduce((a, b) => a + b, 0)).toBe(
    current.reduce((a, b) => a + b, 0)
  );
});

test("invalid index, sparse or invalid heights and overflowing transfer reject without mutation", () => {
  const current = Object.freeze([33, 46, 55]);
  for (const index of [-1, 3, 0.5, NaN, Infinity])
    expect(removeSecondaryPaneHeight(current, index)).toBeUndefined();
  for (const heights of [
    [],
    [32.99999999999999],
    [NaN],
    [Infinity],
    new Array<number>(2),
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [33, 32],
  ]) {
    const before = heights.slice();
    expect(removeSecondaryPaneHeight(heights, 0)).toBeUndefined();
    expect(heights).toEqual(before);
  }
  expect(current).toEqual([33, 46, 55]);
});
