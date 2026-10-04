import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, stat, rm, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DocumentSnapshot } from "../../shared/documents";
import { rawPatch } from "../../shared/save-content";

import { authorizeSingleFile, verifySingleFileAuthorization } from "./path-authorization";
import { createRefreshAcceptanceLedger, type RefreshAcceptanceRequest } from "./refresh-acceptance";

import { createDocumentService, type TrustedDocumentService } from ".";

const request = () => ({ protocolVersion: 1 as const, requestId: crypto.randomUUID() });
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const binding = (s: DocumentSnapshot) => ({ handle: s.handle, documentId: s.documentId, expectedRevision: s.revision, expectedHash: s.hash });
async function opened(service: TrustedDocumentService) {
  const result = await service.select(request()); if (!result.ok || !result.snapshot) throw Error("open failed"); return result.snapshot;
}
async function operation(service: TrustedDocumentService, s: DocumentSnapshot, sequence = 1): Promise<RefreshAcceptanceRequest> {
  const result = await service.readRefreshCandidate(binding(s)); if (!result.ok || !result.candidate) throw Error("candidate failed");
  return { handle: s.handle, token: result.candidate.token, operationId: crypto.randomUUID(), sequence };
}
const save = (service: TrustedDocumentService, s: DocumentSnapshot, text: string) => service.save({ ...request(), ...binding(s), bufferRevision: 1, mirror: s.mirror!, content: { kind: "patch", ...rawPatch(s.text, text), targetHash: hash(text) } });
async function until(check: () => boolean) { for (let i = 0; i < 100 && !check(); i++) await Bun.sleep(5); expect(check()).toBe(true); }

test("accept is read-only on disk, idempotent, clone-isolated; historical success survives native save/read", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-accept-basic-")), path = join(root, "a.md");
  await writeFile(path, "old\n"); const service = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    const base = await opened(service); await writeFile(path, "\ufeff外部\r\n");
    const op = await operation(service, base), before = await stat(path);
    const replies = await Promise.all(Array.from({ length: 20 }, () => service.acceptRefreshCandidate(op)));
    const accepted = replies[0]; if (accepted.status !== "committed") throw Error(JSON.stringify(accepted));
    expect(replies.every(value => value.status === "committed" && value.snapshot.revision === base.revision + 1)).toBe(true);
    const snapshot = structuredClone(accepted.snapshot);
    expect(snapshot.text).toBe("\ufeff外部\r\n"); expect(snapshot.hash).toBe(hash(snapshot.text));
    expect(snapshot.mirror?.token).not.toBe(base.mirror?.token);
    expect(await readFile(path, "utf8")).toBe(snapshot.text); expect((await stat(path)).ino).toBe(before.ino);
    accepted.snapshot.text = "mutated"; accepted.snapshot.fidelity.bom = false; accepted.snapshot.mirror!.token = "mutated";
    expect(service.queryRefreshAcceptance(op)).toEqual({ status: "committed", snapshot });
    expect((await service.acceptRefreshCandidate(op))).toEqual({ status: "committed", snapshot });
    const stale = await save(service, base, "old overwrite"); expect(stale.ok).toBe(false);
    const saved = await save(service, snapshot, "native saved\n"); expect(saved.ok).toBe(true);
    expect(await readFile(path, "utf8")).toBe("native saved\n"); expect((await stat(path)).ino).not.toBe(before.ino);
    const reread = await service.read({ ...request(), handle: base.handle });
    expect(reread.ok && reread.snapshot?.revision).toBe(base.revision + 2);
    expect(service.queryRefreshAcceptance(op)).toEqual({ status: "committed", snapshot }); // historical, not current baseline proof
    expect(await service.acceptRefreshCandidate(op)).toEqual({ status: "committed", snapshot });
    expect(await readFile(path, "utf8")).toBe("native saved\n");
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("hash changed again, discarded candidate, replacement and revoked scope never commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-accept-deny-")), path = join(root, "a.md");
  await writeFile(path, "old"); const service = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    const base = await opened(service); await writeFile(path, "external");
    const op = await operation(service, base); await writeFile(path, "newer");
    expect(await service.acceptRefreshCandidate(op)).toEqual({ status: "rejected", error: "FILE_CHANGED" });
    const discarded = await operation(service, base, 2); service.discardRefreshCandidate(base.handle);
    expect(await service.acceptRefreshCandidate(discarded)).toEqual({ status: "rejected", error: "INVALID_HANDLE" });
    const replacement = await operation(service, base, 3); await rename(path, join(root, "held.md")); await writeFile(path, "replacement");
    expect((await service.acceptRefreshCandidate(replacement)).status).toBe("rejected");
    expect(service.locations()[0].documentId).toBe(base.documentId);
    const scopedPath = join(root, "scope.md"); await writeFile(scopedPath, "scope");
    const scope = { verify: () => Promise.resolve() };
    const scoped = await service.openAuthorized(request(), () => authorizeSingleFile(scopedPath), scope);
    if (!scoped.ok || !scoped.snapshot) throw Error();
    await writeFile(scopedPath, "scope external"); const scopedOp = await operation(service, scoped.snapshot);
    service.revokeScope(scope);
    expect(await service.acceptRefreshCandidate(scopedOp)).toEqual({ status: "unknown" });
    expect(service.queryRefreshAcceptance(scopedOp)).toEqual({ status: "unknown" });
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("paused acceptance excludes read, save preempts then uses real Node-API; settlement waits", async () => {
  const root = await mkdtemp(join(tmpdir(), "agentic-accept-save-")), path = join(root, "a.md");
  await writeFile(path, "old"); let paused = false, entered = false, finish = () => { /* No pause yet. */ };
  const service = createDocumentService({ pickFile: () => Promise.resolve(path), verify: async grant => {
    if (paused) { entered = true; await new Promise<void>(resolve => { finish = resolve; }); }
    return verifySingleFileAuthorization(grant);
  } });
  try {
    const base = await opened(service); await writeFile(path, "external"); const op = await operation(service, base);
    paused = true; const accept = service.acceptRefreshCandidate(op); await until(() => entered);
    expect(service.queryRefreshAcceptance(op)).toEqual({ status: "pending" });
    expect(await service.read({ ...request(), handle: base.handle })).toMatchObject({ ok: false, error: "BUSY" });
    let settled = false; const settlement = service.waitForSaves(request()).then(value => { settled = true; return value; });
    await Bun.sleep(10); expect(settled).toBe(false);
    // Restore accepted bytes so the foreground save is safe; this is a real native write.
    await writeFile(path, base.text); const before = await stat(path);
    const saving = save(service, base, "native priority"); await Bun.sleep(10); expect(settled).toBe(false);
    paused = false; finish();
    expect((await accept).status).toBe("rejected"); expect((await saving).ok).toBe(true);
    expect((await settlement).settled).toBe(true);
    expect(await readFile(path, "utf8")).toBe("native priority"); expect((await stat(path)).ino).not.toBe(before.ino);
  } finally { paused = false; finish(); await service.dispose(); await rm(root, { recursive: true, force: true }); }
});

test("write barrier, release and disposal settle paused accepts without a late commit", async () => {
  for (const action of ["barrier", "release", "dispose"] as const) {
    const root = await mkdtemp(join(tmpdir(), "agentic-accept-life-")), path = join(root, "a.md");
    await writeFile(path, "old"); let paused = false, entered = false, finish = () => { /* No pause yet. */ };
    const service = createDocumentService({ pickFile: () => Promise.resolve(path), verify: async grant => {
      if (paused) { entered = true; await new Promise<void>(resolve => { finish = resolve; }); }
      return verifySingleFileAuthorization(grant);
    } });
    try {
      const base = await opened(service); await writeFile(path, "external"); const op = await operation(service, base);
      paused = true; const accept = service.acceptRefreshCandidate(op); await until(() => entered);
      let completed = false;
      const pending = (action === "barrier" ? service.withWriteBarrier(() => { completed = true; return Promise.resolve(true); }) :
        action === "release" ? service.release({ ...request(), handle: base.handle }) : service.dispose()).then(value => { completed = true; return value; });
      await Bun.sleep(5); if (action !== "release") expect(completed).toBe(false);
      paused = false; finish(); expect((await accept).status).toBe("rejected"); await pending;
      expect(completed).toBe(true); expect(await readFile(path, "utf8")).toBe("external");
      if (action === "barrier") {
        const fresh = await service.read({ ...request(), handle: base.handle }); expect(fresh.ok && fresh.snapshot?.revision).toBe(base.revision + 1);
      } else expect(service.queryRefreshAcceptance(op)).toEqual({ status: "unknown" });
    } finally { paused = false; finish(); await service.dispose(); await rm(root, { recursive: true, force: true }); }
  }
});

test("bounded ledger high-water mark rejects stale execution; unknown is never rejected/not-committed", async () => {
  const ledger = createRefreshAcceptanceLedger(); let runs = 0;
  const base = { handle: crypto.randomUUID(), token: crypto.randomUUID(), operationId: crypto.randomUUID(), sequence: 1 };
  const execute = () => { runs++; return Promise.resolve({ status: "rejected" as const, error: "FILE_CHANGED" as const }); };
  expect(ledger.query(base)).toEqual({ status: "unknown" });
  await ledger.run(base, true, execute);
  for (let sequence = 2; sequence < 302; sequence++) {
    await ledger.run({ ...base, operationId: crypto.randomUUID(), sequence }, true, execute);
    expect(ledger.size()).toBe(1);
  }
  expect(await ledger.run(base, true, execute)).toEqual({ status: "superseded" });
  expect(ledger.query(base)).toEqual({ status: "superseded" }); expect(runs).toBe(301);
  ledger.release(base.handle); expect(ledger.size()).toBe(0); expect(ledger.query(base)).toEqual({ status: "unknown" });
});
