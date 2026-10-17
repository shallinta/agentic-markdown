import { expect, test, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { watch, type FSWatcher } from "node:fs";
import { mkdtemp, writeFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LocalImageResult } from "../../shared/local-images";
import { rawPatch } from "../../shared/save-content";

import { atomicSave } from "./atomic-save";
import { authorizeSingleFile } from "./path-authorization";

import { createDocumentService } from ".";

const request = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});

test("post-close watcher exception cannot stop remaining cleanup or undo the committed receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-cleanup-"));
  const path = join(directory, "a.md");
  await writeFile(path, "A");
  const probe = watch(path, { persistent: false });
  const prototype = Object.getPrototypeOf(probe) as Pick<FSWatcher, "close">;
  const close = prototype.close;
  probe.close();
  const service = createDocumentService({ pickFile: () => Promise.resolve(path) });
  let hook: { mockRestore(): void } | undefined;
  try {
    const opened = await service.select(request());
    if (!opened.ok || !opened.snapshot) throw Error();
    const a = opened.snapshot;
    const lease = await service.acquireFolderMutationLease();
    if (!lease) throw Error();
    const prepared = await lease.prepare([{ handle: a.handle, action: "revoke" }]);
    let closed = 0, receipt = false;
    hook = spyOn(prototype, "close").mockImplementation(function(this: FSWatcher) {
      close.call(this); closed++;
      if (closed === 1) throw Error("injected after actual watcher close");
    });
    prepared.commit(() => { receipt = true; });
    hook.mockRestore(); hook = undefined;
    expect(receipt).toBe(true);
    expect(closed).toBe(2);
    lease.release();
    expect(service.locations()).toHaveLength(0);
    expect(await service.select(request())).toMatchObject({ ok: true });
  } finally { hook?.mockRestore(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("pre-lease observation and capability completions cannot publish after the lease releases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-late-"));
  const path = join(directory, "a.md");
  await writeFile(path, "A");
  const probed = Promise.withResolvers<void>(), probeResume = Promise.withResolvers<void>();
  const checked = Promise.withResolvers<void>(), capabilityResume = Promise.withResolvers<void>();
  let blockCapability = false, events = 0;
  const service = createDocumentService({ pickFile: () => Promise.resolve(path),
    capability: async () => { if (blockCapability) { checked.resolve(); await capabilityResume.promise; } return { writable: true, reason: "writable" }; },
    probe: async () => { probed.resolve(); await probeResume.promise; return { status: "unchanged" }; },
    onExternalChanged: () => { events++; },
  });
  try {
    const opened = await service.select(request());
    if (!opened.ok || !opened.snapshot) throw Error();
    const a = opened.snapshot;
    await service.observe({ ...request(), active: true, handle: a.handle, documentId: a.documentId, hash: a.hash, revision: a.revision, watchToken: crypto.randomUUID(), watchEpoch: 1 });
    await probed.promise;
    blockCapability = true;
    const capability = service.checkWriteCapability({ ...request(), handle: a.handle });
    await checked.promise;
    const lease = await service.acquireFolderMutationLease();
    if (!lease) throw Error();
    expect(await service.checkWriteCapability({ ...request(), handle: a.handle })).toMatchObject({ capability: { writable: false } });
    lease.release();
    probeResume.resolve(); capabilityResume.resolve();
    expect(await capability).toMatchObject({ capability: { writable: false, reason: "unavailable" } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(events).toBe(0);
  } finally { probeResume.resolve(); capabilityResume.resolve(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("kept grant invalidates its old candidate without requiring access during the lease", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-candidate-"));
  const path = join(directory, "a.md");
  await writeFile(path, "A");
  const service = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    const opened = await service.select(request());
    if (!opened.ok || !opened.snapshot) throw Error();
    const a = opened.snapshot;
    const binding = { handle: a.handle, documentId: a.documentId, expectedRevision: a.revision, expectedHash: a.hash };
    await writeFile(path, "B");
    const candidate = await service.readRefreshCandidate(binding);
    if (!candidate.ok || !candidate.candidate) throw Error("candidate missing");
    expect(await service.checkRefreshCandidateBinding(candidate.candidate.token)).toBe(true);
    const lease = await service.acquireFolderMutationLease();
    if (!lease) throw Error();
    const prepared = await lease.prepare([{ handle: a.handle, action: "retain" }]);
    prepared.commit(() => { /* old token tested after release */ });
    lease.release();
    expect(await service.checkRefreshCandidateBinding(candidate.candidate.token)).toBe(false);
    expect(await service.readRefreshCandidate(binding)).toMatchObject({ ok: true, candidate: { text: "B" } });
  } finally { await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("a successful old image result cannot regain the kept grant's superseded asset scope", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-image-"));
  const path = join(directory, "a.md");
  await writeFile(path, "A");
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  let pause = false;
  const image: LocalImageResult = { ok: true, mime: "image/png", data: "AAAA", width: 1, height: 1, identity: "a".repeat(64) };
  const service = createDocumentService({ pickFile: () => Promise.resolve(path), imageReader: { read: async () => { if (pause) { entered.resolve(); await resume.promise; } return image; }, dispose: () => { /* injected reader owns no resources */ } } });
  try {
    const opened = await service.select(request());
    if (!opened.ok || !opened.snapshot) throw Error();
    const a = opened.snapshot;
    const read = () => service.readLocalImage({ ...request(), handle: a.handle, reference: "image.png" });
    expect(await read()).toMatchObject(image);
    pause = true;
    const late = read();
    await entered.promise;
    const lease = await service.acquireFolderMutationLease();
    if (!lease) throw Error();
    const active = { ...request(), active: true, handle: a.handle, documentId: a.documentId, hash: a.hash, revision: a.revision, watchToken: crypto.randomUUID(), watchEpoch: 1 };
    expect(await service.observe(active)).toMatchObject({ ok: false });
    const prepared = await lease.prepare([{ handle: a.handle, action: "retain" }]);
    prepared.commit(() => { /* scope transition complete */ });
    lease.release();
    pause = false; resume.resolve();
    expect(await late).toMatchObject({ ok: false, error: "UNAVAILABLE" });
    expect(await read()).toMatchObject(image);
    expect(await service.observe({ ...active, requestId: crypto.randomUUID() })).toMatchObject({ ok: true });
  } finally { resume.resolve(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("folder lease waits for an admitted real atomic save and then binds its completed identity", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-save-"));
  const path = join(directory, "a.md");
  await writeFile(path, "A");
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const service = createDocumentService({ pickFile: () => Promise.resolve(path), write: async input => { entered.resolve(); await resume.promise; return atomicSave(input); } });
  try {
    const opened = await service.select(request());
    if (!opened.ok || !opened.snapshot) throw Error();
    const a = opened.snapshot;
    const saving = service.save({ ...request(), handle: a.handle, documentId: a.documentId, expectedHash: a.hash, expectedRevision: a.revision, bufferRevision: 1, mirror: a.mirror, content: { kind: "patch", ...rawPatch("A", "B"), targetHash: createHash("sha256").update("B").digest("hex") } });
    await entered.promise;
    let settled = false;
    const acquiring = service.acquireFolderMutationLease().then(value => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(await service.select(request())).toMatchObject({ ok: false, error: "BUSY" });
    resume.resolve();
    expect(await saving).toMatchObject({ ok: true });
    const lease = await acquiring;
    if (!lease) throw Error("lease absent after save");
    expect(lease.bindings()[0]).toMatchObject({ handle: a.handle, documentId: a.documentId });
    const prepared = await lease.prepare([{ handle: a.handle, action: "retain" }]);
    prepared.commit(() => { /* receipt checked by read after release */ });
    lease.release();
    expect(await service.read({ ...request(), handle: a.handle })).toMatchObject({ ok: true, snapshot: { text: "B", documentId: a.documentId } });
  } finally { resume.resolve(); await service.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test("folder lease survives caller returns, preserves kept identity, and blocks competing operations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-lease-"));
  const path = join(directory, "a.md");
  await writeFile(path, "A");
  const scope = { verify: () => Promise.resolve() };
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
  });
  try {
    const opened = await service.openAuthorized(
      request(),
      () => authorizeSingleFile(path),
      scope
    );
    if (!opened.ok || !opened.snapshot) throw Error();
    const a = opened.snapshot;
    const lease = await service.acquireFolderMutationLease();
    if (!lease) throw Error();
    expect(await service.acquireFolderMutationLease()).toBeNull();
    expect(await service.select(request())).toMatchObject({
      ok: false,
      error: "BUSY",
    });
    expect(
      await service.read({ ...request(), handle: a.handle })
    ).toMatchObject({ ok: false, error: "BUSY" });
    const before = service.assetEpochs();
    expect(service.assetEpochs()).toEqual(before);
    const prepared = await lease.prepare([
      { handle: a.handle, action: "standalone" },
    ]);
    let receipt = false;
    prepared.commit(() => {
      receipt = true;
    });
    expect(receipt).toBe(true);
    expect(lease.current()).toBe(true);
    lease.release();
    service.revokeScope(scope);
    expect(service.locations().map((item) => item.handle)).toEqual([a.handle]);
    const read = await service.read({ ...request(), handle: a.handle });
    expect(read).toMatchObject({
      ok: true,
      snapshot: {
        handle: a.handle,
        documentId: a.documentId,
        revision: a.revision,
        explicitStandalone: true,
        text: "A",
      },
    });
    expect(service.assetEpochs()[a.handle]).not.toBe(before[a.handle]);
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("missing root-only file can revoke by retained memory identity; promotion never reauthorizes it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-missing-"));
  const path = join(directory, "a.md");
  await writeFile(path, "A");
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
  });
  try {
    const opened = await service.openAuthorized(
      request(),
      () => authorizeSingleFile(path),
      { verify: () => Promise.resolve() }
    );
    if (!opened.ok || !opened.snapshot) throw Error();
    const a = opened.snapshot;
    await unlink(path);
    const lease = await service.acquireFolderMutationLease();
    if (!lease) throw Error();
    expect(
      lease.prepare([{ handle: a.handle, action: "standalone" }])
    ).rejects.toThrow();
    expect(service.locations()).toHaveLength(1);
    const revoke = await lease.prepare([
      { handle: a.handle, action: "revoke" },
    ]);
    revoke.commit(() => { /* receipt observed through locations below */ });
    expect(service.locations()).toHaveLength(0);
    lease.release();
  } finally {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
