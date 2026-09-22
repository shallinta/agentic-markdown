import { expect, test } from "bun:test";

import {
  analyzeTextFidelity,
  isTextFidelity,
  type TextFidelity,
} from "./text-fidelity";

const cases = [
  ["", false, 0, 0, 0, "none", "none", "none"],
  ["\ufeff", true, 0, 0, 0, "none", "none", "none"],
  ["中文😀", false, 0, 0, 0, "none", "none", "none"],
  ["a\ufeffb", false, 0, 0, 0, "none", "none", "none"],
  ["a\n\ufeff", false, 1, 0, 0, "lf", "lf", "none"],
  ["\ufeff中文\n😀\n", true, 2, 0, 0, "lf", "lf", "lf"],
  ["a\r\nb\r\n", false, 0, 2, 0, "crlf", "crlf", "crlf"],
  ["a\n\r\nb", false, 1, 1, 0, "mixed", "tie", "none"],
  ["a\n\r\nb\n", false, 2, 1, 0, "mixed", "lf", "lf"],
  ["a\r\n\nb\r\n", false, 1, 2, 0, "mixed", "crlf", "crlf"],
  ["a\rb\r", false, 0, 0, 2, "none", "none", "cr"],
  ["\r\r\n\n\r", false, 1, 1, 2, "mixed", "tie", "cr"],
] as const;

test.each(cases)(
  "preserves and counts %j",
  (text, bom, lf, crlf, loneCr, newlineStyle, dominantNewline, ending) => {
    const expected: TextFidelity = {
      encoding: "utf-8",
      bom,
      lf,
      crlf,
      loneCr,
      newlineStyle,
      dominantNewline,
      ending,
    };
    expect(analyzeTextFidelity(text)).toEqual(expected);
    expect(isTextFidelity(expected, text)).toBe(true);
  }
);

test("rejects unsafe, inconsistent, missing and text-inaccurate metadata", () => {
  const text = "\ufeffa\n\r\nb\r";
  const valid = analyzeTextFidelity(text);
  for (const value of [
    null,
    [],
    {},
    { ...valid, encoding: "gbk" },
    { ...valid, bom: false },
    { ...valid, lf: -1 },
    { ...valid, lf: NaN },
    { ...valid, lf: Infinity },
    { ...valid, lf: 0.5 },
    { ...valid, crlf: Number.MAX_SAFE_INTEGER + 1 },
    { ...valid, newlineStyle: "lf" },
    { ...valid, dominantNewline: "lf" },
    { ...valid, ending: "none" },
    { ...valid, extra: true },
    analyzeTextFidelity("plain"),
  ]) {
    expect(isTextFidelity(value, text)).toBe(false);
  }
});
