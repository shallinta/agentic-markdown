import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import type { QuickResult } from "../client/quick-open";

import { QuickOpenResults, quickNavigation, quickVisibleRows } from "./quick-open-dialog";

test("virtual rows remain bounded at start, middle and end with active descendant mounted", () => {
  for (const scroll of [0, 32000, 639680]) {
    const rows = quickVisibleRows(10000, scroll, 9999);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows).toContain(9999);
    expect(new Set(rows).size).toBe(rows.length);
    expect(rows.every(row => row >= 0 && row < 10000)).toBe(true);
  }
  expect(quickVisibleRows(0, 0, 0)).toEqual([]);
});

test("keyboard navigation clamps and composition never selects or confirms", () => {
  expect(quickNavigation("Home", 4, 10, false)).toBe(0);
  expect(quickNavigation("End", 0, 10, false)).toBe(9);
  expect(quickNavigation("ArrowDown", 9, 10, false)).toBe(9);
  expect(quickNavigation("ArrowUp", 0, 10, false)).toBe(0);
  expect(quickNavigation("Enter", 1, 10, false)).toBe("choose");
  for (const key of ["Enter", "Home", "End", "ArrowDown", "ArrowUp", "Escape"]) expect(quickNavigation(key, 1, 10, true)).toBeUndefined();
  expect(quickNavigation("Enter", 0, 0, false)).toBeUndefined();
});

test("SSR rows expose unique identity, Chinese root/path and finite active option, escape file markup", () => {
  const results: QuickResult[] = Array.from({ length: 1000 }, (_, index) => ({
    key: `key-${index}`, name: "<文档>.md", path: `/甲目录/${index}/同名.md`, rootName: "甲目录", score: [], order: index,
    target: { root: "root", generation: 1, entry: `entry-${index}` },
  }));
  const html = renderToStaticMarkup(<QuickOpenResults results={results} active={999} scrollTop={0} id="quick" choose={() => undefined} />);
  expect(html.match(/role="option"/g)?.length).toBe(9);
  expect(html).toContain('id="quick-999"');
  expect(html).toContain('aria-selected="true"');
  expect(html).toContain('aria-setsize="1000"');
  expect(html).toContain("甲目录 · /甲目录/999/同名.md");
  expect(html).toContain("&lt;文档&gt;.md");
  expect(html).not.toContain("<文档>");
  expect(html).toContain("bg-accent text-accent-foreground");
});
