import { expect, test } from "bun:test";

import {
  jsonUtf8Bytes,
  probeTransportEnvelope,
} from "./probe-transport-envelope";

test("JSON UTF-8 counts bytes rather than UTF-16 units", () => {
  expect(jsonUtf8Bytes("中文")).toBe(8);
  expect(jsonUtf8Bytes("🙂📄")).toBe(10);
  expect(() => jsonUtf8Bytes(undefined)).toThrow("UNSERIALIZABLE_SAMPLE");
});

test("real SDK envelopes preserve Unicode text but not binary types through JSON", async () => {
  const result = await probeTransportEnvelope();
  expect(result.sdkVersion).toBe("2.0.1");
  expect(result.rows).toHaveLength(5);
  for (const row of result.rows) {
    expect(row.matchingRequestResponseId).toBe(true);
    expect(row.sdkRequestJsonUtf8Bytes).toBeGreaterThan(
      row.applicationJsonUtf8Bytes
    );
    expect(row.sdkResponseJsonUtf8Bytes).toBeGreaterThan(
      row.receivedJsonUtf8Bytes
    );
    if (row.textPreserved !== null) expect(row.textPreserved).toBe(true);
    if (row.binaryTypePreserved !== null)
      expect(row.binaryTypePreserved).toBe(false);
  }
  expect(
    result.rows.find((row) => row.sample === "array-buffer")
      ?.receivedJsonUtf8Bytes
  ).toBe(2);
  expect(
    result.rows.find((row) => row.sample === "typed-array")
      ?.receivedJsonUtf8Bytes
  ).toBe(21);
});

test("report cannot mistake the isolated probe for native or single-direction measurement", async () => {
  const first = await probeTransportEnvelope();
  const second = await probeTransportEnvelope();
  expect(first).toEqual(second);
  expect(first.scope).toBe("sdk-envelope-json-in-memory-only");
  expect(first.runtimeTransportObserved).toBe(false);
  expect(first.wireBytes).toBeNull();
  expect(first.oneWayMs).toBeNull();
  expect(first.nativeCopyCount).toBeNull();
  const report = JSON.stringify(first);
  for (const body of [
    "中文",
    "Ω漢字",
    "🙂📄",
    "payload",
    "secret",
    "encryptedData",
  ])
    expect(report).not.toContain(body);
});
