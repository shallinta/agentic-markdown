import { expect, test } from "bun:test";

import {
  createReadingHighlights,
  readingHighlightRanges,
} from "./reading-search-highlight";
import type { SearchResult } from "./source-search-protocol";

test("non-current match mapping failure is not silently omitted", () => {
  const result: SearchResult = {
    epoch: "1",
    id: 1,
    kind: "viewport",
    count: 2,
    index: 0,
    current: [0, 1],
    ranges: [0, 1, 4, 5],
    limited: false,
  };
  const range = {} as Range;
  expect(() =>
    readingHighlightRanges(result, (from) => (from === 0 ? range : null))
  ).toThrow("映射已失效");
  expect(
    readingHighlightRanges({ ...result, current: null, ranges: [] }, () => null)
  ).toEqual({ selected: null, ranges: [] });
});

test("highlight cleanup removes only this owner's entries and stylesheet", () => {
  const entries = new Map<string, object>(),
    styles: { textContent: string; remove(): void }[] = [];
  let removed = 0;
  const document = {
    defaultView: {
      CSS: { highlights: entries },
      Highlight: class {
        constructor(public ranges: Range[]) {}
      },
    },
    createElement: () => ({
      textContent: "",
      remove: () => {
        removed++;
      },
    }),
    head: { append: (style: (typeof styles)[number]) => styles.push(style) },
  } as unknown as Document;
  const first = createReadingHighlights(document),
    second = createReadingHighlights(document);
  first.paint([], null);
  second.paint([], null);
  expect(entries.size).toBe(2);
  const key = [...entries.keys()][0];
  const replacement = {};
  entries.set(key, replacement);
  first.dispose();
  expect(entries.get(key)).toBe(replacement);
  expect(entries.size).toBe(2);
  second.dispose();
  expect(entries.size).toBe(1);
  expect(removed).toBe(2);
  expect(styles).toHaveLength(2);
});

test("unavailable public Highlight API fails explicitly", () => {
  expect(() =>
    createReadingHighlights({ defaultView: {} } as unknown as Document)
  ).toThrow("不支持");
});
