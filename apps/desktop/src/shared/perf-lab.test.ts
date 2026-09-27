import { expect, test } from "bun:test";

import {
  measureApplicationJson,
  syntheticDigest,
  validDownload,
} from "./perf-lab";

test("application JSON probe measures UTF-8 escaped object, not transport envelope", () => {
  const value = { text: '\uFEFF中文\r\n"\\🙂' };
  expect(value.text.charCodeAt(0)).toBe(0xfeff);
  expect(value.text.includes(String.fromCharCode(13, 10))).toBe(true);
  const result = measureApplicationJson(value);
  expect(result.bytes).toBe(Buffer.byteLength(JSON.stringify(value), "utf8"));
  expect(result.bytes).toBeGreaterThan(Buffer.byteLength(value.text, "utf8"));
  expect(Number.isFinite(result.stringifyMs) && result.stringifyMs >= 0).toBe(
    true
  );
  expect(Number.isFinite(result.encodeMs) && result.encodeMs >= 0).toBe(true);
});

test("download validation rejects corruption, wrong identity, sequence and size", () => {
  const text = "\uFEFF中文\r\ntext",
    bytes = Buffer.byteLength(text, "utf8");
  const response = {
    ok: true,
    runId: "run",
    sequence: 0,
    text,
    bytes,
    digest: syntheticDigest(text),
  };
  expect(validDownload(response, text, bytes, "run", 0)).toBe(true);
  for (const update of [
    { text: text + "!" },
    { text: undefined },
    { bytes: bytes + 1 },
    { digest: "bad" },
    { ok: false },
    { runId: "other" },
    { sequence: 1 },
  ])
    expect(
      validDownload({ ...response, ...update }, text, bytes, "run", 0)
    ).toBe(false);
});
