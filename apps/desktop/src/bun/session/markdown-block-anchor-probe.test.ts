import { expect, test } from "bun:test";

import { MAX_DOCUMENT_BYTES } from "../../shared/documents";

import { createMarkdownBlockAnchorProbe } from "./markdown-block-anchor-probe";

function ready(raw: string) {
  const result = createMarkdownBlockAnchorProbe(raw);
  if (result.status !== "ready") throw new Error(result.status);
  return result;
}

test("fixed independent SHA-256 vector and half-open block boundaries", () => {
  const probe = ready("Hello");
  const anchor = probe.capture(0, -12.5)!;
  expect(anchor.contentHash).toBe(
    "185f8db32271fe25f561a6fc938b2e264306ec304eda518007d1764826381969"
  );
  expect(anchor.position.anchor.hash).toBe(
    "fe8c381ba202daceee78450ed80f935ab587dcd69290d29640cf2099ca9840d0"
  );
  expect(probe.capture(4, -12.5)).toEqual(anchor);
  expect(probe.resolve(anchor)).toEqual({
    status: "matched",
    from: 0,
    to: 5,
    offset: -12.5,
  });
  for (const pos of [-1, 0.5, 5, Infinity, NaN])
    expect(probe.capture(pos, 0)).toBeUndefined();
  for (const offset of [-0, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(probe.capture(0, offset)).toBeUndefined();
});

test("BOM, CRLF and emoji use exact raw UTF-16 ranges; definitions and gaps are absent", () => {
  const raw = "\uFEFF# 标题\r\n\r\n😀正文\r\n\r\n[ref]: ./file.md\r\n\r\n末尾";
  const probe = ready(raw);
  expect(probe.blockCount).toBe(3);
  const from = raw.indexOf("😀");
  expect(probe.resolve(probe.capture(from + 1, 3.25))).toEqual({
    status: "matched",
    from,
    to: from + "😀正文".length,
    offset: 3.25,
  });
  for (const pos of [0, raw.indexOf("\r\n"), raw.indexOf("[ref]"), raw.length])
    expect(probe.capture(pos, 0)).toBeUndefined();
  const lf = ready(raw.replaceAll("\r\n", "\n"));
  expect(lf.resolve(probe.capture(from, 0)).status).toBe("matched");
  const quote = ready("> a\r\n> b");
  expect(ready("> a\n> b").resolve(quote.capture(0, 0)).status).toBe("missing");
});

test("nested headings remain part of their top-level container", () => {
  const raw = "> # quote\n> text\n\n- item\n  - nested\n\n```md\n# fake\n```";
  const probe = ready(raw);
  expect(probe.blockCount).toBe(3);
  expect(probe.capture(raw.indexOf("text"), 0)).toEqual(probe.capture(0, 0));
  expect(probe.capture(raw.indexOf("nested"), 0)).toEqual(
    probe.capture(raw.indexOf("- item"), 0)
  );
  expect(probe.capture(raw.indexOf("# fake"), 0)).toEqual(
    probe.capture(raw.indexOf("```"), 0)
  );
});

test("unchanged duplicate occurrences resolve; changed documents require unique identity", () => {
  const probe = ready("same\n\nsame");
  const first = probe.capture(0, 1)!;
  const second = probe.capture(6, 2)!;
  expect(first.position.anchor.occurrence).toBe(0);
  expect(second.position.anchor.occurrence).toBe(1);
  expect(probe.resolve(second)).toEqual({
    status: "matched",
    from: 6,
    to: 10,
    offset: 2,
  });
  expect(ready("prefix\n\nsame\n\nsame").resolve(first)).toEqual({
    status: "ambiguous",
  });
  expect(first.uniqueAtCapture).toBe(false);
  expect(second.uniqueAtCapture).toBe(false);
  for (const anchor of [first, second]) {
    expect(ready("same").resolve(anchor)).toEqual({ status: "ambiguous" });
    expect(ready("prefix\n\nsame").resolve(anchor)).toEqual({
      status: "ambiguous",
    });
  }
  const unique = ready("same").capture(0, 0)!;
  expect(unique.uniqueAtCapture).toBe(true);
  expect(probe.resolve(unique)).toEqual({ status: "ambiguous" });
  expect(ready("different").resolve(second)).toEqual({ status: "missing" });
});

test("prefix insertion relocates unique block without source-position fallback", () => {
  const anchor = ready("target\n\nother").capture(2, 7)!;
  expect(ready("intro\n\ntarget\n\nother").resolve(anchor)).toEqual({
    status: "matched",
    from: 7,
    to: 13,
    offset: 7,
  });
  expect(ready("edited\n\nother").resolve(anchor)).toEqual({
    status: "missing",
  });
  expect(ready("").resolve(anchor)).toEqual({ status: "missing" });
});

test("malformed receipts and non-lossless text fail closed", () => {
  const probe = ready("a");
  const anchor = probe.capture(0, 0)!;
  for (const value of [
    null,
    [],
    {},
    { ...anchor, extra: true },
    { ...anchor, contentHash: "x" },
    { ...anchor, uniqueAtCapture: 1 },
    {
      ...anchor,
      uniqueAtCapture: true,
      position: {
        ...anchor.position,
        anchor: { ...anchor.position.anchor, occurrence: 1 },
      },
    },
    { ...anchor, position: { ...anchor.position, version: 2 } },
  ])
    expect(probe.resolve(value)).toEqual({ status: "invalid" });
  expect(createMarkdownBlockAnchorProbe("\ud800").status).toBe("invalid");
  expect(ready("\n\n").blockCount).toBe(0);
});

test("raw UTF-8 byte cap includes exact 1 MiB and rejects one byte over", () => {
  const probe = ready("x".repeat(MAX_DOCUMENT_BYTES));
  expect(probe.byteLength).toBe(MAX_DOCUMENT_BYTES);
  expect(probe.blockCount).toBe(1);
  expect(probe.resolve(probe.capture(MAX_DOCUMENT_BYTES - 1, 0))).toEqual({
    status: "matched",
    from: 0,
    to: MAX_DOCUMENT_BYTES,
    offset: 0,
  });
  expect(
    createMarkdownBlockAnchorProbe("x".repeat(MAX_DOCUMENT_BYTES + 1)).status
  ).toBe("too-large");
  expect(
    createMarkdownBlockAnchorProbe("😀".repeat(MAX_DOCUMENT_BYTES / 4) + "x")
      .status
  ).toBe("too-large");
});

test("dense actual parser index resolves first, middle and last without partial output", () => {
  const raw = Array.from({ length: 4096 }, (_, index) => `block ${index}`).join(
    "\n\n"
  );
  const probe = ready(raw);
  expect(probe.blockCount).toBe(4096);
  for (const index of [0, 2048, 4095]) {
    const text = `block ${index}`;
    const from = raw.indexOf(text);
    expect(probe.resolve(probe.capture(from, index / 2))).toEqual({
      status: "matched",
      from,
      to: from + text.length,
      offset: index / 2,
    });
  }
});
