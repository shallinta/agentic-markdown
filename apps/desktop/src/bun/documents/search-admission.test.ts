import { expect, test } from "bun:test";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DocumentErrorCode } from "../../shared/documents";

import { authorizeSingleFile, DocumentPathError, verifySingleFileAuthorization } from "./path-authorization";

import { createDocumentService } from ".";

const request = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});
const scope = { verify: () => Promise.resolve() };

for (const entry of [
  "select",
  "openAuthorized",
  "openCreatedAuthorized",
] as const) {
  test(`${entry} invalidates idle admission before I/O and after grant release`, async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "document-search-admission-")
    );
    const path = join(directory, "a.md");
    const entered = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const documents = createDocumentService({
      pickFile: async () => {
        entered.resolve();
        await resume.promise;
        return path;
      },
    });
    const authorize = async () => {
      entered.resolve();
      await resume.promise;
      return authorizeSingleFile(path);
    };
    try {
      await writeFile(path, "target");
      const ticket = documents.beginSearchAdmission();
      expect(ticket?.current()).toBe(true);
      const opening =
        entry === "select"
          ? documents.select(request())
          : entry === "openAuthorized"
            ? documents.openAuthorized(request(), authorize, scope)
            : documents.openCreatedAuthorized(
                request(),
                authorize,
                scope,
                () => undefined
              );
      expect(ticket?.current()).toBe(false);
      expect(documents.beginSearchAdmission()).toBeUndefined();
      await entered.promise;
      expect(documents.beginSearchAdmission()).toBeUndefined();
      resume.resolve();
      const opened = await opening;
      if (!opened.ok || !opened.snapshot)
        throw Error("Missing authorized grant");
      expect(documents.beginSearchAdmission()).toBeUndefined();
      expect(
        await documents.release({
          ...request(),
          handle: opened.snapshot.handle,
        })
      ).toMatchObject({ ok: true });
      expect(documents.locations()).toEqual([]);
      expect(ticket?.current()).toBe(false);
      expect(documents.beginSearchAdmission()?.current()).toBe(true);
    } finally {
      resume.resolve();
      await documents.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("mutation barriers invalidate admission across their acquire and release", async () => {
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
  });
  try {
    const beforeCreate = documents.beginSearchAdmission();
    expect(beforeCreate?.current()).toBe(true);
    expect(
      await documents.withCreateBarrier(() => {
        expect(documents.beginSearchAdmission()).toBeUndefined();
      })
    ).toBe(true);
    expect(beforeCreate?.current()).toBe(false);
    const beforeFolder = documents.beginSearchAdmission();
    expect(beforeFolder?.current()).toBe(true);
    const lease = await documents.acquireFolderMutationLease();
    if (!lease) throw Error("Missing folder mutation lease");
    expect(documents.beginSearchAdmission()).toBeUndefined();
    lease.release();
    expect(beforeFolder?.current()).toBe(false);
    const beforeWrite = documents.beginSearchAdmission();
    expect(beforeWrite?.current()).toBe(true);
    expect(
      await documents.withWriteBarrier(() => {
        expect(documents.beginSearchAdmission()).toBeUndefined();
        return Promise.resolve(true);
      })
    ).toBe(true);
    expect(beforeWrite?.current()).toBe(false);
    const beforeDispose = documents.beginSearchAdmission();
    expect(beforeDispose?.current()).toBe(true);
    await documents.dispose();
    expect(beforeDispose?.current()).toBe(false);
    expect(documents.beginSearchAdmission()).toBeUndefined();
  } finally {
    await documents.dispose();
  }
});

const searchLimit = 64 * 1024;
const live = () => undefined;

function retainedBinding(documents: ReturnType<typeof createDocumentService>, handle: string) {
  const ticket = documents.captureContentSearchBindings([handle]);
  const binding = ticket?.bindings[0];
  if (!ticket || !binding?.readStandalone) throw Error("Missing retained standalone read capability");
  return { ticket, binding, read: (limit = searchLimit, check = live) => binding.readStandalone!(limit, check) };
}

async function expectReadFailure(read: Promise<unknown>, code: DocumentErrorCode) {
  const error = await read.then(() => undefined, (reason: unknown) => reason);
  expect(error).toMatchObject({ code });
}

test("a retained picker grant reads exact current bytes without changing its baseline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "standalone-search-snapshot-"));
  const path = join(directory, "picker.md");
  const folderPath = join(directory, "folder-entry.md");
  const original = Buffer.from("\uFEFF中文😀\r\noriginal\r\n");
  const replacement = Buffer.from("\uFEFF改动😀\r\ncurrent\r\n");
  const documents = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    await writeFile(path, original);
    await writeFile(folderPath, "directory entry");
    const picked = await documents.select(request());
    const derived = await documents.openAuthorized(request(), () => authorizeSingleFile(folderPath), scope);
    if (!picked.ok || !picked.snapshot || !derived.ok || !derived.snapshot)
      throw Error("Missing fixture document grants");
    const { handle, documentId, hash, revision } = picked.snapshot;
    expect(picked.snapshot.explicitStandalone).toBe(true);
    expect(derived.snapshot.explicitStandalone).toBe(false);
    const folderBinding = documents.captureContentSearchBindings([derived.snapshot.handle])?.bindings[0];
    expect(folderBinding).toBeDefined();
    expect(typeof folderBinding?.readStandalone).toBe("undefined");
    expect(await documents.observe({
      ...request(), handle, documentId, hash, revision,
      active: false, watchEpoch: 1, watchToken: crypto.randomUUID(),
    })).toMatchObject({ ok: true });

    const retained = retainedBinding(documents, handle);
    const locations = documents.locations();
    const assets = documents.assetEpochs();
    expect(retained.ticket.current()).toBe(true);
    expect(await retained.read(original.length)).toEqual(original);
    await expectReadFailure(retained.read(original.length - 1), "TOO_LARGE");
    for (const invalid of [-1, 0.5, searchLimit + 1])
      await expectReadFailure(retained.read(invalid), "INVALID_REQUEST");

    await writeFile(path, replacement);
    expect(await retained.read()).toEqual(replacement);
    expect(retained.ticket.current()).toBe(true);
    const after = retainedBinding(documents, handle).binding;
    expect(after).toMatchObject({ handle, documentId, hash, revision, fingerprint: retained.binding.fingerprint });
    expect(documents.locations()).toEqual(locations);
    expect(documents.assetEpochs()).toEqual(assets);
    const boundary = Buffer.alloc(searchLimit, 0x78);
    await writeFile(path, boundary);
    expect(await retained.read()).toEqual(boundary);
    await writeFile(path, Buffer.concat([boundary, Buffer.from("x")]));
    await expectReadFailure(retained.read(), "TOO_LARGE");
    expect(await documents.openAuthorized(request(), () => authorizeSingleFile(folderPath), scope))
      .toMatchObject({ ok: true });
    expect(retained.ticket.current()).toBe(false);
    await expectReadFailure(retained.read(), "CANCELLED");
  } finally {
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a standalone binding rejects caller cancellation, path replacement and revocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "standalone-search-revocation-"));
  const path = join(directory, "original.md");
  const documents = createDocumentService({ pickFile: () => Promise.resolve(path) });
  try {
    await writeFile(path, "original");
    const picked = await documents.select(request());
    if (!picked.ok || !picked.snapshot) throw Error("Missing fixture grant");
    const { handle } = picked.snapshot;
    const retained = retainedBinding(documents, handle);
    await expectReadFailure(
      retained.read(searchLimit, () => { throw new DocumentPathError("CANCELLED"); }),
      "CANCELLED"
    );

    await rename(path, join(directory, "old.md"));
    await writeFile(path, "replacement");
    await expectReadFailure(retained.read(), "FILE_CHANGED");
    expect(await documents.release({ ...request(), handle })).toMatchObject({ ok: true });
    expect(retained.ticket.current()).toBe(false);
    await expectReadFailure(retained.read(), "INVALID_HANDLE");
    expect(documents.captureContentSearchBindings([handle])?.bindings[0]).toBeUndefined();
  } finally {
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a retained descriptor read rechecks cancellation and trash isolation after I/O", async () => {
  const directory = await mkdtemp(join(tmpdir(), "standalone-search-after-read-"));
  const path = join(directory, "a.md");
  const raw = Buffer.from("\uFEFF😀\r\n正文");
  function readGate() {
    return { verified: 0, entered: Promise.withResolvers<void>(), resume: Promise.withResolvers<void>() };
  }
  let gate: ReturnType<typeof readGate> | undefined;
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(path),
    async verify(grant, check) {
      const state = gate;
      const stats = await verifySingleFileAuthorization(grant, check);
      // The stable-read path verifies the real descriptor before and after reading.
      if (state && ++state.verified === 2) {
        state.entered.resolve();
        await state.resume.promise;
      }
      return stats;
    },
  });
  try {
    await writeFile(path, raw);
    const picked = await documents.select(request());
    if (!picked.ok || !picked.snapshot) throw Error("Missing fixture grant");
    const retained = retainedBinding(documents, picked.snapshot.handle);
    let blocked = true;
    documents.setTrashGuard((file, fingerprint, directories) =>
      blocked && file === retained.binding.path && fingerprint === retained.binding.fingerprint && !!directories?.length
    );
    await expectReadFailure(retained.read(), "BUSY");
    blocked = false;

    async function invalidateAfterRead(
      invalidate: () => void,
      code: "BUSY" | "CANCELLED",
      check = live,
    ) {
      const state = readGate();
      gate = state;
      const read = retained.read(searchLimit, check);
      try {
        await Promise.race([state.entered.promise, read.then(() => { throw Error("Read completed before guard test"); })]);
        invalidate();
      } finally {
        gate = undefined;
        state.resume.resolve();
      }
      await expectReadFailure(read, code);
    }

    let current = true;
    await invalidateAfterRead(() => { current = false; }, "CANCELLED", () => {
      if (!current) throw new DocumentPathError("CANCELLED");
    });
    await invalidateAfterRead(() => { blocked = true; }, "BUSY");
    blocked = false;
    expect(await retained.read()).toEqual(raw);
  } finally {
    gate?.resume.resolve();
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
