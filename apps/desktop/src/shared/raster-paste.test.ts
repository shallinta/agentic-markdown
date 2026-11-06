import { expect, test } from "bun:test";

import {
  parseRasterPasteRequest,
  parseRasterPasteResponse,
  RASTER_PASTE_MAX_BYTES,
} from "./raster-paste";

const requestId = "9da7bf90-8f5e-4fd1-9ae6-fb5915e669ec";
const request = {
  protocolVersion: 1,
  requestId,
  sequence: 1,
  handle: requestId,
  documentId: requestId,
  expectedRevision: 1,
  expectedHash: "0".repeat(64),
  data: "AA==",
} as const;

test("raster paste protocol accepts exact canonical bytes and no target fields", () => {
  expect(parseRasterPasteRequest(request)).toEqual(request);
  const exact = Buffer.alloc(RASTER_PASTE_MAX_BYTES).toString("base64");
  const over = Buffer.alloc(RASTER_PASTE_MAX_BYTES + 1).toString("base64");
  expect(exact.length).toBe(over.length);
  expect(parseRasterPasteRequest({ ...request, data: exact })?.data).toBe(exact);
  for (const invalid of [
    { data: over }, { data: "" }, { data: "AB==" }, { data: "_w==" }, { data: "AA=\n" },
    { sequence: 0 }, { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { expectedRevision: 1.5 }, { requestId: requestId + "\n" }, { path: "/outside" }, { root: requestId },
  ]) expect(parseRasterPasteRequest({ ...request, ...invalid })).toBeUndefined();
});

test("raster paste receipt is bound to the request and fixed safe relative paths", () => {
  const relativePath = `./assets/image-${requestId}-2.jpg`;
  const receipt = { ok: true, requestId, relativePath } as const;
  expect(parseRasterPasteResponse(receipt, requestId)).toEqual(receipt);
  expect(parseRasterPasteResponse(receipt, "other")).toBeUndefined();
  for (const path of ["../evil.png", `./assets/image-${requestId}-5.jpg`, relativePath + "\n"])
    expect(parseRasterPasteResponse({ ...receipt, relativePath: path }, requestId)).toBeUndefined();
  for (const error of ["BUSY", "ADMITTED_BUSY", "UNKNOWN"] as const) {
    const failure = { ok: false, requestId, error } as const;
    expect(parseRasterPasteResponse(failure, requestId)).toEqual(failure);
  }
  expect(parseRasterPasteResponse({ ...receipt, extra: true }, requestId)).toBeUndefined();
});
