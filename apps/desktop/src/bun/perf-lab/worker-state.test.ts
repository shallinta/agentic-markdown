import { describe, expect, test } from "bun:test";

import {
  PERF_SIZES,
  syntheticDigest,
  syntheticText,
} from "../../shared/perf-lab";

import { createPerfWorkerState } from "./worker-state";

describe("isolated performance worker state", () => {
  test("synthetic samples have exact decimal bytes, BOM and Chinese text", () => {
    for (const bytes of PERF_SIZES) {
      for (const shape of ["lines", "long-line"] as const) {
        const text = syntheticText(bytes, shape);
        expect(Buffer.byteLength(text, "utf8")).toBe(bytes);
        expect(text.startsWith("\uFEFF中文")).toBe(true);
        expect(text.includes("\r\n")).toBe(shape === "lines");
      }
    }
  });

  test("accepts a controlled 1 MB baseline through the actual worker API", () => {
    const text = syntheticText(PERF_SIZES[0], "lines");
    const state = createPerfWorkerState(PERF_SIZES[0]);
    const result = state.run({ op: "text", text, final: true });
    expect(result.bytes).toBe(1_000_000);
    expect(result.digest).toBe(syntheticDigest(text));
    expect(result.version).toBe(1);
    expect(result.ownedTextUnits).toBe(text.length);
    expect(result.workerMs).toBeGreaterThanOrEqual(0);
  });

  test("joins chunks in received order and finalizes only the complete baseline", () => {
    const parts = ["\uFEFF中文\r\n", "second\n", "tail\r末尾"];
    const text = parts.join("");
    const state = createPerfWorkerState(Buffer.byteLength(text));
    const first = state.run({ op: "text", text: parts[0], final: false });
    expect(first.version).toBe(0);
    expect(first.digest).toBe("");
    expect(first.ownedTextUnits).toBe(parts[0].length);
    state.run({ op: "text", text: parts[1], final: false });
    const last = state.run({ op: "text", text: parts[2], final: true });
    expect(last.digest).toBe(syntheticDigest(text));
    expect(last.bytes).toBe(Buffer.byteLength(text));
    expect(last.ownedTextUnits).toBe(text.length);
    expect(last.version).toBe(1);
    expect(() => state.run({ op: "text", text: "!", final: true })).toThrow(
      "INVALID"
    );
  });

  test("rejects incomplete final chunks, empty chunks and byte overflow", () => {
    expect(() =>
      createPerfWorkerState(4).run({ op: "text", text: "abc", final: true })
    ).toThrow("INVALID");
    expect(() =>
      createPerfWorkerState(4).run({ op: "text", text: "", final: false })
    ).toThrow("INVALID");
    const state = createPerfWorkerState(4);
    state.run({ op: "text", text: "ab", final: false });
    expect(() => state.run({ op: "text", text: "中文", final: true })).toThrow(
      "INVALID"
    );
    expect(state.run({ op: "text", text: "cd", final: true }).digest).toBe(
      syntheticDigest("abcd")
    );
  });

  test("patches preserve raw BOM and mixed line endings with versioned results", () => {
    const text = "\uFEFF中文\r\nsecond\nlast\r末尾";
    const state = createPerfWorkerState(Buffer.byteLength(text));
    const baseline = state.run({ op: "text", text, final: true });
    const from = text.indexOf("second");
    const updated =
      text.slice(0, from) + "新行\n中文\r\n" + text.slice(from + 6);
    const result = state.run({
      op: "patch",
      baseline: baseline.digest,
      version: 1,
      from,
      to: from + 6,
      insert: "新行\n中文\r\n",
    });
    expect(result.digest).toBe(syntheticDigest(updated));
    expect(result.bytes).toBe(Buffer.byteLength(updated));
    expect(result.ownedTextUnits).toBe(updated.length);
    expect(result.version).toBe(2);
  });

  test("rejects invalid patch baselines, versions and ranges without mutation", () => {
    const text = "\uFEFF中文\r\nline\n";
    const state = createPerfWorkerState(Buffer.byteLength(text));
    const digest = syntheticDigest(text);
    const patch = {
      op: "patch" as const,
      baseline: digest,
      version: 1,
      from: 1,
      to: 3,
      insert: "替换",
    };
    expect(() => state.run(patch)).toThrow("INVALID");
    state.run({ op: "text", text, final: true });
    for (const invalid of [
      { baseline: "00000000" },
      { version: 0 },
      { version: 2 },
      { from: -1 },
      { from: 0.5 },
      { from: Number.NaN },
      { to: 0 },
      { to: text.length + 1 },
      { to: Number.POSITIVE_INFINITY },
      { insert: "x".repeat(1025) },
    ]) {
      expect(() => state.run({ ...patch, ...invalid })).toThrow("INVALID");
    }
    const result = state.run(patch);
    expect(result.version).toBe(2);
    expect(result.digest).toBe(syntheticDigest("\uFEFF替换\r\nline\n"));
    expect(() => state.run(patch)).toThrow("INVALID");
  });

  test("binary decoding retains BOM and rejects invalid UTF-8 or size", () => {
    const text = "\uFEFF中文\r\n尾\n";
    const bytes = new TextEncoder().encode(text);
    const state = createPerfWorkerState(bytes.byteLength);
    const result = state.run({ op: "binary", buffer: bytes.buffer });
    expect(result.digest).toBe(syntheticDigest(text));
    expect(result.bytes).toBe(bytes.byteLength);
    expect(result.ownedTextUnits).toBe(text.length);
    expect(result.version).toBe(1);
    expect(() => state.run({ op: "binary", buffer: bytes.buffer })).toThrow(
      "INVALID"
    );
    expect(() =>
      createPerfWorkerState(1).run({ op: "binary", buffer: bytes.buffer })
    ).toThrow("INVALID");
    expect(() =>
      createPerfWorkerState(1).run({
        op: "binary",
        buffer: Uint8Array.of(0xff).buffer,
      })
    ).toThrow();
  });
});
