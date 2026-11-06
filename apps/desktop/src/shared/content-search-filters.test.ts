import { expect, test } from "bun:test";

import { validContentSearchRequest } from "./content-search";
import {
  CONTENT_SEARCH_FILTER_TEXT_LIMIT,
  formatContentSearchFilter,
  matchesContentSearchFileFilters,
  matchesContentSearchPathFilters,
  parseContentSearchFilters,
  relativeContentSearchPath,
  validContentSearchFileFilters,
  validContentSearchPathFilters,
} from "./content-search-filters";

test("parses exact file values without altering case, spacing or Unicode", () => {
  expect(parseContentSearchFilters("")).toEqual({ ok: true, fileFilters: [], pathFilters: [] });
  expect(parseContentSearchFilters("   ")).toEqual({ ok: true, fileFilters: [], pathFilters: [] });
  expect(
    parseContentSearchFilters('  file:笔记   file:"会议 纪要" file:AbC  ')
  ).toEqual({ ok: true, fileFilters: ["笔记", "会议 纪要", "AbC"], pathFilters: [] });
  expect(parseContentSearchFilters('file:" "')).toEqual({
    ok: true, fileFilters: [" "], pathFilters: [],
  });
  expect(parseContentSearchFilters("file:a\tfile:b")).toEqual({
    ok: true, fileFilters: ["a", "b"], pathFilters: [],
  });
  for (const name of ['他说 "你好" 📝.md', "name:part.md", "a\\b.md", "  spaces  "]) {
    expect(parseContentSearchFilters(formatContentSearchFilter("file", name)))
      .toEqual({ ok: true, fileFilters: [name], pathFilters: [] });
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
    expect(parseContentSearchFilters(raw)).toEqual({ ok: false, error: "invalid" });
  }
  for (const raw of ["root:notes", "-file:notes", "File:notes", "file:a notes"]) {
    expect(parseContentSearchFilters(raw)).toEqual({
      ok: false, error: "unsupported",
    });
  }
});

test("bounds filters by count and decoded UTF-16 code units", () => {
  const values = Array.from({ length: 8 }, (_, index) => String(index));
  const raw = values.map((value) => formatContentSearchFilter("file", value)).join(" ");
  expect(parseContentSearchFilters(raw)).toEqual({ ok: true, fileFilters: values, pathFilters: [] });
  expect(parseContentSearchFilters(raw + " path:ninth")).toEqual({
    ok: false, error: "limit",
  });
  const max = "😀".repeat(128);
  expect(parseContentSearchFilters(formatContentSearchFilter("file", max)))
    .toEqual({ ok: true, fileFilters: [max], pathFilters: [] });
  expect(parseContentSearchFilters(formatContentSearchFilter("file", max + "A")))
    .toEqual({ ok: false, error: "limit" });
  expect(parseContentSearchFilters('file:"' + "\\u0061".repeat(256) + '"'))
    .toEqual({ ok: true, fileFilters: ["a".repeat(256)], pathFilters: [] });
  expect(parseContentSearchFilters(" ".repeat(CONTENT_SEARCH_FILTER_TEXT_LIMIT + 1)))
    .toEqual({ ok: false, error: "limit" });
});

test("parses and matches mixed relative paths without interpreting them as authority", () => {
  const result = parseContentSearchFilters('path:"项目 甲/" -path:草稿 file:纪要 path:纪要');
  expect(result).toEqual({
    ok: true,
    fileFilters: ["纪要"],
    pathFilters: [
      { kind: "path", value: "项目 甲/" },
      { kind: "-path", value: "草稿" },
      { kind: "path", value: "纪要" },
    ],
  });
  if (!result.ok) throw Error("Invalid test filters");
  expect(matchesContentSearchPathFilters("项目 甲/纪要.md", result.pathFilters)).toBe(true);
  expect(matchesContentSearchPathFilters("项目 甲/草稿/纪要.md", result.pathFilters)).toBe(false);
  expect(matchesContentSearchPathFilters("项目 甲1/纪要.md", result.pathFilters)).toBe(false);
  expect(matchesContentSearchPathFilters("项目 甲/报告.md", result.pathFilters)).toBe(false);
  expect(matchesContentSearchPathFilters("ANY/Case.md", [{ kind: "path", value: "case" }]))
    .toBe(false);
  expect(matchesContentSearchPathFilters("ANY/Case.md", [])).toBe(true);
  const path = 'a\\b/他说 "你好" 📝.md';
  expect(parseContentSearchFilters(formatContentSearchFilter("-path", path))).toEqual({
    ok: true, fileFilters: [], pathFilters: [{ kind: "-path", value: path }],
  });
  expect(parseContentSearchFilters("path:a -path:a")).toMatchObject({ ok: true });
});

test("rejects absolute paths, empty or traversal segments and same-kind duplicates", () => {
  for (const value of [
    "", "/a", "/", "a//b", "a//", "./a", "a/./b", "a/..", "..",
    "a/../b", "C:/x", "c:\\x", "\\\\server\\share", "a/\t", "\udc00",
  ]) {
    expect(parseContentSearchFilters(formatContentSearchFilter("path", value)))
      .toEqual({ ok: false, error: "invalid" });
  }
  for (const raw of ["path:a path:a", "-path:a -path:a", "path:", '-path:"not closed']) {
    expect(parseContentSearchFilters(raw)).toEqual({ ok: false, error: "invalid" });
  }
});

test("projects the exact canonical path below the slash boundary", () => {
  expect(relativeContentSearchPath("/", "/a/note.md")).toBe("a/note.md");
  expect(relativeContentSearchPath("/a", "/a/项目 甲/纪要.md")).toBe("项目 甲/纪要.md");
  const long = "a".repeat(255) + "/" + "b".repeat(255) + ".md";
  expect(relativeContentSearchPath("/a", "/a/" + long)).toBe(long);
  expect(relativeContentSearchPath("/a", "/a/odd\tname.md")).toBe("odd\tname.md");
  for (const [root, file] of [
    ["/a", "/abc/note.md"], ["/a", "/a"], ["/a", "/a/"],
    ["/a", "/a/../x"], ["/a", "/a/./x"], ["/a", "/a//x"],
    ["/a/", "/a/note.md"], ["a", "a/note.md"], ["//a", "//a/note.md"],
  ]) {
    expect(relativeContentSearchPath(root, file)).toBeUndefined();
  }
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
  const path = { kind: "path", value: "目录/" };
  expect(validContentSearchRequest({ ...query, pathFilters: [path] })).toBe(true);
  expect(validContentSearchRequest({
    ...query, fileFilters: ["a"], pathFilters: [path, { ...path, kind: "-path" }],
  })).toBe(true);
  expect(validContentSearchRequest({
    ...query, fileFilters: Array.from({ length: 8 }, (_, i) => String(i)),
    pathFilters: [path],
  })).toBe(false);
  const sparsePaths = [path];
  sparsePaths.length = 2;
  for (const pathFilters of [
    undefined, null, [], sparsePaths, [path, path], [path.value],
    [{ ...path, kind: "file" }], [{ ...path, value: "/abs" }],
    [{ ...path, path: "extra" }], Object.assign([path], { extra: true }),
  ]) {
    expect(validContentSearchPathFilters(pathFilters)).toBe(false);
    expect(validContentSearchRequest({ ...query, pathFilters })).toBe(false);
  }
});
