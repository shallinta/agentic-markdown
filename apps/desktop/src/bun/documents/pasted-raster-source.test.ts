import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ObservationRequest } from "../../shared/document-observation";
import { authorizeEntry, authorizeRoot, verifyRoot } from "../workspace/authorization";

import { fileFingerprint } from "./path-authorization";

import { createDocumentService } from ".";

const original = "\uFEFF# 合成样本\r\n";
const request = () => ({ protocolVersion: 1 as const, requestId: randomUUID() });

async function fixture() {
  const scratch = await mkdtemp(join(tmpdir(), "agentic-raster-source-"));
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
    // Watch timing is controlled. Authorization, bytes and writable probe are real.
    probe: () => Promise.resolve({ status: "unchanged" }),
  });
  const cleanup = async () => {
    await documents.dispose();
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    const root = await authorizeRoot(scratch);
    const path = join(root.path, "sample.md");
    await writeFile(path, original);
    const fingerprint = fileFingerprint(await lstat(path, { bigint: true }));
    const scope = { verify: () => verifyRoot(root) };
    const opened = await documents.openAuthorized(
      request(), () => authorizeEntry(root, path, fingerprint, []), scope
    );
    if (!opened.ok || !opened.snapshot) throw Error("Fixture open failed");
    const { handle, documentId, revision, hash } = opened.snapshot;
    const source = { handle, documentId, expectedRevision: revision, expectedHash: hash };
    const observer: ObservationRequest = {
      ...request(), active: true, handle, documentId, revision, hash,
      watchToken: randomUUID(), watchEpoch: 1,
    };
    return { documents, path, root, source, expected: { path, fingerprint }, observer, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

test("saved raster source uses one barrier, yields an expiring ticket, and preserves the known action value", async () => {
  const f = await fixture();
  try {
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    let retired: (() => boolean) | undefined;
    let revalidateRetired: (() => Promise<boolean>) | undefined;
    const refused = { ok: false, error: "CONFLICT" } as const;
    const outcome = await f.documents.withPastedRasterSource(f.source, f.expected, () => true, async ticket => {
      retired = ticket.current;
      revalidateRetired = ticket.revalidate;
      expect(Object.keys(ticket).sort()).toEqual(["current", "revalidate"]);
      expect(ticket.current()).toBe(true);
      expect(await ticket.revalidate()).toBe(true);
      expect(await f.documents.withCreateBarrier(() => { throw Error("unexpected nested barrier"); })).toBe(false);
      return refused;
    });
    expect(outcome).toEqual({ ok: true, value: refused });
    expect(retired?.()).toBe(false);
    expect(await revalidateRetired?.()).toBe(false);
    expect(await readFile(f.path, "utf8")).toBe(original);
    expect(f.documents.locations().map(({ handle }) => handle)).toEqual([f.source.handle]);
  } finally { await f.cleanup(); }
});

test("known authority, observation, Trash, writability and disk failures never enter the action", async () => {
  const f = await fixture();
  try {
    let actions = 0;
    const run = (source = f.source, expected = f.expected) =>
      f.documents.withPastedRasterSource(source, expected, () => true, () => {
        actions++;
        return Promise.resolve("unexpected");
      });
    expect(await run()).toEqual({ ok: false, error: "CONFLICT" });
    expect((await f.documents.observe(f.observer)).ok).toBe(true);
    expect(await run({ ...f.source, handle: randomUUID() })).toEqual({ ok: false, error: "INVALID_HANDLE" });
    expect(await run({ ...f.source, expectedRevision: f.source.expectedRevision + 1 })).toEqual({ ok: false, error: "CONFLICT" });
    expect(await run(f.source, { ...f.expected, fingerprint: "wrong" })).toEqual({ ok: false, error: "FILE_CHANGED" });
    f.documents.setTrashGuard(() => true);
    expect(await run()).toEqual({ ok: false, error: "BUSY" });
    f.documents.setTrashGuard(() => false);
    await chmod(f.path, 0o444);
    expect(await run()).toEqual({ ok: false, error: "READ_ONLY" });
    await chmod(f.path, 0o600);
    await writeFile(f.path, original.replace("合成", "变化"));
    expect(fileFingerprint(await lstat(f.path, { bigint: true }))).toBe(f.expected.fingerprint);
    expect(await run()).toEqual({ ok: false, error: "CONFLICT" });
    expect(actions).toBe(0);
  } finally { await f.cleanup(); }
});

test("late source or caller changes cannot yield a success after action begins", async () => {
  for (const change of ["rewrite", "replace", "stop-observation", "cancel-caller"]) {
    const f = await fixture();
    try {
      expect((await f.documents.observe(f.observer)).ok).toBe(true);
      let callerCurrent = true;
      const outcome = await f.documents.withPastedRasterSource(f.source, f.expected, () => callerCurrent, async ticket => {
        expect(ticket.current()).toBe(true);
        if (change === "replace") {
          await rename(f.path, join(f.root.path, "previous.md"));
          await writeFile(f.path, original);
        } else if (change === "rewrite") {
          await writeFile(f.path, original.replace("合成", "变化"));
          expect(fileFingerprint(await lstat(f.path, { bigint: true }))).toBe(f.expected.fingerprint);
          expect(await ticket.revalidate()).toBe(false);
          await writeFile(f.path, original);
          expect(ticket.current()).toBe(false);
        } else if (change === "stop-observation") {
          expect((await f.documents.observe({ ...f.observer, active: false })).ok).toBe(true);
          expect(ticket.current()).toBe(false);
        } else {
          callerCurrent = false;
          expect(ticket.current()).toBe(false);
          callerCurrent = true;
          expect(await ticket.revalidate()).toBe(false);
        }
        return { ok: true };
      });
      expect(outcome).toEqual({ ok: false, error: "UNKNOWN" });
      expect(f.documents.locations().map(({ handle }) => handle)).toEqual([f.source.handle]);
    } finally { await f.cleanup(); }
  }
});
