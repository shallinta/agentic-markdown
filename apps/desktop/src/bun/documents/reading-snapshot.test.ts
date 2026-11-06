import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObservationRequest } from "../../shared/document-observation";
import type { LocalImageResult } from "../../shared/local-images";
import { READER_SNAPSHOT_MAX_BYTES } from "../../shared/reader-snapshot";
import { rawPatch } from "../../shared/save-content";

import { readLocalImage, type ImageJob } from "./local-image-operation";
import { verifySingleFileAuthorization } from "./path-authorization";

import { createDocumentService } from ".";

const fixtureText = "\uFEFF# 阅读 📖\r\n`反引号` \\\" <script>样本</script>\r\n";

async function fixture(text = fixtureText, options: Pick<Parameters<typeof createDocumentService>[0], "imageReader" | "verify"> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "agentic-reading-snapshot-"));
  const path = join(directory, "sample.md");
  // Keep watcher timing separate from the real descriptor verification below.
  const documents = createDocumentService({
    ...options,
    pickFile: () => Promise.resolve(path),
    probe: () => Promise.resolve({ status: "unchanged" }),
  });
  const cleanup = async () => {
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await writeFile(path, text);
    const selected = await documents.select({ protocolVersion: 1, requestId: "select" });
    if (!selected.ok || !selected.snapshot) throw Error("Fixture selection failed");
    const { handle, documentId, revision, hash } = selected.snapshot;
    const source = { handle, documentId, expectedRevision: revision, expectedHash: hash };
    const observer: ObservationRequest = {
      protocolVersion: 1, requestId: "observe", active: true,
      handle, documentId, revision, hash, watchToken: randomUUID(), watchEpoch: 1,
    };
    return { directory, path, documents, source, observer, cleanup, snapshot: selected.snapshot };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test("reading snapshot preserves exact saved bytes and retires a stopped observation", async () => {
  const f = await fixture();
  try {
    expect(await f.documents.captureReadingSnapshot(f.source)).toEqual({ ok: false, error: "CONFLICT" });
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    const capture = await f.documents.captureReadingSnapshot(f.source);
    if (!capture.ok) throw Error(capture.error);
    expect(Object.keys(capture).sort()).toEqual(["base64", "current", "ok"]);
    const withoutMarker = await f.documents.captureReadingSnapshot(f.source, () => true, { includeImage: true });
    expect(Object.keys(withoutMarker).sort()).toEqual(["base64", "current", "ok"]);
    expect(Buffer.from(capture.base64, "base64")).toEqual(Buffer.from(fixtureText));
    expect(await readFile(f.path)).toEqual(Buffer.from(fixtureText));
    expect(capture.current()).toBe(true);
    const pending = f.documents.captureReadingSnapshot(f.source);
    expect((await f.documents.observe({ ...f.observer, active: false })).ok).toBe(true);
    expect(await pending).toEqual({ ok: false, error: "CONFLICT" });
    expect(capture.current()).toBe(false);
    expect(f.documents.locations().map(({ handle }) => handle)).toEqual([f.source.handle]);
  } finally {
    await f.cleanup();
  }
});

const imageResult = {
  ok: true, mime: "image/png", width: 1, height: 1, data: "AA==", identity: "a".repeat(64),
} as const satisfies LocalImageResult;
const unavailable = { ok: false, error: "UNAVAILABLE" } as const;

test("reading image ticket is opt-in and independent of the settled body ticket", async () => {
  const jobs: ImageJob[] = [];
  const nativePath = join(import.meta.dir, "../../../dist-native/save-primitives.node");
  const png = await readFile(join(import.meta.dir, "../../../icon.iconset/icon_128x128.png"));
  const f = await fixture("![asset](raster.png)", { imageReader: {
    read(job) { jobs.push(job); return readLocalImage(job, nativePath); }, dispose: () => undefined,
  } });
  try {
    await writeFile(join(f.directory, "raster.png"), png);
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    let bodyPending = true;
    const captured = await f.documents.captureReadingSnapshot(f.source, () => bodyPending, { includeImage: true });
    if (!captured.ok || !captured.readImage) throw Error("missing image ticket");
    expect(captured.current()).toBe(true);
    bodyPending = false;
    expect(captured.current()).toBe(false);
    let childLive = true;
    const image = await captured.readImage("raster.png", () => childLive);
    if (!image.ok) throw Error(image.error);
    expect(Object.keys(image).sort()).toEqual(["current", "data", "height", "mime", "ok", "width"]);
    expect(image.mime).toBe("image/png");
    expect(image.width).toBe(128);
    expect(Buffer.from(image.data, "base64")).toEqual(png);
    expect(jobs.map(job => [job.reference, job.profile])).toEqual([["raster.png", "reader-snapshot"]]);
    expect(image.current()).toBe(true);
    childLive = false;
    expect(image.current()).toBe(false);
    childLive = true;
    expect(image.current()).toBe(false);
    expect(await captured.readImage("raster.png", () => true)).toEqual(unavailable);
    expect(jobs).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});

test("reading image ticket rejects same-size body rewrites before, during, and after image work", async () => {
  for (const phase of ["before", "during", "after"] as const) {
    const entered = Promise.withResolvers<void>();
    const unblock = Promise.withResolvers<LocalImageResult>();
    let reads = 0;
    const f = await fixture("![asset](raster.png)\nold body", { imageReader: {
      read() { reads++; entered.resolve(); return unblock.promise; }, dispose: () => undefined,
    } });
    try {
      expect((await f.documents.observe(f.observer)).ok).toBe(true);
      const captured = await f.documents.captureReadingSnapshot(f.source, () => true, { includeImage: true });
      if (!captured.ok || !captured.readImage) throw Error("missing image ticket");
      const initial = await stat(f.path, { bigint: true });
      if (phase === "before") await writeFile(f.path, "![asset](raster.png)\nnew body");
      const pending = captured.readImage("raster.png", () => true);
      if (phase !== "before") await entered.promise;
      if (phase === "during") await writeFile(f.path, "![asset](raster.png)\nnew body");
      unblock.resolve(imageResult);
      const result = await pending;
      if (phase === "after") {
        if (!result.ok) throw Error(result.error);
        expect(result.current()).toBe(true);
        await writeFile(f.path, "![asset](raster.png)\nnew body");
        expect(result.current()).toBe(false);
      } else expect(result).toEqual(unavailable);
      expect(reads).toBe(phase === "before" ? 0 : 1);
      const changed = await stat(f.path, { bigint: true });
      expect(changed.ino).toBe(initial.ino);
      expect(changed.size).toBe(initial.size);
    } finally {
      unblock.resolve(unavailable);
      await f.cleanup();
    }
  }
});

test("opt-in capture cannot bind a rewrite between terminal verification and the actual fd stamp", async () => {
  let verifications = 0;
  let checkRewrite = false;
  const f = await fixture("old body", { verify: async (authorization) => {
    const proof = await verifySingleFileAuthorization(authorization);
    if (checkRewrite && ++verifications === 2) await writeFile(authorization.path, "new body");
    return proof;
  } });
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    checkRewrite = true;
    expect(await f.documents.captureReadingSnapshot(f.source, () => true, { includeImage: true }))
      .toEqual({ ok: false, error: "FILE_CHANGED" });
    expect(await readFile(f.path, "utf8")).toBe("new body");
  } finally {
    await f.cleanup();
  }
});

test("held reading image is discarded when the child or saved grant ceases to match", async () => {
  for (const cause of ["close", "scope", "trash", "observe", "release", "replace", "save"] as const) {
    const entered = Promise.withResolvers<void>();
    const unblock = Promise.withResolvers<LocalImageResult>();
    const f = await fixture("![asset](raster.png)", { imageReader: {
      read() { entered.resolve(); return unblock.promise; }, dispose: () => undefined,
    } });
    try {
      expect((await f.documents.observe(f.observer)).ok).toBe(true);
      const captured = await f.documents.captureReadingSnapshot(f.source, () => true, { includeImage: true });
      if (!captured.ok || !captured.readImage) throw Error("missing image ticket");
      let childLive = true;
      const pending = captured.readImage("raster.png", () => childLive);
      await entered.promise;
      if (cause === "close") childLive = false;
      if (cause === "scope") f.documents.setAssetScope(f.source.handle, { path: f.directory, directories: [], verify: () => Promise.resolve() });
      if (cause === "trash") f.documents.setTrashGuard(path => path.endsWith("/raster.png"));
      if (cause === "observe") expect((await f.documents.observe({ ...f.observer, active: false })).ok).toBe(true);
      if (cause === "release") expect((await f.documents.release({ protocolVersion: 1, requestId: "release", handle: f.source.handle })).ok).toBe(true);
      if (cause === "replace") {
        await rename(f.path, join(f.directory, "old.md"));
        await writeFile(f.path, f.snapshot.text);
      }
      if (cause === "save") {
        const text = "new saved body";
        expect((await f.documents.save({
          protocolVersion: 1, requestId: "save", ...f.source, bufferRevision: 1,
          mirror: f.snapshot.mirror, content: { kind: "patch", ...rawPatch(f.snapshot.text, text), targetHash: createHash("sha256").update(text).digest("hex") },
        })).ok).toBe(true);
      }
      unblock.resolve(imageResult);
      expect(await pending).toEqual(unavailable);
      expect(await captured.readImage("later.png", () => true)).toEqual(unavailable);
    } finally {
      unblock.resolve(unavailable);
      await f.cleanup();
    }
  }
});

test("reading snapshot rejects stale requests and permanently fences cancellation", async () => {
  const f = await fixture();
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    for (const source of [
      { ...f.source, documentId: randomUUID() },
      { ...f.source, expectedRevision: f.source.expectedRevision + 1 },
      { ...f.source, expectedHash: "0".repeat(64) },
    ]) expect(await f.documents.captureReadingSnapshot(source)).toEqual({ ok: false, error: "CONFLICT" });
    expect(await f.documents.captureReadingSnapshot({ ...f.source, handle: randomUUID() })).toEqual({ ok: false, error: "INVALID_HANDLE" });
    expect(await f.documents.captureReadingSnapshot(f.source, () => false)).toEqual({ ok: false, error: "CANCELLED" });
    let live = true;
    const capture = await f.documents.captureReadingSnapshot(f.source, () => live);
    if (!capture.ok) throw Error(capture.error);
    expect(capture.current()).toBe(true);
    live = false;
    expect(capture.current()).toBe(false);
    live = true;
    expect(capture.current()).toBe(false);
    f.documents.setTrashGuard(() => true);
    expect(await f.documents.captureReadingSnapshot(f.source)).toEqual({ ok: false, error: "BUSY" });
  } finally {
    await f.cleanup();
  }
});

test("reading snapshot rejects a same-inode rewrite and a replacement without revoking the grant", async () => {
  const f = await fixture();
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    await writeFile(f.path, fixtureText.replace("样本", "变化"));
    expect(await f.documents.captureReadingSnapshot(f.source)).toEqual({ ok: false, error: "CONFLICT" });
    await rename(f.path, join(f.directory, "previous.md"));
    await writeFile(f.path, fixtureText);
    expect(await f.documents.captureReadingSnapshot(f.source)).toEqual({ ok: false, error: "FILE_CHANGED" });
    expect(f.documents.locations().map(({ handle }) => handle)).toEqual([f.source.handle]);
    expect(await readFile(f.path)).toEqual(Buffer.from(fixtureText));
  } finally {
    await f.cleanup();
  }
});

test("reading snapshot accepts the document byte limit and rejects growth past it", async () => {
  const exact = "x".repeat(READER_SNAPSHOT_MAX_BYTES);
  const f = await fixture(exact);
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    const capture = await f.documents.captureReadingSnapshot(f.source);
    if (!capture.ok) throw Error(capture.error);
    expect(Buffer.from(capture.base64, "base64").byteLength).toBe(READER_SNAPSHOT_MAX_BYTES);
    // Ordinary selection already refuses an oversized file. Grow the existing grant instead.
    await writeFile(f.path, `${exact}x`);
    expect(await f.documents.captureReadingSnapshot(f.source)).toEqual({ ok: false, error: "TOO_LARGE" });
  } finally {
    await f.cleanup();
  }
});
