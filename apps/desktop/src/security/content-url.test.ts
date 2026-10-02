import { expect, test } from "bun:test";

import { classifyContentURL } from "./content-url";

test("candidate categories grant no navigation or filesystem authority", () => {
  for (const input of ["#标题", "#part%20one"])
    expect(classifyContentURL(input).kind).toBe("anchor");
  for (const input of [
    "../note.md",
    "./中文.markdown",
    "/tmp/not-read",
    "note%20one.md",
  ])
    expect(classifyContentURL(input).kind).toBe("local-candidate");
  for (const input of [
    "https://example.invalid/",
    "HTTP://example.invalid/",
    "mailto:a@example.invalid",
  ])
    expect(classifyContentURL(input).kind).toBe("external-candidate");
});
test("reject controls, obfuscated schemes, ambiguous separators and invalid URLs", () => {
  for (const input of [
    "",
    " https://example.invalid",
    "javascript:alert(1)",
    "data:text/plain,x",
    "blob:abc",
    "file:///tmp/no",
    "views://mainview",
    "//example.invalid",
    "\\\\example.invalid",
    "https://example.invalid/%0a",
    "%256aavascript%253aalert(1)",
    "javascript&colon;alert(1)",
    "https%3a%2f%2fexample.invalid",
    "https://user:password@example.invalid",
    "https://",
    "mailto:",
    "a\u202Eb.md",
    "%00",
    "%GG",
    "%2525252525252f",
  ])
    expect(classifyContentURL(input).kind).toBe("rejected");
});
