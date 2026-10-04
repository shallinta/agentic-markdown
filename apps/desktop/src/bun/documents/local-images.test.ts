import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
  link,
  rename,
  unlink,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  localImageReference,
  MAX_IMAGE_BYTES,
  validLocalImageResult,
  validLocalImageResponse,
} from "../../shared/local-images";

import { imageFormat } from "./image-format";
import { readLocalImage } from "./local-image-operation";
import {
  authorizeSingleFile,
  verifySingleFileAuthorization,
  type SingleFileAuthorization,
} from "./path-authorization";

import { createDocumentService } from ".";

const nativePath = join(
  import.meta.dir,
  "../../../dist-native/save-primitives.node"
);
const icon = await readFile(
  join(import.meta.dir, "../../../icon.iconset/icon_128x128.png")
);
let root: string, grant: SingleFileAuthorization;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "agentic-image-test-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs/a.md"), "![图](图%20像.png)");
  await writeFile(join(root, "docs/图 像.png"), icon);
  await writeFile(join(root, "outside.png"), icon);
  grant = await authorizeSingleFile(join(root, "docs/a.md"));
});
afterEach(async () => {
  await grant.file.close();
  await rm(root, { recursive: true, force: true });
});
const read = (reference: string, hook?: () => Promise<void>) =>
  readLocalImage({ authorization: grant, reference }, nativePath, hook);
test("relative decoding rejects network, absolute and ambiguous inputs", () => {
  for (const value of [
    "https://x/a.png",
    "//x/a.png",
    "file:///a.png",
    "data:image/png;base64,AA",
    "/a.png",
    "%2fetc/passwd",
    "a%00.png",
    "a\\b.png",
    "%zz",
    "a.png?x",
    "a.png#x",
  ])
    expect(localImageReference(value)).toBeNull();
  expect(localImageReference("图%20像.png")).toBe("图 像.png");
  expect(localImageReference("%252e%252e/a.png")).toBe("%2e%2e/a.png");
});
test("result and envelope schemas reject extra fields, coercion and invalid base64", () => {
  const result = {
    ok: true,
    mime: "image/png",
    data: "AAAA",
    width: 1,
    height: 1,
    identity: "a".repeat(64),
  };
  expect(validLocalImageResult(result)).toBe(true);
  for (const data of ["", "A", "A===", "AAAA\n"])
    expect(validLocalImageResult({ ...result, data })).toBe(false);
  expect(validLocalImageResult({ ...result, extra: true })).toBe(false);
  expect(
    validLocalImageResult({
      ok: false,
      error: { toString: () => "UNAVAILABLE" },
    })
  ).toBe(false);
  expect(
    validLocalImageResponse({ ...result, protocolVersion: 1, requestId: "one" })
  ).toBe(true);
  expect(
    validLocalImageResponse({
      ...result,
      protocolVersion: 1,
      requestId: "one",
      extra: true,
    })
  ).toBe(false);
});
test("PNG and internal symlink read only the authorized object", async () => {
  await symlink("图 像.png", join(root, "docs/alias.png"));
  for (const ref of ["图%20像.png", "alias.png"]) {
    const value = await read(ref);
    expect(value.ok).toBe(true);
    if (value.ok) {
      expect(value.mime).toBe("image/png");
      expect(value.width).toBe(128);
      expect(Buffer.from(value.data, "base64")).toEqual(icon);
    }
  }
});
test("escape, same-prefix, outside symlink, hardlink and non-image are rejected", async () => {
  await mkdir(join(root, "docs-extra"));
  await writeFile(join(root, "docs-extra/p.png"), icon);
  await symlink("../outside.png", join(root, "docs/escape.png"));
  await link(join(root, "outside.png"), join(root, "docs/hard.png"));
  await writeFile(join(root, "docs/fake.png"), "<svg onload='alert(1)'/>");
  for (const ref of [
    "../outside.png",
    "../docs-extra/p.png",
    "escape.png",
    "hard.png",
    "fake.png",
    ".",
    "missing.png",
  ])
    expect((await read(ref)).ok).toBe(false);
});
test("post-resolution leaf symlink substitution cannot read outside", async () => {
  expect(
    (
      await read("图%20像.png", async () => {
        await unlink(join(root, "docs/图 像.png"));
        await symlink("../outside.png", join(root, "docs/图 像.png"));
      })
    ).ok
  ).toBe(false);
});
test("post-resolution directory substitution and root replacement fail closed", async () => {
  await mkdir(join(root, "docs/sub"));
  await writeFile(join(root, "docs/sub/p.png"), icon);
  expect(
    (
      await read("sub/p.png", async () => {
        await rename(join(root, "docs/sub"), join(root, "docs/old"));
        await symlink("..", join(root, "docs/sub"));
      })
    ).ok
  ).toBe(false);
  expect(
    (
      await read("图%20像.png", async () => {
        await rename(join(root, "docs"), join(root, "old"));
        await mkdir(join(root, "docs"));
        await writeFile(join(root, "docs/图 像.png"), icon);
      })
    ).ok
  ).toBe(false);
});
test("truncated, enormous dimensions and excessive bytes are rejected", async () => {
  const large = Buffer.from(icon);
  large.writeUInt32BE(1000000, 16);
  for (const [name, body] of [
    ["cut.png", icon.subarray(0, 25)],
    ["pixels.png", large],
    ["bytes.png", Buffer.alloc(MAX_IMAGE_BYTES + 1)],
  ] as const) {
    await writeFile(join(root, "docs", name), body);
    expect((await read(name)).ok).toBe(false);
  }
  expect(() => imageFormat(Buffer.from("not an image"))).toThrow();
});
test("native fixed primitives reject caller flags and non-leaf names", () => {
  const native = createRequire(import.meta.url)(nativePath) as {
    openDirectoryAt(...args: unknown[]): number;
    openFileAt(...args: unknown[]): number;
  };
  for (const name of ["", ".", "..", "a/b", "a\0b"]) {
    expect(() => native.openDirectoryAt(0, name)).toThrow();
    expect(() => native.openFileAt(0, name)).toThrow();
  }
  expect(() => native.openFileAt(0, "x", 0)).toThrow();
});
test("PNG duplicate dimensions and APNG are not accepted", () => {
  const duplicate = Buffer.concat([
    icon.subarray(0, 33),
    icon.subarray(8, 33),
    icon.subarray(33),
  ]);
  expect(() => imageFormat(duplicate)).toThrow();
  for (const name of ["acTL", "fcTL", "fdAT"]) {
    const chunk = Buffer.alloc(12);
    chunk.write(name, 4, "ascii");
    expect(() =>
      imageFormat(
        Buffer.concat([icon.subarray(0, 33), chunk, icon.subarray(33)])
      )
    ).toThrow();
  }
});
test("JPEG scans beyond the first SOF and rejects competing dimensions", () => {
  const sof = Buffer.from([255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0]);
  const scan = Buffer.from([255, 218, 0, 8, 1, 1, 0, 0, 63, 0, 0, 255, 217]);
  const jpeg = Buffer.concat([Buffer.from([255, 216]), sof, scan]);
  expect(imageFormat(jpeg)).toEqual({
    mime: "image/jpeg",
    width: 1,
    height: 1,
  });
  expect(() =>
    imageFormat(Buffer.concat([Buffer.from([255, 216]), sof, sof, scan]))
  ).toThrow();
  const late = Buffer.concat([
    jpeg.subarray(0, jpeg.length - 2),
    sof,
    Buffer.from([255, 217]),
  ]);
  expect(() => imageFormat(late)).toThrow();
});
test("service validates handles, revocation, and document replacement", async () => {
  const service = createDocumentService({
    pickFile: () => Promise.resolve(join(root, "docs/a.md")),
  });
  try {
    const selected = await service.select({
      protocolVersion: 1,
      requestId: "select",
    });
    if (!selected.ok || !selected.snapshot) throw Error("selection");
    const request = {
      protocolVersion: 1 as const,
      requestId: "image",
      handle: selected.snapshot.handle,
      reference: "图%20像.png",
    };
    expect(
      (
        await service.readLocalImage({
          ...request,
          reference: "https://x/a.png",
        })
      ).ok
    ).toBe(false);
    expect((await service.readLocalImage(request)).ok).toBe(true);
    await rename(join(root, "docs/a.md"), join(root, "docs/old.md"));
    await writeFile(join(root, "docs/a.md"), "replacement");
    expect((await service.readLocalImage(request)).ok).toBe(false);
    await service.release({
      protocolVersion: 1,
      requestId: "release",
      handle: request.handle,
    });
    expect((await service.readLocalImage(request)).ok).toBe(false);
  } finally {
    await service.dispose();
  }
});
test("service admission bounds validation I/O and releases slots after failures", async () => {
  let gated = false,
    fail = false,
    release: () => void = () => {
      throw Error("gate not initialized");
    };
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const service = createDocumentService({
    pickFile: () => Promise.resolve(join(root, "docs/a.md")),
    verify: async (authorization) => {
      if (gated) await gate;
      if (fail) throw Error("TEST_FAILURE");
      return verifySingleFileAuthorization(authorization);
    },
  });
  try {
    const selected = await service.select({
      protocolVersion: 1,
      requestId: "select",
    });
    if (!selected.ok || !selected.snapshot) throw Error("select");
    const request = {
      protocolVersion: 1,
      requestId: "image",
      handle: selected.snapshot.handle,
      reference: "图%20像.png",
    };
    gated = true;
    const tasks = Array.from({ length: 9 }, (_, i) =>
      service.readLocalImage({ ...request, requestId: String(i) })
    );
    expect(await service.readLocalImage(request)).toEqual({
      protocolVersion: 1,
      requestId: "image",
      ok: false,
      error: "BUSY",
    });
    fail = true;
    release();
    expect((await Promise.all(tasks)).every((result) => !result.ok)).toBe(true);
    gated = false;
    fail = false;
    expect((await service.readLocalImage(request)).ok).toBe(true);
  } finally {
    release();
    await service.dispose();
  }
});
