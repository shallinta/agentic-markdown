import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObservationRequest } from "../../shared/document-observation";
import { READER_SNAPSHOT_MAX_BYTES } from "../../shared/reader-snapshot";

import { createDocumentService } from ".";

const fixtureText = "\uFEFF# 阅读 📖\r\n`反引号` \\\" <script>样本</script>\r\n";

async function fixture(text = fixtureText) {
  const directory = await mkdtemp(join(tmpdir(), "agentic-reading-snapshot-"));
  const path = join(directory, "sample.md");
  // Keep watcher timing separate from the real descriptor verification below.
  const documents = createDocumentService({
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
    return { directory, path, documents, source, observer, cleanup };
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
