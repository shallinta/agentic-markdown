import { expect, test } from "bun:test";
import { createHash } from "node:crypto";

import { MAX_DOCUMENT_BYTES } from "../../shared/documents";

import {
  captureMainTabBlockAnchor,
  resolveMainTabBlockAnchor,
  resolveMainTabAnchorWorkerEntry,
} from "./main-tab-anchor-worker-client";

test("selects the source or packaged anchor worker without crossing the layout", () => {
  expect(resolveMainTabAnchorWorkerEntry("/repo/apps/desktop/src/bun/session"))
    .toBe("/repo/apps/desktop/src/bun/session/main-tab-anchor-worker.ts");
  expect(resolveMainTabAnchorWorkerEntry("/package/Contents/Resources/app/bun"))
    .toBe("/package/Contents/Resources/app/native/main-tab-anchor-worker.js");
});

test("anchor worker returns the exact block digest or leaves the raw position alone", async () => {
  const raw = "\uFEFF前段 😀\r\n\r\n## 目标\r\n\r\n结尾";
  const viewport = { from: raw.indexOf("##"), offset: -8.5, ratio: 0.5 };
  const captured = await captureMainTabBlockAnchor(raw, viewport);
  expect(captured).toMatchObject({
    ...viewport,
    block: {
      contentHash: createHash("sha256").update(raw).digest("hex"),
      hash: createHash("sha256").update("heading\0## 目标").digest("hex"),
      occurrence: 0,
      uniqueAtCapture: true,
      offset: viewport.offset,
    },
  });
  expect(captured?.block?.before).toMatch(/^[a-f0-9]{64}$/);
  expect(captured?.block?.after).toMatch(/^[a-f0-9]{64}$/);
  expect(await captureMainTabBlockAnchor(raw, { ...viewport, from: raw.length })).toBeUndefined();
  expect(await captureMainTabBlockAnchor("界".repeat(Math.ceil(MAX_DOCUMENT_BYTES / 3)), viewport)).toBeUndefined();
});

test("an aborted anchor worker does not publish and releases the single slot", async () => {
  const abort = new AbortController();
  const viewport = { from: 0, offset: 0, ratio: 0 };
  const result = captureMainTabBlockAnchor("# Heading", viewport, abort.signal);
  expect(await captureMainTabBlockAnchor("# Another heading", viewport)).toBeUndefined();
  abort.abort();
  expect(await result).toBeUndefined();
  expect((await captureMainTabBlockAnchor("# Heading", viewport))?.block).toBeDefined();
});

test("anchor worker projects moved blocks or a unique neighbor to the three viewport fields", async () => {
  const raw = "\uFEFF前段 😀\r\n\r\n## 目标\r\n\r\n后段";
  const viewport = { from: raw.indexOf("##"), offset: -8.5, ratio: 0.5 };
  const position = await captureMainTabBlockAnchor(raw, viewport);
  if (!position?.block) throw Error("expected saved anchor");
  const prefix = "# 前插\r\n\r\n";
  const prefixed = raw[0] + prefix + raw.slice(1);
  expect(await resolveMainTabBlockAnchor(prefixed, position)).toEqual({
    ...viewport,
    from: viewport.from + prefix.length,
  });
  const removed = prefixed.replace("## 目标\r\n\r\n", "");
  expect(await resolveMainTabBlockAnchor(removed, position)).toEqual({
    from: removed.indexOf("后段"),
    offset: 0,
    ratio: viewport.ratio,
  });
  expect(await resolveMainTabBlockAnchor("## 目标\n\n## 目标", position)).toBeUndefined();
  expect(await resolveMainTabBlockAnchor("短", position)).toBeUndefined();
});
