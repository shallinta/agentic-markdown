import { expect, test } from "bun:test";

import { syntaxTreeAvailable } from "@codemirror/language";

import { headingStructureSteps } from "./heading-structure";
import { createRawEditorState } from "./raw-buffer";

function structure(raw: string) {
  const state = createRawEditorState(raw);
  const task = headingStructureSteps(state);
  let next = task.next(),
    yields = 0;
  while (!next.done) {
    yields++;
    next = task.next();
  }
  return { state, result: next.value, yields };
}
test("ATX chapters retain the next equal/higher heading and nest lower headings", () => {
  const raw = "# A\nbody\n## B\nb\n### C\nc\n## D\nd\n# E\ne";
  const { result } = structure(raw);
  expect(
    result.sections.map((s) => [s.level, s.heading, s.from, s.to])
  ).toEqual([
    [1, 0, 3, 30],
    [2, 9, 13, 23],
    [3, 16, 21, 23],
    [2, 24, 28, 30],
    [1, 31, 34, 36],
  ]);
});
test("all six heading levels have bounded independent sections", () => {
  const { result } = structure(
    Array.from(
      { length: 6 },
      (_, i) => `${"#".repeat(i + 1)} title\nbody`
    ).join("\n")
  );
  expect(result.sections.map((s) => s.level)).toEqual([1, 2, 3, 4, 5, 6]);
});
test("quote/list boundaries preserve full prefix and Setext title underline", () => {
  for (const [raw, visible] of [
    ["> # A\n> body\n> # B\n> tail", "> # A\n> # B\n> tail"],
    ["- # A\n  body\n- # B\n  tail", "- # A\n- # B\n  tail"],
    ["A\nsecond\n===\nbody\n# B\ntail", "A\nsecond\n===\n# B\ntail"],
  ]) {
    const { result } = structure(raw),
      first = result.sections[0];
    expect(raw.slice(0, first.from) + raw.slice(first.to)).toBe(visible);
  }
});
test("blank gaps and container markers do not create fold entries; child headings do", () => {
  for (const raw of [
    "# A\n# B",
    "# A\n\n# B",
    "# A\n\n",
    "> # A\n>\n> # B",
    "- # A\n\n- # B",
  ])
    expect(structure(raw).result.sections).toEqual([]);
  expect(structure("# A\n## B").result.sections).toHaveLength(1);
});
test("nested containers cannot terminate an outer chapter", () => {
  const raw =
    "# root\n> # quote\n> - ## list\n>   content\n> # sibling\n> last\n\n## next\nend";
  const { result } = structure(raw);
  expect(result.sections.map((s) => s.heading)).toEqual([0, 9, 21, 43, 61]);
  expect(result.sections[0].to).toBe(raw.length);
  expect(result.sections[1].to).toBe(raw.indexOf("> # sibling") - 1);
  expect(result.sections[2].to).toBeLessThan(raw.indexOf("> # sibling"));
});
test("fence/HTML fake headings are ignored and CM BOM/EOL offsets retained", () => {
  const { result } = structure(
    "\uFEFF# real\r\n```md\r\n# fake\r\n```\r\n\r\n<div>\r\n# fake\r\n</div>\r\n\r\n# last\r\nend"
  );
  expect(result.sections).toHaveLength(2);
  expect(result.sections[0].heading).toBe(1);
  expect(result.doc.toString()).not.toContain("\r");
  expect(result.sections[1].heading).toBe(
    result.doc.toString().indexOf("# last")
  );
});
test("actual partial state only publishes a chapter closed by a complete next title", () => {
  for (const nextTitle of ["# B", "B\n==="]) {
    const raw =
      "# A\nbody\n\n" +
      nextTitle +
      "\n\n" +
      "paragraph text\n\n".repeat(3000) +
      "# last\nend";
    const { state, result } = structure(raw);
    expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
    expect(syntaxTreeAvailable(state, 10 + nextTitle.length)).toBe(true);
    expect(result.sections.map((s) => s.heading)).toEqual([0]);
  }
});
test("block projection yields and avoids traversing inline tokens", () => {
  const { result, yields } = structure(
    "# A\n" + "*em* ".repeat(100) + "\n# B\nend"
  );
  expect(result.sections).toHaveLength(2);
  expect(yields).toBe(0);
  const many = structure("# title\nbody\n".repeat(150));
  expect(many.yields).toBeGreaterThan(1);
});
