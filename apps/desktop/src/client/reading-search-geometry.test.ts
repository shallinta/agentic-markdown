import { expect, test } from "bun:test";

import { refineReadingViewport } from "./reading-search-geometry";

test("long block refinement reaches late lines with bounded prefix/suffix geometry", () => {
  let calls = 0;
  const result = refineReadingViewport(
    [0, 12000],
    [0, 12000],
    110000,
    110400,
    (from, to) => {
      calls++;
      return { top: Math.floor(from / 2) * 20, bottom: Math.ceil(to / 2) * 20 };
    },
    () => true
  );
  expect(result.limited).toBe(false);
  expect(result.from).toBeGreaterThan(10000);
  expect(result.to).toBeLessThan(11100);
  expect(calls).toBeLessThanOrEqual(64);
});

test("nonmonotone individual cells remain conservative via prefix/suffix unions", () => {
  const y = [0, 20, 40, 0, 20, 40];
  const result = refineReadingViewport(
    [0, 6],
    [0, 6],
    20,
    30,
    (from, to) => {
      const part = y.slice(from, to);
      return { top: Math.min(...part), bottom: Math.max(...part) + 10 };
    },
    () => true
  );
  expect(result.from).toBeLessThanOrEqual(1);
  expect(result.to).toBeGreaterThan(4);
  expect(result.limited).toBe(false);
});

test("missing structural endpoints, zero geometry and stale identity explicitly retain limited coarse interval", () => {
  for (const measure of [
    () => null,
    () => ({ top: 0, bottom: 0 }),
    () => {
      throw Error("detached");
    },
  ])
    expect(
      refineReadingViewport([0, 40], [0, 40], 10, 20, measure, () => true)
    ).toEqual({ from: 0, to: 40, limited: true });
  expect(
    refineReadingViewport(
      [0, 40],
      [0, 40],
      10,
      20,
      () => ({ top: 0, bottom: 40 }),
      () => false
    ).limited
  ).toBe(true);
});

test("each clipped side falls back independently and complete sides need no measurements", () => {
  const result = refineReadingViewport(
    [0, 100],
    [0, 100],
    50,
    80,
    (from, to) => (from === 0 ? null : { top: from, bottom: to }),
    () => true
  );
  expect(result.from).toBe(0);
  expect(result.to).toBe(81);
  expect(result.limited).toBe(true);
  expect(
    refineReadingViewport(
      [0, 100],
      [0, 100],
      -10,
      110,
      () => {
        throw Error("must not measure");
      },
      () => true,
      { start: false, end: false }
    )
  ).toEqual({ from: 0, to: 100, limited: false });
});
