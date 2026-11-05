import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { authorizeSingleFile } from "./path-authorization";

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
