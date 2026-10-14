import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRecentFiles } from "../recent-files";

import { authorizeSingleFile } from "./path-authorization";

import { createDocumentService, type TrustedDocumentService } from ".";
const dirs: string[] = [],
  services: TrustedDocumentService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((r) => {
      resolve = r;
    }),
    release: () => resolve(),
  };
}
test("select crossing active or completed barrier cannot commit or record; new select succeeds", async () => {
  for (const released of [false, true]) {
    const dir = await mkdtemp(join(tmpdir(), "recent-selection-"));
    dirs.push(dir);
    const path = join(dir, "a.md");
    await writeFile(path, "body");
    const entered = deferred(),
      resume = deferred(),
      barrier = deferred(),
      established = deferred();
    let calls = 0,
      first = true;
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
      authorize: async (selected) => {
        const grant = await authorizeSingleFile(selected);
        if (first) {
          first = false;
          entered.release();
          await resume.promise;
        }
        return grant;
      },
      onStandaloneSelected: () => {
        calls++;
      },
    });
    services.push(service);
    const selection = service.select({ protocolVersion: 1, requestId: "old" });
    await entered.promise;
    const protectedAction = service.withWriteBarrier(async () => {
      established.release();
      await barrier.promise;
      return true;
    });
    await established.promise;
    if (released) {
      barrier.release();
      await protectedAction;
    }
    resume.release();
    const result = await selection;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("BUSY");
    expect(calls).toBe(0);
    expect(service.locations()).toEqual([]);
    if (!released) {
      barrier.release();
      await protectedAction;
    }
    expect(
      (await service.select({ protocolVersion: 1, requestId: "new" })).ok
    ).toBe(true);
    expect(calls).toBe(1);
  }
});
test("record callback sync throw, rejection or unresolved promise never fails or delays opened document", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recent-open-"));
  dirs.push(dir);
  const path = join(dir, "a.md");
  await writeFile(path, "body");
  for (const callback of [
    () => {
      throw Error("metadata");
    },
    () => Promise.reject(Error("metadata rejected")),
    () =>
      new Promise<void>(() => {
        /* intentionally pending ancillary store */
      }),
  ]) {
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
      onStandaloneSelected: callback,
    });
    services.push(service);
    expect(
      (await service.select({ protocolVersion: 1, requestId: "select" })).ok
    ).toBe(true);
  }
});
test("cancelled picker and failed open do not record recent metadata", async () => {
  let records = 0;
  for (const path of [null, "/nonexistent-agentic-recent-test/a.md"]) {
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
      onStandaloneSelected: () => {
        records++;
      },
    });
    services.push(service);
    const result = await service.select({
      protocolVersion: 1,
      requestId: "select",
    });
    expect(result.ok).toBe(path === null);
    if (result.ok) expect(result.snapshot).toBeNull();
    expect(records).toBe(0);
    expect(service.locations()).toEqual([]);
  }
});
test("committed select synchronously queues recent record before barrier drain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "recent-drain-"));
  dirs.push(dir);
  const path = join(dir, "a.md");
  await writeFile(path, "body");
  const recent = createRecentFiles(dir);
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
    onStandaloneSelected: (metadata) => recent.recordSelected(metadata),
  });
  services.push(service);
  expect(
    (await service.select({ protocolVersion: 1, requestId: "select" })).ok
  ).toBe(true);
  await service.withWriteBarrier(async () => {
    await recent.drain();
    return true;
  });
  const restored = await createRecentFiles(dir).request({ op: "list" });
  expect(restored.available).toBe(true);
  if (restored.available)
    expect(restored.entries.map((item) => item.name)).toEqual(["a.md"]);
});
