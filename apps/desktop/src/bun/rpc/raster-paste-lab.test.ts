import { expect, test } from "bun:test";

import { RASTER_PASTE_LAB_MAX_BYTES } from "../../shared/raster-paste-lab";

import { inspectRasterPaste } from "./raster-paste-lab";

const requestId = "1e66497d-c7ba-474c-8168-97c1ff79af5b";
const request = (base64: string) => ({ protocolVersion: 1, requestId, base64 });

test("raster paste lab is disabled by default and returns only anonymous byte evidence", () => {
  expect(inspectRasterPaste(request("YQ=="), false)).toEqual({ ok: false, error: "DISABLED" });
  expect(inspectRasterPaste(request("YQ=="), true)).toEqual({
    ok: true,
    requestId,
    bytes: 1,
    sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
  });
  const invalid = { ok: false, error: "INVALID" } as const;
  for (const base64 of ["", "YQ", "YR==", "YQ-_", "YQ==\n", "Y Q="])
    expect(inspectRasterPaste(request(base64), true)).toEqual(invalid);
  expect(inspectRasterPaste({ ...request("YQ=="), path: "unexpected" }, true)).toEqual(invalid);
  expect(inspectRasterPaste({ ...request("YQ=="), requestId: requestId + "\n" }, true)).toEqual(invalid);
});

test("raster paste lab independently bounds decoded bytes at an equal encoded length", () => {
  const exact = Buffer.alloc(RASTER_PASTE_LAB_MAX_BYTES, 0x37).toString("base64");
  const over = Buffer.alloc(RASTER_PASTE_LAB_MAX_BYTES + 1, 0x37).toString("base64");
  expect(over.length).toBe(exact.length);
  expect(inspectRasterPaste(request(exact), true)).toEqual({
    ok: true,
    requestId,
    bytes: RASTER_PASTE_LAB_MAX_BYTES,
    sha256: new Bun.CryptoHasher("sha256").update(atob(exact)).digest("hex"),
  });
  expect(inspectRasterPaste(request(over), true)).toEqual({ ok: false, error: "INVALID" });
});
