import { expect, test } from "bun:test";

import {
  allocateSecondaryPaneHeight,
  SECONDARY_MIN_HEIGHT,
} from "./secondary-pane-height";

test("empty slot fills all height, ordinary slots scale proportionally in original order", () => {
  expect(SECONDARY_MIN_HEIGHT).toBe(33);
  expect(allocateSecondaryPaneHeight(200, [])).toEqual({
    ok: true,
    heights: [200],
  });
  expect(allocateSecondaryPaneHeight(33, [])).toEqual({
    ok: true,
    heights: [33],
  });
  expect(allocateSecondaryPaneHeight(32, [])).toEqual({
    ok: false,
    reason: "full",
  });
  const proportional = allocateSecondaryPaneHeight(300, [100, 200]);
  expect(proportional.ok).toBe(true);
  if (!proportional.ok) throw Error("Expected proportional allocation");
  proportional.heights.forEach((height, index) =>
    expect(height).toBeCloseTo([200 / 3, 400 / 3, 100][index], 12)
  );
});

test("minimums stay fixed; equal-pixel giving exits minimum-bound slots", () => {
  expect(allocateSecondaryPaneHeight(98, [33, 65])).toEqual({
    ok: false,
    reason: "full",
  });
  expect(allocateSecondaryPaneHeight(99, [33, 66])).toEqual({
    ok: true,
    heights: [33, 33, 33],
  });
  expect(allocateSecondaryPaneHeight(134, [33, 46, 55])).toEqual({
    ok: true,
    heights: [33, 33, 35, 33],
  });
  expect(allocateSecondaryPaneHeight(200, [33, 167])).toEqual({
    ok: true,
    heights: [33, (167 * 2) / 3, 200 - (33 + (167 * 2) / 3)],
  });
});

test("immutable inputs and fractional model heights conserve total without admitting subminimum space", () => {
  const input = Object.freeze([33, 46.125, 55.25]);
  const result = allocateSecondaryPaneHeight(134.375, input);
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("Expected allocation");
  expect(result.heights).toEqual([33, 33, 35.375, 33]);
  expect(input).toEqual([33, 46.125, 55.25]);
  const epsilon = Number.EPSILON * 99;
  expect(allocateSecondaryPaneHeight(99 - epsilon, [33, 66 - epsilon])).toEqual(
    { ok: false, reason: "full" }
  );
  const exact = allocateSecondaryPaneHeight(99 + epsilon, [33, 66 + epsilon]);
  expect(exact.ok).toBe(true);
  if (exact.ok) {
    expect(exact.heights[0]).toBe(33);
    expect(exact.heights.every((height) => height >= 33)).toBe(true);
    expect(
      Math.abs(exact.heights.reduce((a, b) => a + b, 0) - (99 + epsilon))
    ).toBeLessThanOrEqual(epsilon);
  }
});

test("nonfinite, sparse, undersized or inconsistent model geometry fails unchanged", () => {
  for (const total of [NaN, Infinity, -Infinity, -1])
    expect(allocateSecondaryPaneHeight(total, [])).toEqual({
      ok: false,
      reason: "invalid",
    });
  for (const heights of [
    [NaN],
    [Infinity],
    [-1],
    [32.99999999999999],
    [100],
    new Array<number>(1),
  ]) {
    const original = heights.slice();
    expect(allocateSecondaryPaneHeight(200, heights)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(heights).toEqual(original);
  }
});

test("repeated fractional insertions remain bounded, conserve height and end at true capacity", () => {
  const total = 1024.125;
  let heights: number[] = [];
  for (
    let count = 1;
    count <= Math.floor(total / SECONDARY_MIN_HEIGHT);
    count++
  ) {
    const result = allocateSecondaryPaneHeight(total, heights);
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error(`Unexpected rejection at ${count}`);
    heights = result.heights;
    expect(heights).toHaveLength(count);
    expect(
      heights.every((height) => Number.isFinite(height) && height >= 33)
    ).toBe(true);
    expect(Math.abs(heights.reduce((a, b) => a + b, 0) - total)).toBeLessThan(
      1e-9
    );
  }
  expect(allocateSecondaryPaneHeight(total, heights)).toEqual({
    ok: false,
    reason: "full",
  });
});

test("next representable capacity never grows a previously minimum-height slot", () => {
  const next = 99 + 2 ** -46;
  const result = allocateSecondaryPaneHeight(
    next,
    Object.freeze([33, next - 33])
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw Error("Expected near-capacity allocation");
  expect(result.heights[0]).toBe(33);
  expect(result.heights[2]).toBe(33);
  expect(result.heights.every((height) => height >= 33)).toBe(true);
  expect(Math.abs(result.heights.reduce((a, b) => a + b, 0) - next)).toBeLessThanOrEqual(2 ** -46);
  expect(allocateSecondaryPaneHeight(99, [33.01, 65.99])).toEqual({ ok: true, heights: [33, 33, 33] });
});
