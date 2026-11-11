import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObservationRequest } from "../../shared/document-observation";
import type { LocalImageResult } from "../../shared/local-images";
import type { MainTabSourceInput } from "../../shared/main-tab-checkpoint";
import { READER_SNAPSHOT_MAX_BYTES } from "../../shared/reader-snapshot";
import { rawPatch } from "../../shared/save-content";
import { authorizeRoot, verifyRoot } from "../workspace/authorization";

import { readLocalImage, type ImageJob } from "./local-image-operation";
import { authorizeSingleFile, verifySingleFileAuthorization } from "./path-authorization";

import { createDocumentService } from ".";

const fixtureText = "\uFEFF# 阅读 📖\r\n`反引号` \\\" <script>样本</script>\r\n";

async function fixture(
  text = fixtureText,
  { directoryGrant, ...options }: Pick<Parameters<typeof createDocumentService>[0], "imageReader" | "verify" | "onTiming"> &
    { directoryGrant?: boolean } = {}
) {
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
    const request = { protocolVersion: 1 as const, requestId: "select" };
    const root = directoryGrant ? await authorizeRoot(directory) : undefined;
    const selected = root
      ? await documents.openAuthorized(request, () => authorizeSingleFile(path), { verify: () => verifyRoot(root) })
      : await documents.select(request);
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

test("viewport source returns only the current observed directory text and rejects changed authority", async () => {
  const f = await fixture(fixtureText, { directoryGrant: true });
  const { handle, documentId, revision, hash } = f.snapshot;
  const tab: MainTabSourceInput = { handle, documentId, revision, hash, pinned: false, mode: "editing" };
  try {
    expect(await f.documents.captureViewportSource(tab, () => true)).toBeUndefined();
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    const captured = await f.documents.captureViewportSource(tab, () => true);
    expect(captured?.raw).toBe(fixtureText);
    expect(captured?.current()).toBe(true);
    for (const mismatch of [{ handle: randomUUID() }, { documentId: randomUUID() }, { revision: revision + 1 }, { hash: "0".repeat(64) }])
      expect(await f.documents.captureViewportSource({ ...tab, ...mismatch }, () => true)).toBeUndefined();
    let current = true;
    const pending = f.documents.captureViewportSource(tab, () => current);
    current = false;
    expect(await pending).toBeUndefined();
    expect(await f.documents.captureViewportSource(tab, () => { throw Error("stale caller"); })).toBeUndefined();
    expect(await readFile(f.path)).toEqual(Buffer.from(fixtureText));
    await writeFile(f.path, fixtureText.replace("样本", "变化"));
    expect(await f.documents.captureViewportSource(tab, () => true)).toBeUndefined();
    const prior = join(f.directory, "prior.md");
    await rename(f.path, prior);
    await writeFile(prior, fixtureText);
    await symlink(prior, f.path);
    expect(await f.documents.captureViewportSource(tab, () => true)).toBeUndefined();
    expect(f.documents.locations().map((location) => location.handle)).toEqual([handle]);
  } finally { await f.cleanup(); }
});

test("a returned viewport source receipt is retired when the same-size file is rewritten in place", async () => {
  const f = await fixture("old body", { directoryGrant: true });
  const { handle, documentId, revision, hash } = f.snapshot;
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    const tab: MainTabSourceInput = { handle, documentId, revision, hash, pinned: false, mode: "editing" };
    const captured = await f.documents.captureViewportSource(tab, () => true);
    expect(captured?.raw).toBe("old body");
    expect(captured?.current()).toBe(true);
    const before = await stat(f.path, { bigint: true });
    await writeFile(f.path, "new body");
    const after = await stat(f.path, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(captured?.current()).toBe(false);
    await writeFile(f.path, "old body");
    expect(captured?.current()).toBe(false);
  } finally { await f.cleanup(); }
});

test("observing a standalone grant never admits viewport source reads", async () => {
  const f = await fixture();
  const { handle, documentId, revision, hash } = f.snapshot;
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    expect(await f.documents.captureViewportSource({ handle, documentId, revision, hash, pinned: false, mode: "source" }, () => true))
      .toBeUndefined();
  } finally { await f.cleanup(); }
});

test("viewport source checks the physical file again after its descriptor read has settled", async () => {
  let rewrite: (() => void) | undefined;
  const f = await fixture("old body", { directoryGrant: true, onTiming(phase) {
    if (phase === "diskReadMs") rewrite?.();
  } });
  const { handle, documentId, revision, hash } = f.snapshot;
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    const before = await stat(f.path, { bigint: true });
    rewrite = () => writeFileSync(f.path, "new body");
    expect(await f.documents.captureViewportSource({ handle, documentId, revision, hash, pinned: false, mode: "editing" }, () => true))
      .toBeUndefined();
    const after = await stat(f.path, { bigint: true });
    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(await readFile(f.path, "utf8")).toBe("new body");
  } finally { await f.cleanup(); }
});

const imageResult = {
  ok: true, mime: "image/png", width: 1, height: 1, data: "AA==", identity: "a".repeat(64),
} as const satisfies LocalImageResult;
const unavailable = { ok: false, error: "UNAVAILABLE" } as const;

test("draft image proof uses the exact observed saved version even if it has no picture marker", async () => {
  const jobs: ImageJob[] = [];
  const f = await fixture(fixtureText, { imageReader: {
    read(job) { jobs.push(job); return Promise.resolve(imageResult); }, dispose: () => undefined,
  } });
  try {
    expect(await f.documents.captureReadingImageProof(f.source, () => true)).toBeUndefined();
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    expect(await f.documents.captureReadingImageProof({ ...f.source, expectedHash: "0".repeat(64) }, () => true))
      .toBeUndefined();
    let live = true;
    const pending = f.documents.captureReadingImageProof(f.source, () => live);
    live = false;
    expect(await pending).toBeUndefined();
    const read = await f.documents.captureReadingImageProof(f.source, () => true);
    if (!read) throw Error("missing draft image proof");
    expect(await read(0, "new-draft-image.png", () => true)).toMatchObject({ ok: true, mime: "image/png" });
    expect(jobs.map(job => [job.reference, job.profile])).toEqual([["new-draft-image.png", "reader-snapshot"]]);
    expect((await f.documents.observe({ ...f.observer, active: false })).ok).toBe(true);
    expect(await read(1, "another.png", () => true)).toEqual({ ok: false, error: "STALE" });
    expect(jobs).toHaveLength(1);
    expect(await readFile(f.path, "utf8")).toBe(fixtureText);
  } finally {
    await f.cleanup();
  }
});

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
    const image = await captured.readImage(0, "raster.png", () => childLive);
    if (!image.ok) throw Error(image.error);
    expect(Object.keys(image).sort()).toEqual(["current", "data", "height", "mime", "ok", "sourceCurrent", "width"]);
    expect(image.mime).toBe("image/png");
    expect(image.width).toBe(128);
    expect(Buffer.from(image.data, "base64")).toEqual(png);
    const duplicate = await captured.readImage(1, "raster.png", () => childLive);
    if (!duplicate.ok) throw Error(duplicate.error);
    expect(Buffer.from(duplicate.data, "base64")).toEqual(png);
    expect(await captured.readImage(1, "raster.png", () => childLive)).toEqual(unavailable);
    expect(jobs.map(job => [job.reference, job.profile])).toEqual([
      ["raster.png", "reader-snapshot"], ["raster.png", "reader-snapshot"],
    ]);
    expect(image.current()).toBe(true);
    childLive = false;
    expect(image.current()).toBe(false);
    childLive = true;
    expect(image.current()).toBe(false);
    expect(await captured.readImage(1, "raster.png", () => true)).toEqual({ ok: false, error: "STALE" });
    expect(jobs).toHaveLength(2);
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
      const pending = captured.readImage(0, "raster.png", () => true);
      if (phase !== "before") await entered.promise;
      if (phase === "during") await writeFile(f.path, "![asset](raster.png)\nnew body");
      unblock.resolve(imageResult);
      const result = await pending;
      if (phase === "after") {
        if (!result.ok) throw Error(result.error);
        expect(result.current()).toBe(true);
        await writeFile(f.path, "![asset](raster.png)\nnew body");
        expect(result.current()).toBe(false);
      } else expect(result).toEqual({ ok: false, error: "STALE" });
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
      const pending = captured.readImage(0, "raster.png", () => childLive);
      await entered.promise;
      expect(await captured.readImage(1, "later.png", () => true)).toEqual(unavailable);
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
      expect(await pending).toEqual(cause === "trash" ? unavailable : { ok: false, error: "STALE" });
      const later = await captured.readImage(1, "later.png", () => true);
      if (cause === "trash") expect(later.ok).toBe(true);
      else expect(later).toEqual({ ok: false, error: "STALE" });
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
