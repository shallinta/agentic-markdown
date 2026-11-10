import { expect, test } from "bun:test";

import { READING_SEARCH_NODES } from "./reading-search-dom";
import { validReadingVisibleRangesRequest } from "./reading-search-ranges-protocol";
import {
  validSearchRequest,
  type SearchResult,
} from "./source-search-protocol";

function fixture(source = false) {
  const worker = new Worker(
    new URL(
      source ? "./source-search.worker.ts" : "./reading-search.worker.ts",
      import.meta.url
    ).href
  );
  return {
    request(data: unknown) {
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("Worker timeout")), 5000);
        worker.onmessage = (event) => {
          clearTimeout(timer);
          resolve(event.data);
        };
        worker.onerror = (event) => {
          clearTimeout(timer);
          event.preventDefault();
          reject(Error(event.message));
        };
        worker.postMessage(data);
      });
    },
    close() {
      worker.terminate();
    },
  };
}
const scan = (query: string) => ({
  kind: "scan",
  epoch: "test",
  id: 1,
  options: { query, caseSensitive: true, wholeWord: false },
  position: 0,
});
const visible = (intervals: number[][]) => ({
  kind: "viewport-ranges",
  epoch: "test",
  id: 2,
  intervals,
});
async function rejected(request: Promise<unknown>, message: string) {
  let error: unknown;
  try {
    await request;
  } catch (reason) {
    error = reason;
  }
  if (!(error instanceof Error)) throw Error("Expected Worker rejection");
  expect(error.message).toContain(message);
}

test("real reading Worker highlights both sides of more than 2048 hidden matches without moving navigation", async () => {
  const f = fixture(),
    count = 2100,
    text = "hit ".repeat(count),
    last = (count - 1) * 4;
  try {
    await f.request({
      kind: "prepare",
      epoch: "test",
      leaves: [{ id: 0, text, flow: "pre" }],
    });
    const found = (await f.request(scan("hit"))) as SearchResult;
    expect(found.count).toBe(count);
    const projected = (await f.request(
      visible([
        [0, 3],
        [last, last + 3],
      ])
    )) as SearchResult;
    expect(projected.ranges).toEqual([0, 3, last, last + 3]);
    expect([
      projected.count,
      projected.index,
      projected.current,
      projected.limited,
    ]).toEqual([count, 0, [0, 3], false]);
    const hidden = (await f.request({
      kind: "navigate",
      epoch: "test",
      id: 5,
      direction: 1000,
    })) as SearchResult;
    expect(hidden.current).toEqual([4000, 4003]);
    const visibleWithHiddenCurrent = (await f.request(
      visible([
        [0, 3],
        [last, last + 3],
      ])
    )) as SearchResult;
    expect(visibleWithHiddenCurrent.ranges).toEqual([0, 3, last, last + 3]);
    expect([
      visibleWithHiddenCurrent.count,
      visibleWithHiddenCurrent.index,
      visibleWithHiddenCurrent.current,
    ]).toEqual([count, 1000, [4000, 4003]]);
    const ordinary = (await f.request({
      kind: "viewport",
      epoch: "test",
      id: 3,
      from: 0,
      to: text.length,
    })) as SearchResult;
    expect(ordinary.ranges).toHaveLength(4096);
    expect(ordinary.limited).toBe(true);
    const full = (await f.request(visible([[0, text.length]]))) as SearchResult;
    expect(full.ranges).toEqual(ordinary.ranges);
    expect(full.limited).toBe(true);
    const navigation = (await f.request({
      kind: "navigate",
      epoch: "test",
      id: 4,
      direction: count - 1001,
    })) as SearchResult;
    expect(navigation.current).toEqual([last, last + 3]);
    const empty = (await f.request(visible([]))) as SearchResult;
    expect(empty.ranges).toEqual([]);
    expect(empty.limited).toBe(false);
    expect([empty.index, empty.current]).toEqual([count - 1, [last, last + 3]]);
  } finally {
    f.close();
  }
});

test("real Worker deduplicates one match spanning segments and preserves original zero-width viewport", async () => {
  const f = fixture();
  try {
    await f.request({
      kind: "prepare",
      epoch: "test",
      leaves: [{ id: 0, text: "abcdef", flow: "pre" }],
    });
    await f.request(scan("abcdef"));
    expect(
      (
        (await f.request(
          visible([
            [0, 1],
            [4, 6],
          ])
        )) as SearchResult
      ).ranges
    ).toEqual([0, 6]);
    expect(
      (
        (await f.request({
          kind: "viewport",
          epoch: "test",
          id: 3,
          from: 2,
          to: 2,
        })) as SearchResult
      ).ranges
    ).toEqual([0, 6]);
    await rejected(
      f.request(visible([[0, 7]])),
      "Invalid reading visible ranges"
    );
  } finally {
    f.close();
  }
});

test("visible ranges cannot concatenate across typed reading boundaries, and source Worker rejects the protocol", async () => {
  const f = fixture(),
    source = fixture(true);
  try {
    await f.request({
      kind: "prepare",
      epoch: "test",
      leaves: [
        { id: 0, text: "ab", flow: "normal" },
        { id: 1, text: "", flow: "boundary" },
        { id: 2, text: "cd", flow: "normal" },
      ],
    });
    expect(((await f.request(scan("bc"))) as SearchResult).count).toBe(0);
    expect(
      (
        (await f.request(
          visible([
            [0, 2],
            [3, 5],
          ])
        )) as SearchResult
      ).ranges
    ).toEqual([]);
    await source.request({ ...scan("a"), text: "a" });
    await rejected(source.request(visible([[0, 1]])), "invalid search message");
  } finally {
    f.close();
    source.close();
  }
});

test("reading-only interval validation is exact, bounded and rejects sparse or nonordered coordinates", () => {
  expect(validReadingVisibleRangesRequest(visible([]), 0)).toBe(true);
  expect(
    validReadingVisibleRangesRequest(
      visible([
        [0, 1],
        [1, 2],
      ]),
      2
    )
  ).toBe(true);
  const cases: unknown[] = [
    visible([[0, 0]]),
    visible([
      [1, 2],
      [0, 1],
    ]),
    visible([
      [0, 2],
      [1, 3],
    ]),
    visible([[0, 1.5]]),
    visible([[0, NaN]]),
    visible([[0, 11]]),
    visible([[-1, 1]]),
    visible(Array<number[]>(1)),
    { ...visible([]), extra: true },
    { ...visible([]), id: Infinity },
    Object.assign([], visible([])),
    visible(
      Array.from({ length: READING_SEARCH_NODES + 1 }, (_, i) => [i, i + 1])
    ),
  ];
  for (const value of cases)
    expect(validReadingVisibleRangesRequest(value, 10)).toBe(false);
  expect(validSearchRequest(visible([[0, 1]]))).toBe(false);
  const maximum = visible(
    Array.from({ length: READING_SEARCH_NODES }, (_, i) => [i, i + 1])
  );
  expect(validReadingVisibleRangesRequest(maximum, READING_SEARCH_NODES)).toBe(
    true
  );
});

test("real reading Worker keeps ranges tied to canonical projection across legacy overrides and reprepare", async () => {
  for (const override of [
    { text: "zzzz" },
    { boundaries: [[0, 1]] },
    { text: "zzzz", boundaries: [[0, 5]] },
  ]) {
    const f = fixture();
    try {
      const prepare = {
        kind: "prepare",
        epoch: "test",
        leaves: [{ id: 0, text: "aaaa", flow: "pre" }],
      };
      await f.request(prepare);
      await f.request(scan("a"));
      expect(((await f.request(visible([[0, 4]]))) as SearchResult).count).toBe(
        4
      );
      if (override.boundaries?.[0][1] === 5) {
        await rejected(
          f.request({ ...scan("z"), ...override }),
          "invalid search boundary"
        );
        continue;
      } else {
        await f.request({ ...scan("z"), ...override });
        const legacy = (await f.request({
          kind: "viewport",
          epoch: "test",
          id: 3,
          from: 0,
          to: 4,
        })) as SearchResult;
        expect(legacy.count).toBe(override.text ? 4 : 0);
      }
      await f.request(prepare);
      await f.request(scan("a"));
      expect(((await f.request(visible([[0, 4]]))) as SearchResult).count).toBe(
        4
      );
      await f.request({ ...scan("z"), ...override });
      await f.request(scan("a"));
      // Throwing malformed requests terminate Bun's Worker; keep rejection last.
      await rejected(
        f.request(visible([[0, 4]])),
        "Invalid reading visible ranges"
      );
    } finally {
      f.close();
    }
  }
});
