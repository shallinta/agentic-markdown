import { expect, test } from "bun:test";

import { editorOffset, editorText, rawOffset } from "./raw-buffer";
import { createSearchEngine } from "./source-search-engine";
import {
  SEARCH_LIMIT,
  SEARCH_MARK_LIMIT,
  validSearchRequest,
  validSearchResult,
  type SearchRequest,
} from "./source-search-protocol";

test("replacement exclusion only affects automatic current, never count or explicit navigation", () => {
  const engine = createSearchEngine();
  const request = {
    kind: "scan" as const,
    epoch: "replacement",
    id: 1,
    text: "aa",
    options: { query: "a", caseSensitive: true, wholeWord: false },
    position: 2,
    exclude: [0, 2] as [number, number],
  };
  const result = engine(request);
  expect(result.count).toBe(2);
  expect(result.current).toBeNull();
  expect(validSearchResult(result, request, 2)).toBe(true);
  expect(
    engine({ kind: "navigate", epoch: request.epoch, id: 2, direction: 1 })
      .current
  ).toEqual([0, 1]);
  expect(engine({ ...request, id: 3, exclude: [0, 1] }).current).toEqual([
    1, 2,
  ]);
  expect(
    engine({ ...request, id: 4, exclude: [0, 0], position: 0 }).current
  ).toEqual([0, 1]);
  expect(validSearchRequest({ ...request, exclude: [2, 1] })).toBe(false);
});

function scan(
  text: string,
  query: string,
  caseSensitive = true,
  wholeWord = false
) {
  const engine = createSearchEngine();
  const request: SearchRequest = {
    kind: "scan",
    epoch: "test",
    id: 1,
    text,
    options: { query, caseSensitive, wholeWord },
    position: 0,
  };
  const result = engine(request);
  expect(validSearchResult(result, request, editorText(text).length)).toBe(
    true
  );
  return { engine, request, result };
}

test("literal Unicode matches retain actual UTF-16 ranges without compatibility folding", () => {
  const cases: [string, string, number[]][] = [
    ["ａaa", "aa", [1, 3]],
    ["① 1", "1", [2, 3]],
    ["Ａ A", "A", [2, 3]],
    ["é e", "e", [2, 3]],
    ["é e\u0301", "é", [0, 1]],
    ["é e\u0301", "e\u0301", [2, 4]],
    ["中😀文😀", "😀", [1, 3, 4, 6]],
    ["aaaaa", "aa", [0, 2, 2, 4]],
    ["a\\b a.b", "\\", [1, 2]],
    ["a.b axb", "a.b", [0, 3]],
    ["中文中文", "中文", [0, 2, 2, 4]],
  ];
  for (const [text, query, ranges] of cases) {
    const { engine, result } = scan(text, query);
    expect(result.count).toBe(ranges.length / 2);
    expect(
      engine({
        kind: "viewport",
        epoch: "test",
        id: 2,
        from: 0,
        to: text.length,
      }).ranges
    ).toEqual(ranges);
  }
  expect(scan("Aa aA", "aa", false).result.count).toBe(2);
  expect(scan("Aa aA", "aa", true).result.count).toBe(0);
  expect(scan("ß ss", "ss", false).result.current).toEqual([2, 4]);
});

test("whole-word uses character boundaries rather than Chinese segmentation", () => {
  const { engine, result } = scan("cat scatter cat_cat cat", "cat", true, true);
  expect(result.count).toBe(2);
  expect(
    engine({ kind: "viewport", epoch: "test", id: 2, from: 0, to: 23 }).ranges
  ).toEqual([0, 3, 20, 23]);
  expect(scan("中文 中文字", "中文", true, true).result.current).toEqual([
    0, 2,
  ]);
  expect(scan("中文 中文字", "中文", true, true).result.count).toBe(1);
});

test("BOM and CRLF query use logical coordinates without mutating raw input", () => {
  const raw = "\ufeffA\r\nB\n尾";
  const text = editorText(raw);
  const { result } = scan(text, "A\r\nB");
  expect(result.current).toEqual([1, 4]);
  expect(raw.slice(rawOffset(raw, 1), rawOffset(raw, 4))).toBe("A\r\nB");
  expect(editorOffset(raw, rawOffset(raw, 4))).toBe(4);
  expect(scan(text, "\ufeff").result.current).toEqual([0, 1]);
  expect(raw).toBe("\ufeffA\r\nB\n尾");
});

test("empty, missing, reused text, stale epochs and looping navigation", () => {
  expect(scan("abc", "").result).toMatchObject({
    count: 0,
    index: -1,
    current: null,
  });
  expect(scan("", "a").result.count).toBe(0);
  const { engine } = scan("ab ab ab", "ab");
  expect(
    engine({ kind: "navigate", epoch: "test", id: 2, direction: -1 }).current
  ).toEqual([6, 8]);
  expect(
    engine({ kind: "navigate", epoch: "test", id: 3, direction: 1 }).current
  ).toEqual([0, 2]);
  expect(
    engine({
      kind: "scan",
      epoch: "next",
      id: 4,
      options: { query: "b", caseSensitive: true, wholeWord: false },
      position: 4,
    }).current
  ).toEqual([4, 5]);
  expect(() =>
    engine({ kind: "navigate", epoch: "test", id: 5, direction: 1 })
  ).toThrow();
  expect(() =>
    createSearchEngine()({
      kind: "scan",
      epoch: "x",
      id: 1,
      options: { query: "a", caseSensitive: true, wholeWord: false },
      position: 0,
    })
  ).toThrow();
});

test("bounded accumulated navigation accepts zero and wraps multiple steps both ways", () => {
  const { engine } = scan("ab ab ab", "ab");
  for (const [direction, expected] of [
    [0, 0],
    [5, 2],
    [-7, 1],
    [3, 1],
    [-3, 1],
  ] as const) {
    const request: SearchRequest = {
      kind: "navigate",
      epoch: "test",
      id: 20,
      direction,
    };
    expect(validSearchRequest(request)).toBe(true);
    const result = engine(request);
    expect(result.index).toBe(expected);
    expect(result.current).toEqual([expected * 3, expected * 3 + 2]);
    expect(validSearchResult(result, request, 8)).toBe(true);
  }
});

test("one MiB dense index returns full count but bounded viewport ranges", () => {
  const { engine, result } = scan("a".repeat(SEARCH_LIMIT), "a");
  expect(result.count).toBe(SEARCH_LIMIT);
  expect(result.ranges).toEqual([]);
  const request: SearchRequest = {
    kind: "viewport",
    epoch: "test",
    id: 2,
    from: 0,
    to: SEARCH_LIMIT,
  };
  const page = engine(request);
  expect(page.ranges.length).toBe(SEARCH_MARK_LIMIT * 2);
  expect(page.limited).toBe(true);
  expect(validSearchResult(page, request, SEARCH_LIMIT)).toBe(true);
  expect(engine({ ...request, id: 3, from: SEARCH_LIMIT - 2 }).ranges).toEqual([
    SEARCH_LIMIT - 2,
    SEARCH_LIMIT - 1,
    SEARCH_LIMIT - 1,
    SEARCH_LIMIT,
  ]);
  const exact = engine({ ...request, id: 4, to: SEARCH_MARK_LIMIT });
  expect(exact.limited).toBe(false);
  expect(scan("a".repeat(SEARCH_LIMIT), "z").result.count).toBe(0);
});

test("protocol rejects malformed limits, offsets and mismatched result identities", () => {
  const { request, result } = scan("abc abc", "abc");
  for (const value of [
    null,
    [],
    {},
    { ...request, id: NaN },
    { ...request, id: -1 },
    { ...request, epoch: "x".repeat(101) },
    { ...request, text: "x".repeat(SEARCH_LIMIT + 1) },
    { ...request, options: { query: "a", caseSensitive: 1, wholeWord: false } },
    { kind: "navigate", epoch: "x", id: 1, direction: SEARCH_LIMIT + 1 },
    { kind: "navigate", epoch: "x", id: 1, direction: -SEARCH_LIMIT - 1 },
    { kind: "navigate", epoch: "x", id: 1, direction: 0.5 },
    { kind: "viewport", epoch: "x", id: 1, from: 4, to: 3 },
  ]) {
    expect(validSearchRequest(value)).toBe(false);
  }
  for (const value of [
    null,
    {},
    { ...result, epoch: "other" },
    { ...result, id: 999 },
    { ...result, kind: "navigate" },
    { ...result, count: 8 },
    { ...result, index: 2 },
    { ...result, current: [3, 3] },
    { ...result, current: [0, 8] },
    { ...result, ranges: [0] },
    { ...result, ranges: [0, 4, 3, 5] },
    { ...result, limited: "yes" },
    { ...result, ranges: Array(SEARCH_MARK_LIMIT * 2 + 2).fill(0) },
  ]) {
    expect(validSearchResult(value, request, 7)).toBe(false);
  }
});
