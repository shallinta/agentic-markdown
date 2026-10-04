import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, rename, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObservationEvent } from "../../shared/document-observation";
import { MAX_DOCUMENT_BYTES, type DocumentSnapshot } from "../../shared/documents";
import { rawPatch } from "../../shared/save-content";
import { analyzeTextFidelity } from "../../shared/text-fidelity";

import { authorizeSingleFile, verifySingleFileAuthorization } from "./path-authorization";
import { createRefreshCandidates, type RefreshBinding, type RefreshContext } from "./refresh-candidates";

import { createDocumentService, type TrustedDocumentService } from ".";

const request = () => ({ protocolVersion: 1 as const, requestId: crypto.randomUUID() });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const binding = (s: DocumentSnapshot): RefreshBinding => ({ handle: s.handle, documentId: s.documentId, expectedRevision: s.revision, expectedHash: s.hash });
async function select(service: TrustedDocumentService) {
  const result = await service.select(request());
  if (!result.ok || !result.snapshot) throw Error("select failed");
  return result.snapshot;
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(5);
  expect(check()).toBe(true);
}
const save = (service: TrustedDocumentService, s: DocumentSnapshot, text: string) => service.save({ ...request(), ...binding(s), bufferRevision: 1, mirror: s.mirror!, content: { kind: "patch", ...rawPatch(s.text, text), targetHash: hash(text) } });

test("real candidates preserve fidelity and baseline/mirror; binding is not latest disk proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-refresh-")), path = join(root, "a.md");
  await writeFile(path, "original\n");
  const events: ObservationEvent[] = [];
  const service = createDocumentService({ pickFile: () => Promise.resolve(path), onExternalChanged: event => events.push(event) });
  try {
    const s = await select(service), old = structuredClone(s);
    expect(await service.readRefreshCandidate(binding(s))).toEqual({ ok: true, candidate: null });
    const external = "\ufeff中文\r\nEnglish\n";
    await writeFile(path, external);
    const result = await service.readRefreshCandidate(binding(s));
    if (!result.ok || !result.candidate) throw Error("candidate missing");
    const c = result.candidate, token = c.token;
    expect(c.text).toBe(external); expect(c.hash).toBe(hash(external));
    expect(c.fidelity).toEqual(analyzeTextFidelity(external));
    expect(c.byteLength).toBe(Buffer.byteLength(external));
    expect(c).not.toHaveProperty("revision"); expect(c).not.toHaveProperty("mirror");
    c.handle = crypto.randomUUID(); c.documentId = crypto.randomUUID(); c.expectedHash = "f".repeat(64); c.token = crypto.randomUUID(); c.text = "mutated"; c.fidelity.bom = false;
    expect(await service.checkRefreshCandidateBinding(token)).toBe(true);
    await writeFile(path, "newer external");
    expect(await service.checkRefreshCandidateBinding(token)).toBe(true); // binding only
    expect(s).toEqual(old);
    expect((await service.observe({ ...request(), ...binding(s), expectedHash: undefined })).ok).toBe(false);
    expect((await service.observe({ ...request(), active: true, handle: s.handle, documentId: s.documentId, revision: s.revision, hash: s.hash, watchToken: crypto.randomUUID(), watchEpoch: 1 })).ok).toBe(true);
    await until(() => events.some(event => event.status === "content-changed"));
    expect(events[0].revision).toBe(s.revision); expect(events[0].hash).toBe(s.hash);
    const failed = await save(service, s, "local");
    expect(failed.ok).toBe(false); if (!failed.ok) expect(failed.error).toBe("CONFLICT");
    expect(await service.checkRefreshCandidateBinding(token)).toBe(false);
    const fresh = await service.readRefreshCandidate(binding(s));
    if (!fresh.ok || !fresh.candidate) throw Error();
    service.discardRefreshCandidate(s.handle);
    expect(await service.checkRefreshCandidateBinding(fresh.candidate.token)).toBe(false);
    const read = await service.read({ ...request(), handle: s.handle });
    expect(read.ok && read.snapshot?.revision).toBe(s.revision + 1);
    expect(read.ok && read.snapshot?.text).toBe("newer external");
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("candidate failure cannot adopt replacement, invalid bytes or over-limit content", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-refresh-errors-")), path = join(root, "a.md");
  await writeFile(path, "old");
  const service = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    const s = await select(service);
    expect(await service.readRefreshCandidate({ ...binding(s), path })).toEqual({ ok: false, error: "INVALID_REQUEST" });
    expect(await service.readRefreshCandidate({ ...binding(s), expectedHash: "0".repeat(64) })).toEqual({ ok: false, error: "CONFLICT" });
    await writeFile(path, Buffer.from([0xff]));
    expect(await service.readRefreshCandidate(binding(s))).toEqual({ ok: false, error: "INVALID_UTF8" });
    await writeFile(path, "x".repeat(MAX_DOCUMENT_BYTES + 1));
    expect(await service.readRefreshCandidate(binding(s))).toEqual({ ok: false, error: "TOO_LARGE" });
    await rename(path, join(root, "held.md"));
    expect((await service.readRefreshCandidate(binding(s))).ok).toBe(false);
    await writeFile(path, "replacement");
    expect(await service.readRefreshCandidate(binding(s))).toEqual({ ok: false, error: "FILE_CHANGED" });
    expect(service.locations()[0].documentId).toBe(s.documentId);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("release and root revocation settle paused candidate without invalidating unrelated grants", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-refresh-release-")), path = join(root, "a.md");
  await writeFile(path, "old");
  let pause = false, entered = false, finish = () => { /* No held read yet. */ };
  const service = createDocumentService({ pickFile: () => Promise.resolve(path), verify: async grant => {
    if (pause) { entered = true; await new Promise<void>(resolve => { finish = resolve; }); }
    return verifySingleFileAuthorization(grant);
  } });
  try {
    const s = await select(service);
    await writeFile(path, "external"); pause = true;
    const pending = service.readRefreshCandidate(binding(s)); await until(() => entered);
    await service.release({ ...request(), handle: s.handle });
    expect(await pending).toEqual({ ok: false, error: "CANCELLED" });
    pause = false; finish();
    const standalone = await select(service);
    const scope = { verify: () => Promise.resolve() };
    const opened = await service.openAuthorized(request(), () => authorizeSingleFile(path), scope);
    if (!opened.ok || !opened.snapshot) throw Error();
    // Explicit standalone reopens intentionally detach root scope; use another leaf.
    const other = join(root, "b.md"); await writeFile(other, "b");
    const scoped = await service.openAuthorized(request(), () => authorizeSingleFile(other), scope);
    if (!scoped.ok || !scoped.snapshot) throw Error();
    await writeFile(other, "b external");
    const candidate = await service.readRefreshCandidate(binding(scoped.snapshot));
    if (!candidate.ok || !candidate.candidate) throw Error();
    service.revokeScope(scope);
    expect(await service.checkRefreshCandidateBinding(candidate.candidate.token)).toBe(false);
    expect((await service.readRefreshCandidate(binding(standalone))).ok).toBe(true);
  } finally { pause = false; finish(); await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("ancestor replacement is denied without deleting document grant", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-refresh-parent-")), dir = join(root, "parent"), path = join(dir, "a.md");
  await mkdir(dir); await writeFile(path, "old");
  const service = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    const s = await select(service); await rename(dir, join(root, "held")); await mkdir(dir); await writeFile(path, "new");
    expect((await service.readRefreshCandidate(binding(s))).ok).toBe(false);
    expect(service.locations()[0].documentId).toBe(s.documentId);
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("latest-only queue bounds storm, cancels all promises and respects foreground/save admission", async () => {
  let allowed = false, finish = () => { /* No held read yet. */ }, entered = 0;
  const queue = createRefreshCandidates(() => allowed, () => "READ_FAILED");
  const id = crypto.randomUUID(), handle = crypto.randomUUID();
  const context = (documentId = id): RefreshContext => ({
    binding: { handle, documentId, expectedRevision: 1, expectedHash: hash("old") }, current: () => true,
    verify: () => Promise.resolve(),
    read: async () => { entered++; await new Promise<void>(resolve => { finish = resolve; }); return { text: "new", hash: hash("new"), byteLength: 3, fidelity: analyzeTextFidelity("new") }; },
  });
  try {
    const work = Array.from({ length: 300 }, () => queue.request(context()));
    expect(queue.stats()).toEqual({ retained: 0, pending: 1, running: false });
    expect((await Promise.all(work.slice(0, -1))).every(r => !r.ok && r.error === "CANCELLED")).toBe(true);
    allowed = true; queue.wake(); await until(() => entered === 1);
    const b = queue.request(context(crypto.randomUUID()));
    const newest = queue.request(context());
    expect(await work[299]).toEqual({ ok: false, error: "CANCELLED" });
    expect(queue.stats().pending).toBe(2);
    allowed = false; finish(); await Bun.sleep(5); expect(entered).toBe(1);
    queue.dispose();
    expect(await b).toEqual({ ok: false, error: "CANCELLED" });
    expect(await newest).toEqual({ ok: false, error: "CANCELLED" });
    expect(queue.stats().retained).toBe(0); expect(queue.stats().pending).toBe(0);
  } finally { finish(); queue.dispose(); }
});

test("save proceeds during paused candidate and invalidates old generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-refresh-save-")), path = join(root, "a.md");
  await writeFile(path, "old");
  let paused = false, entered = false, finish = () => { /* No held read yet. */ };
  const service = createDocumentService({ pickFile: () => Promise.resolve(path),
    verify: async grant => { if (paused) { entered = true; await new Promise<void>(resolve => { finish = resolve; }); } return verifySingleFileAuthorization(grant); },
    write: async input => { await writeFile(path, input.text); return { ok: true, fingerprint: input.authorization.fingerprint, hash: hash(input.text), byteLength: Buffer.byteLength(input.text) }; },
  });
  try {
    const s = await select(service); paused = true;
    const pending = service.readRefreshCandidate(binding(s)); await until(() => entered);
    const saved = await save(service, s, "saved"); expect(saved.ok).toBe(true);
    expect(await pending).toEqual({ ok: false, error: "CANCELLED" });
    paused = false; finish();
    expect(await service.readRefreshCandidate(binding(s))).toEqual({ ok: false, error: "CONFLICT" });
  } finally { paused = false; finish(); await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("binding checks coalesce per candidate, use one global verifier and settle on disposal", async () => {
  let entered = 0, active = 0, maximum = 0, finish = () => { /* No held check yet. */ };
  const queue = createRefreshCandidates(() => true, () => "READ_FAILED");
  const tokens: string[] = [];
  try {
    for (let n = 0; n < 12; n++) {
      const result = await queue.request({
        binding: { handle: crypto.randomUUID(), documentId: crypto.randomUUID(), expectedRevision: 1, expectedHash: hash("old") },
        current: () => true,
        read: () => Promise.resolve({ text: "new", hash: hash("new"), byteLength: 3, fidelity: analyzeTextFidelity("new") }),
        verify: async () => { entered++; active++; maximum = Math.max(maximum, active); await new Promise<void>(resolve => { finish = resolve; }); active--; },
      });
      if (!result.ok || !result.candidate) throw Error();
      tokens.push(result.candidate.token);
    }
    const first = Array.from({ length: 300 }, () => queue.checkBinding(tokens[0]));
    const remaining = tokens.slice(1).map(token => queue.checkBinding(token));
    expect(first.every(promise => promise === first[0])).toBe(true);
    expect(entered).toBe(1); finish();
    expect((await Promise.all(first)).every(Boolean)).toBe(true);
    await until(() => entered === 2);
    expect(maximum).toBe(1);
    queue.dispose();
    expect((await Promise.all(remaining)).every(value => !value)).toBe(true);
    finish(); await Bun.sleep(5); expect(entered).toBe(2);
  } finally { finish(); queue.dispose(); }
});
