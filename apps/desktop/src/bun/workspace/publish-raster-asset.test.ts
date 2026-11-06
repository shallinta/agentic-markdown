import { expect, test } from "bun:test";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizeRoot } from "./authorization";
import type { CreationTarget } from "./create-markdown";
import { publishRasterAsset, type RasterAssetNative } from "./publish-raster-asset";

const native = createRequire(import.meta.url)(
  join(import.meta.dir, "../../../dist-native/save-primitives.node")
) as RasterAssetNative;
const png = await readFile(join(import.meta.dir, "../../../icon.iconset/icon_128x128.png"));

function withNative(overrides: Partial<RasterAssetNative>): RasterAssetNative {
  return {
    openDirectoryAt: native.openDirectoryAt,
    createTemp: native.createTemp,
    openFileAt: native.openFileAt,
    scanStat: native.scanStat,
    publishExclusive: native.publishExclusive,
    createFileExclusive: (fd, leaf) => native.createFileExclusive(fd, leaf),
    scanOpen: fd => native.scanOpen(fd),
    scanBatch: (cursor, limit) => native.scanBatch(cursor, limit),
    scanClose: cursor => native.scanClose(cursor),
    createPrivateDirectory: (fd, leaf) => native.createPrivateDirectory(fd, leaf),
    publishDirectoryExclusive: (fd, source, leaf) => native.publishDirectoryExclusive(fd, source, leaf),
    ...overrides,
  };
}
const withPublish = (publishExclusive: RasterAssetNative["publishExclusive"]) => withNative({ publishExclusive });

async function fixture(withAssets = true) {
  const scratch = await mkdtemp(join(tmpdir(), "agentic-raster-publish-"));
  const root = await authorizeRoot(scratch);
  const assets = join(root.path, "assets");
  const markdown = join(root.path, "sample.md");
  if (withAssets) await mkdir(assets);
  await writeFile(markdown, "# 原文\r\n");
  const target: CreationTarget = {
    root, path: root.path, chain: [], showHidden: false,
    check: () => undefined,
    scope: () => ({ verify: () => Promise.resolve() }),
  };
  return {
    root, assets, markdown,
    options: { native, target, bytes: png, current: () => true, revalidate: () => Promise.resolve(true) },
    dispose: () => rm(scratch, { recursive: true, force: true }),
  };
}

async function expectOnlyStage(directory: string) {
  const names = await readdir(directory);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^\.agentic-save-/);
}

test("real raster publication preserves a colliding leaf and confirms the suffixed bytes", async () => {
  const f = await fixture();
  const tried: string[] = [];
  try {
    const result = await publishRasterAsset({
      ...f.options,
      native: withPublish((fd, source, leaf) => {
        tried.push(leaf);
        if (tried.length === 1) writeFileSync(join(f.assets, leaf), "已有文件", { flag: "wx" });
        return native.publishExclusive(fd, source, leaf);
      }),
    });
    expect(tried).toHaveLength(2);
    expect(tried[1]).toMatch(/^image-[0-9a-f-]+-2\.png$/);
    expect(result).toEqual({ ok: true, relativePath: `./assets/${tried[1]}` });
    expect(await readFile(join(f.assets, tried[1]))).toEqual(png);
    expect(await readFile(join(f.assets, tried[0]), "utf8")).toBe("已有文件");
    expect((await readdir(f.assets)).sort()).toEqual([...tried].sort());
    expect(await readFile(f.markdown, "utf8")).toBe("# 原文\r\n");
  } finally { await f.dispose(); }
});

test("known collisions stop at the bound without overwriting or deleting any name", async () => {
  const f = await fixture();
  const tried: string[] = [];
  try {
    const result = await publishRasterAsset({
      ...f.options,
      native: withPublish((fd, source, leaf) => {
        tried.push(leaf);
        writeFileSync(join(f.assets, leaf), leaf, { flag: "wx" });
        return native.publishExclusive(fd, source, leaf);
      }),
    });
    expect(result).toEqual({ ok: false, error: "CONFLICT" });
    expect(tried).toHaveLength(4);
    const names = await readdir(f.assets);
    expect(names).toHaveLength(5);
    expect(names.find(name => !tried.includes(name))).toMatch(/^\.agentic-save-/);
    for (const leaf of tried) expect(await readFile(join(f.assets, leaf), "utf8")).toBe(leaf);
  } finally { await f.dispose(); }
});

test("a missing assets directory is created exclusively and holds the verified raster", async () => {
  const f = await fixture(false);
  try {
    const result = await publishRasterAsset(f.options);
    if (!result.ok) throw Error(result.error);
    expect(result.relativePath).toMatch(/^\.\/assets\/image-[0-9a-f-]+\.png$/);
    expect(await readFile(join(f.root.path, result.relativePath))).toEqual(png);
    expect((await readdir(f.root.path)).sort()).toEqual(["assets", "sample.md"]);
    expect(await readdir(f.assets)).toHaveLength(1);
    expect(await readFile(f.markdown, "utf8")).toBe("# 原文\r\n");
  } finally { await f.dispose(); }
});

test("invalid bytes, non-directory or linked assets, and a replaced named directory never publish", async () => {
  const f = await fixture();
  try {
    let attempts = 0;
    const options = { ...f.options, native: withPublish(() => { attempts++; return 0; }) };
    expect(await publishRasterAsset({ ...options, bytes: Buffer.from("not an image") })).toEqual({ ok: false, error: "INVALID" });
    expect(await publishRasterAsset({ ...options, bytes: Buffer.alloc(1024 * 1024 + 1) })).toEqual({ ok: false, error: "INVALID" });
    const moved = join(f.root.path, "previous-assets");
    await rename(f.assets, moved);
    await writeFile(f.assets, "既有普通文件");
    expect(await publishRasterAsset(options)).toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(await readFile(f.assets, "utf8")).toBe("既有普通文件");
    await rm(f.assets);
    await symlink(moved, f.assets);
    expect(await publishRasterAsset(options)).toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(await readdir(moved)).toEqual([]);
    await rm(f.assets);
    await mkdir(f.assets);
    let checks = 0;
    expect(await publishRasterAsset({
      ...options, async revalidate() {
        if (++checks === 2) {
          await rename(f.assets, join(f.root.path, "detached-assets"));
          await mkdir(f.assets);
        }
        return true;
      },
    })).toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(attempts).toBe(0);
    expect(await readdir(f.assets)).toEqual([]);
    await expectOnlyStage(join(f.root.path, "detached-assets"));
  } finally { await f.dispose(); }
});

test("directory conflict and unconfirmed directory publication never stage an image", async () => {
  for (const failure of ["collision", "unknown-dispatch", "replaced-before-reopen"]) {
    const f = await fixture(false);
    try {
      let stagedFiles = 0, openedAssets = 0;
      const result = await publishRasterAsset({
        ...f.options,
        native: withNative({
          createTemp() { stagedFiles++; throw Error("unexpected image staging"); },
          publishDirectoryExclusive(fd, source, leaf) {
            if (failure === "collision") {
              mkdirSync(f.assets);
              writeFileSync(join(f.assets, "existing"), "existing");
            }
            const status = native.publishDirectoryExclusive(fd, source, leaf);
            if (failure === "unknown-dispatch")
              throw Object.assign(Error("injected directory receipt loss"), { code: "PUBLISH_FAILED" });
            return status;
          },
          openDirectoryAt(fd, name) {
            if (name === "assets" && ++openedAssets === 2 && failure === "replaced-before-reopen") {
              renameSync(f.assets, join(f.root.path, "moved-assets"));
              mkdirSync(f.assets);
            }
            return native.openDirectoryAt(fd, name);
          },
        }),
      });
      expect(result).toEqual({ ok: false, error: failure === "collision" ? "CONFLICT" : "UNKNOWN" });
      expect(stagedFiles).toBe(0);
      expect(await readdir(f.assets)).toEqual(failure === "collision" ? ["existing"] : []);
      if (failure === "collision")
        expect(await readFile(join(f.assets, "existing"), "utf8")).toBe("existing");
      if (failure === "replaced-before-reopen")
        expect(await readdir(join(f.root.path, "moved-assets"))).toEqual([]);
    } finally { await f.dispose(); }
  }
});

test("pre-publish staleness and post-publish uncertainty have distinct receipts", async () => {
  for (const failure of ["stale-before", "unknown-dispatch", "stale-after"]) {
    const f = await fixture();
    try {
      let checks = 0, attempts = 0, leaf: string | undefined;
      const result = await publishRasterAsset({
        ...f.options,
        revalidate: () => Promise.resolve(++checks !== (failure === "stale-before" ? 2 : failure === "stale-after" ? 3 : 0)),
        native: withPublish((fd, source, name) => {
          attempts++;
          leaf = name;
          const status = native.publishExclusive(fd, source, name);
          if (failure === "unknown-dispatch")
            throw Object.assign(Error("injected receipt loss"), { code: "PUBLISH_FAILED" });
          return status;
        }),
      });
      if (failure === "stale-before") {
        expect(result).toEqual({ ok: false, error: "STALE" });
        expect(attempts).toBe(0);
        await expectOnlyStage(f.assets);
      } else {
        expect(result).toEqual({ ok: false, error: "UNKNOWN" });
        expect(attempts).toBe(1);
        if (!leaf) throw Error("Missing dispatch witness");
        expect(await readdir(f.assets)).toEqual([leaf]);
        expect(await readFile(join(f.assets, leaf))).toEqual(png);
      }
      expect(await readFile(f.markdown, "utf8")).toBe("# 原文\r\n");
    } finally { await f.dispose(); }
  }
});
