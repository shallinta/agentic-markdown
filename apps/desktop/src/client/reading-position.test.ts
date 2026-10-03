import { expect, test } from "bun:test";

import { firstReadingBlock } from "./reading-position";

test("ordered block lookup handles gaps, missing blocks and 32768-block bottom without full scan", () => {
  const ends = [10, 30, 50];
  expect(firstReadingBlock(ends.length, (index) => ends[index] >= 20)).toBe(1);
  expect(firstReadingBlock(ends.length, (index) => ends[index] >= 60)).toBe(3);
  expect(firstReadingBlock(0, () => true)).toBe(0);
  let measuredReads = 0;
  expect(
    firstReadingBlock(32768, (index) => {
      measuredReads++;
      return index >= 32766;
    })
  ).toBe(32766);
  expect(measuredReads).toBe(15);
});
