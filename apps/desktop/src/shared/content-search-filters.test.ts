import { expect, test } from "bun:test";

import { validContentSearchRequest } from "./content-search";
import {
  CONTENT_SEARCH_FILTER_TEXT_LIMIT,
  formatContentSearchFileFilter,
  matchesContentSearchFileFilters,
  parseContentSearchFileFilters,
  validContentSearchFileFilters,
} from "./content-search-filters";

test("parses exact file values without altering case, spacing or Unicode", () => {
  expect(parseContentSearchFileFilters("")).toEqual({ ok: true, values: [] });
  expect(parseContentSearchFileFilters("   ")).toEqual({ ok: true, values: [] });
  expect(
    parseContentSearchFileFilters('  file:笔记   file:"会议 纪要" file:AbC  ')
  ).toEqual({ ok: true, values: ["笔记", "会议 纪要", "AbC"] });
  expect(parseContentSearchFileFilters('file:" "')).toEqual({
    ok: true, values: [" "],
  });
  expect(parseContentSearchFileFilters("file:a\tfile:b")).toEqual({
    ok: true, values: ["a", "b"],
  });
  for (const name of ['他说 "你好" 📝.md', "name:part.md", "a\\b.md", "  spaces  "]) {
    expect(parseContentSearchFileFilters(formatContentSearchFileFilter(name)))
      .toEqual({ ok: true, values: [name] });
  }
});

test("matching is case-sensitive AND against only the filename provided", () => {
  expect(matchesContentSearchFileFilters("AbC 会议 纪要.md", [])).toBe(true);
  expect(matchesContentSearchFileFilters("AbC 会议 纪要.md", ["AbC", "会议 纪要"]))
    .toBe(true);
  expect(matchesContentSearchFileFilters("AbC 会议 纪要.md", ["abc"]))
    .toBe(false);
  expect(matchesContentSearchFileFilters("会议 纪要.md", ["纪要", "父目录"]))
    .toBe(false);
});

test("distinguishes malformed file syntax from unsupported token forms", () => {
  for (const raw of [
    "file:", 'file:""', 'file:"not closed', 'file:a"b', 'file:"a"file:b',
    'file:"\\q"', 'file:a file:"a"', 'file:a/b', 'file:"a\\/b"',
    'file:"\\ud800"', 'file:"\\t"', 'file:"a\tb"', "file:\u0000",
  ]) {
    expect(parseContentSearchFileFilters(raw)).toEqual({ ok: false, error: "invalid" });
  }
  for (const raw of ["path:notes", "-file:notes", "File:notes", "file:a notes"]) {
    expect(parseContentSearchFileFilters(raw)).toEqual({
      ok: false, error: "unsupported",
    });
  }
});

test("bounds filters by count and decoded UTF-16 code units", () => {
  const values = Array.from({ length: 8 }, (_, index) => String(index));
  const raw = values.map((value) => formatContentSearchFileFilter(value)).join(" ");
  expect(parseContentSearchFileFilters(raw)).toEqual({ ok: true, values });
  expect(parseContentSearchFileFilters(raw + " file:9")).toEqual({
    ok: false, error: "limit",
  });
  const max = "😀".repeat(128);
  expect(parseContentSearchFileFilters(formatContentSearchFileFilter(max)))
    .toEqual({ ok: true, values: [max] });
  expect(parseContentSearchFileFilters(formatContentSearchFileFilter(max + "A")))
    .toEqual({ ok: false, error: "limit" });
  expect(parseContentSearchFileFilters('file:"' + "\\u0061".repeat(256) + '"'))
    .toEqual({ ok: true, values: ["a".repeat(256)] });
  expect(parseContentSearchFileFilters(" ".repeat(CONTENT_SEARCH_FILTER_TEXT_LIMIT + 1)))
    .toEqual({ ok: false, error: "limit" });
});

test("query wire accepts omitted or dense valid file filters and rejects extra fields", () => {
  const query = {
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    op: "query",
    root: crypto.randomUUID(),
    generation: 1,
    query: "文",
    handles: [],
  };
  expect(validContentSearchRequest(query)).toBe(true);
  expect(validContentSearchRequest({ ...query, fileFilters: ["A", "a", "中 📝", "a\\b"] }))
    .toBe(true);
  const sparse: string[] = [];
  sparse.length = 1;
  for (const fileFilters of [
    undefined, null, [], [""], [12], ["a", "a"], ["a/b"],
    ["a\u0080"], ["\udc00"], ["a".repeat(257)], sparse,
    Array.from({ length: 9 }, (_, index) => String(index)),
    Object.assign(["a"], { extra: true }),
  ]) {
    expect(validContentSearchFileFilters(fileFilters)).toBe(false);
    expect(validContentSearchRequest({ ...query, fileFilters })).toBe(false);
  }
  expect(validContentSearchRequest({ ...query, fileFilters: ["a"], path: "x" }))
    .toBe(false);
  expect(validContentSearchRequest({
    protocolVersion: 1,
    requestId: crypto.randomUUID(),
    op: "cancel",
    targetRequestId: query.requestId,
    fileFilters: ["a"],
  })).toBe(false);
});
