import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { incrementalSave } from "../../client/save-channel";
import type { SaveDocumentRequest } from "../../shared/documents";
import type { DocumentSnapshot } from "../../shared/documents";
import { rawHash, rawPatch } from "../../shared/save-content";

import { createBufferMirrors } from "./buffer-mirror";

import { createDocumentService } from ".";

test.skipIf(process.platform !== "darwin")(
  "real native save resynchronizes stale mirror once, then accepts the next incremental save",
  async () => {
    const built = Bun.spawnSync(
      [process.execPath, "scripts/build-save-native.ts"],
      { cwd: fileURLToPath(new URL("../../../", import.meta.url)) }
    );
    expect(built.exitCode).toBe(0);
    const directory = await mkdtemp(join(tmpdir(), "agentic-mirror-native-")),
      path = join(directory, "sample.md");
    await writeFile(path, "\uFEFF原文😀\r\nLF\nCR\r");
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
    });
    try {
      const selected = await service.select({
        protocolVersion: 1,
        requestId: "select",
      });
      if (!selected.ok || !selected.snapshot)
        throw new Error("selection failed");
      let base = selected.snapshot;
      await service.read({
        protocolVersion: 1,
        requestId: "invalidate",
        handle: base.handle,
      });
      const modes: string[] = [];
      for (const revision of [1, 2]) {
        const text = base.text + `保存${revision}`;
        const result = await incrementalSave(
          {
            protocolVersion: 1,
            requestId: `save-${revision}`,
            handle: base.handle,
            documentId: base.documentId,
            expectedRevision: base.revision,
            expectedHash: base.hash,
            bufferRevision: revision,
          },
          base,
          text,
          (req) => service.save(req),
          (data) => modes.push(data.mode)
        );
        expect(result.response).toMatchObject({
          ok: true,
          savedBufferRevision: revision,
        });
        base = (result.response as { snapshot: DocumentSnapshot }).snapshot;
        expect(await readFile(path, "utf8")).toBe(text);
        expect(base.hash).toBe(await rawHash(text));
      }
      expect(modes).toEqual(["patch", "resync", "patch"]);
    } finally {
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

test("bounded mirrors reject stale tokens, verify hashes, and recover exact raw captured content", async () => {
  const store = createBufferMirrors(1),
    handle = crypto.randomUUID();
  const before = "\uFEFF中文😀\r\nB\nC\r",
    text = "\uFEFF中文😁\r\nB\nC\r";
  const mirror = store.put(handle, before, 0);
  const request: SaveDocumentRequest = {
    protocolVersion: 1,
    requestId: "patch",
    handle,
    documentId: crypto.randomUUID(),
    expectedRevision: 1,
    expectedHash: await rawHash(before),
    bufferRevision: 1,
    mirror,
    content: {
      kind: "patch",
      ...rawPatch(before, text),
      targetHash: await rawHash(text),
    },
  };
  expect(store.prepare(request)).toEqual({ ok: true, text });
  expect(
    store.prepare({
      ...request,
      content: { ...request.content, targetHash: "a".repeat(64) },
    })
  ).toEqual({ ok: false, error: "INVALID_REQUEST" });
  expect(
    store.prepare({
      ...request,
      content: {
        kind: "patch",
        from: 4,
        to: 4,
        insert: "x",
        targetHash: await rawHash(text),
      },
    })
  ).toEqual({ ok: false, error: "INVALID_REQUEST" });
  store.put(crypto.randomUUID(), "evicts previous", 0);
  const failed = store.prepare(request);
  expect(failed.ok).toBe(false);
  if (failed.ok || failed.error !== "MIRROR_MISMATCH")
    throw new Error("expected mismatch");
  const resync = {
    ...request,
    mirror: failed.recovery,
    content: { kind: "resync" as const, text, targetHash: await rawHash(text) },
  };
  expect(store.prepare({ ...resync, bufferRevision: 2 })).toEqual({
    ok: false,
    error: "INVALID_REQUEST",
  });
  expect(store.prepare(resync)).toEqual({ ok: true, text });
  expect(store.prepare(resync).ok).toBe(false);
  store.clear();
  expect(store.prepare(request).ok).toBe(false);
});

test("mirror mismatch never writes; recovery remains subject to disk conflict and target integrity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentic-mirror-")),
    path = join(directory, "sample.md");
  const before = "\uFEFFold\r\n",
    text = "\uFEFFnew😀\r\n";
  await writeFile(path, before);
  let writes = 0;
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
    capability: () => Promise.resolve({ writable: true, reason: "writable" }),
    write: () => {
      writes++;
      return Promise.resolve({ ok: false, error: "SAVE_FAILED" });
    },
  });
  try {
    const selected = await service.select({
      protocolVersion: 1,
      requestId: "select",
    });
    if (!selected.ok || !selected.snapshot) throw new Error("missing snapshot");
    const base = selected.snapshot;
    const request: SaveDocumentRequest = {
      protocolVersion: 1,
      requestId: "save",
      handle: base.handle,
      documentId: base.documentId,
      expectedRevision: base.revision,
      expectedHash: base.hash,
      bufferRevision: 1,
      mirror: base.mirror!,
      content: {
        kind: "patch",
        ...rawPatch(before, text),
        targetHash: await rawHash(text),
      },
    };
    await service.read({
      protocolVersion: 1,
      requestId: "reread",
      handle: base.handle,
    });
    const rejected = await service.save(request);
    expect(rejected.ok).toBe(false);
    expect(writes).toBe(0);
    if (rejected.ok || !rejected.recovery) throw new Error("missing recovery");
    expect(await readFile(path, "utf8")).toBe(before);
    const retry = await service.save({
      ...request,
      requestId: "retry",
      mirror: rejected.recovery,
      content: { kind: "resync", text, targetHash: await rawHash(text) },
    });
    expect(retry).toMatchObject({ ok: false, error: "SAVE_FAILED" });
    expect(writes).toBe(1);
    await writeFile(path, "external");
    expect(await service.save(request)).toMatchObject({
      ok: false,
      error: "CONFLICT",
    });
    expect(writes).toBe(1);
    expect(await readFile(path, "utf8")).toBe("external");
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
