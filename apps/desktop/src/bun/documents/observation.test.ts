import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rename, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObservationEvent } from "../../shared/document-observation";
import { rawPatch } from "../../shared/save-content";

import { createObservationQueue } from "./observation-queue";
import { observeFile } from "./observe-file";
import { authorizeSingleFile } from "./path-authorization";

import { createDocumentService } from ".";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const request = () => ({ protocolVersion: 1 as const, requestId: crypto.randomUUID() });
test("more than 256 subscription lifetimes remain usable and retired epochs never revive", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-observe-epochs-"));
  const path = join(root, "a.md"); await writeFile(path, "old");
  const service = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    const selected = await service.select(request());
    if (!selected.ok || !selected.snapshot) throw Error();
    const snap = selected.snapshot;
    const base = { ...request(), active: true, handle: snap.handle, documentId: snap.documentId, revision: snap.revision, hash: snap.hash };
    for (let epoch = 1; epoch <= 300; epoch++) {
      const binding = { ...base, watchEpoch: epoch, watchToken: crypto.randomUUID() };
      expect((await service.observe(binding)).ok).toBe(true);
      expect((await service.observe({ ...binding, active: false })).ok).toBe(true);
      expect((await service.observe(binding)).ok).toBe(false);
    }
    expect((await service.observe({ ...base, watchEpoch: 301, watchToken: crypto.randomUUID() })).ok).toBe(true);
    expect((await service.observe({ ...base, watchEpoch: 1, watchToken: crypto.randomUUID() })).ok).toBe(false);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(10); expect(check()).toBe(true); }
test("observer distinguishes unchanged/content/missing/replaced, ancestor loss unavailable and never adopts target", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-observe-"));
  const dir = join(root, "parent"); await mkdir(dir);
  const path = join(dir, "a.md"); await writeFile(path, "old");
  const grant = await authorizeSingleFile(path);
  try {
    expect((await observeFile(grant, hash("old"), () => true)).status).toBe("unchanged");
    await writeFile(path, "external");
    expect((await observeFile(grant, hash("old"), () => true)).status).toBe("content-changed");
    await unlink(path);
    expect((await observeFile(grant, hash("old"), () => true)).status).toBe("missing");
    await writeFile(path, "new identity");
    expect((await observeFile(grant, hash("old"), () => true)).status).toBe("replaced");
    await rename(dir, join(root, "gone"));
    expect((await observeFile(grant, hash("old"), () => true)).status).toBe("unavailable");
    expect((await observeFile(grant, hash("old"), () => false)).status).toBe("unavailable");
  } finally { await grant.file.close(); await rm(root, { recursive: true, force: true }); }
});
test("subscription observes actual filesystem without baseline commit; close invalidates paused result", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-observe-service-"));
  const path = join(root, "a.md"); await writeFile(path, "old");
  const events: ObservationEvent[] = [];
  let paused: (() => void) | undefined;
  let hold = false;
  const service = createDocumentService({ pickFile: () => Promise.resolve(path), onExternalChanged: event => events.push(event),
    probe: async (...args) => { if (hold) await new Promise<void>(resolve => { paused = resolve; }); return observeFile(...args); },
  });
  try {
    const selected = await service.select(request()); if (!selected.ok || !selected.snapshot) throw Error();
    const snap = selected.snapshot;
    const binding = { ...request(), active: true, handle: snap.handle, documentId: snap.documentId, revision: snap.revision, hash: snap.hash, watchToken: crypto.randomUUID(), watchEpoch: 1 };
    await service.observe(binding); await until(() => events.length === 1);
    expect(events[0].status).toBe("unchanged");
    await service.observe({ ...binding, ...request() });
    await until(() => events.length === 2);
    expect(events[1].status).toBe("unchanged");
    expect(events[1].generation).toBeGreaterThan(events[0].generation);
    await writeFile(path, "external"); await until(() => events.some(e => e.status === "content-changed"));
    expect(events[events.length - 1]?.hash).toBe(snap.hash); expect(events[events.length - 1]?.revision).toBe(snap.revision);
    hold = true; await service.observe({ ...binding, ...request() }); await until(() => !!paused);
    const count = events.length;
    await service.observe({ ...binding, ...request(), active: false }); paused!(); await Bun.sleep(100);
    expect(events.length).toBe(count);
    const reread = await service.read({ ...request(), handle: snap.handle });
    expect(reread.ok && reread.snapshot?.revision).toBe(snap.revision + 1);
  } finally { paused?.(); await service.dispose(); await rm(root, { recursive: true, force: true }); }
});
test("hint storm stays bounded, paused saves take priority and cancelled work cannot publish itself", async () => {
  let writable = false, finish!: () => void;
  const runs: string[] = [];
  const queue = createObservationQueue(async key => { runs.push(key); await new Promise<void>(resolve => { finish = resolve; }); }, () => writable);
  try {
    queue.add("a"); queue.add("b");
    for (let i = 0; i < 300; i++) queue.add(`extra-${i}`);
    expect(queue.size().subscriptions).toBe(302);
    for (let i = 0; i < 300; i++) queue.remove(`extra-${i}`);
    for (let i = 0; i < 1000; i++) queue.hint("a");
    await Bun.sleep(80); expect(runs).toEqual([]); expect(queue.size().pending).toBe(2);
    writable = true; await until(() => runs.length === 1);
    for (let i = 0; i < 1000; i++) queue.hint("a");
    expect(queue.size().pending).toBe(2);
    queue.remove("a"); queue.remove("b"); finish(); await Bun.sleep(80);
    expect(runs.length).toBe(1);
  } finally { queue.dispose(); }
});

test("save supersedes paused old probe, checked durable echo is quiet but adjacent external write is detected", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-observe-save-"));
  const path = join(root, "a.md"); await writeFile(path, "old");
  const events: ObservationEvent[] = [];
  let release!: () => void, entered = false, hold = true;
  const service = createDocumentService({ pickFile: () => Promise.resolve(path), onExternalChanged: value => events.push(value),
    probe: async (...args) => {
      const result = await observeFile(...args);
      if (hold) { entered = true; await new Promise<void>(resolve => { release = resolve; }); }
      return result;
    },
    write: async input => { await writeFile(path, input.text); return { ok: true, fingerprint: input.authorization.fingerprint, hash: hash(input.text), byteLength: Buffer.byteLength(input.text) }; },
  });
  try {
    const selected = await service.select(request()); if (!selected.ok || !selected.snapshot) throw Error();
    const snap = selected.snapshot, token = crypto.randomUUID();
    const binding = { ...request(), active: true, handle: snap.handle, documentId: snap.documentId, revision: snap.revision, hash: snap.hash, watchToken: token, watchEpoch: 1 };
    await service.observe(binding); await until(() => entered);
    const saved = await service.save({ ...request(), handle: snap.handle, documentId: snap.documentId, expectedRevision: snap.revision, expectedHash: snap.hash, bufferRevision: 1, mirror: snap.mirror!, content: { kind: "patch", ...rawPatch(snap.text, "saved"), targetHash: hash("saved") } });
    expect(saved.ok).toBe(true); if (!saved.ok) throw Error();
    hold = false; release(); await Bun.sleep(80); expect(events.length).toBe(0);
    const latest = { ...binding, ...request(), revision: saved.snapshot.revision, hash: saved.snapshot.hash };
    await service.observe(latest); await until(() => events.length === 1);
    expect(events[0].status).toBe("unchanged"); expect(events[0].revision).toBe(2);
    await writeFile(path, "adjacent external"); await until(() => events.some(event => event.status === "content-changed"));
    expect(events.every(event => event.revision === 2)).toBe(true);
    await service.observe({ ...latest, ...request(), active: false });
    expect((await service.observe({ ...latest, ...request() })).ok).toBe(false);
  } finally { release?.(); await service.dispose(); await rm(root, { recursive: true, force: true }); }
});
