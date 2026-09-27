import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DocumentService, DocumentSnapshot } from "../../shared/documents";
import { rawPatch } from "../../shared/save-content";

import { createDocumentService } from ".";

describe.skipIf(process.platform !== "darwin")(
  "single-file write capability",
  () => {
    let root: string,
      parent: string,
      path: string,
      service: DocumentService,
      base: DocumentSnapshot;
    let hints: string[];
    const request = {
      protocolVersion: 1 as const,
      requestId: "capability-test",
    };
    beforeAll(() => {
      const desktop = fileURLToPath(new URL("../../../", import.meta.url));
      expect(
        Bun.spawnSync([process.execPath, "scripts/build-save-native.ts"], {
          cwd: desktop,
        }).exitCode
      ).toBe(0);
    });
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "agentic-capability-"));
      parent = join(root, "parent");
      await mkdir(parent);
      path = join(parent, "sample.md");
      await writeFile(path, "\uFEFForiginal\r\n", { mode: 0o600 });
      hints = [];
      service = createDocumentService({
        pickFile: () => Promise.resolve(path),
        onCapabilityChanged: (handle) => hints.push(handle),
      });
      const response = await service.select(request);
      if (!response.ok || !response.snapshot) throw Error("select failed");
      base = response.snapshot;
    });
    afterEach(async () => {
      await service.dispose();
      Bun.spawnSync(["chmod", "-RN", parent]);
      Bun.spawnSync(["chflags", "-R", "nouchg,nouappnd", parent]);
      await chmod(parent, 0o700);
      await rm(root, { recursive: true, force: true });
    });
    const check = () =>
      service.checkWriteCapability({ ...request, handle: base.handle });
    async function expectWritableEventually() {
      // Metadata hints can arrive after chmod/our own rename and invalidate a
      // concurrently running probe. That result must remain fail-closed, then
      // a fresh check must recover; readonly/invalid are not acceptable here.
      for (let attempt = 0; attempt < 100; attempt++) {
        const { capability } = await check();
        if (capability.writable) {
          expect(capability.reason).toBe("writable");
          return;
        }
        if (capability.reason !== "unavailable")
          throw Error(`Unexpected recovery state: ${capability.reason}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error("Write capability did not recover after metadata settled");
    }
    const save = () =>
      service.save({
        ...request,
        handle: base.handle,
        documentId: base.documentId,
        expectedRevision: base.revision,
        expectedHash: base.hash,
        bufferRevision: (base.mirror?.revision ?? 0) + 1,
        mirror: base.mirror,
        content: {
          kind: "patch",
          ...rawPatch(base.text, "saved\n"),
          targetHash: createHash("sha256").update("saved\n").digest("hex"),
        },
      });

    test("file and parent permissions refresh without writing a probe or reading content", async () => {
      expect(base.writeCapability.writable).toBe(true);
      const before = await readdir(parent);
      await chmod(path, 0o444);
      expect((await check()).capability).toEqual({
        writable: false,
        reason: "readonly",
      });
      expect(await save()).toMatchObject({ ok: false, error: "READ_ONLY" });
      expect(await readFile(path, "utf8")).toBe(base.text);
      await chmod(path, 0o600);
      await chmod(parent, 0o500);
      expect((await check()).capability.writable).toBe(false);
      await chmod(parent, 0o700);
      await expectWritableEventually();
      expect(await readdir(parent)).toEqual(before);
      for (let i = 0; i < 100 && !hints.length; i++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(hints).toContain(base.handle);
    });
    test("ACL delete restrictions and immutable/append flags are not inferred from write bits", async () => {
      const command = (...args: string[]) =>
        expect(Bun.spawnSync(args).exitCode).toBe(0);
      command("chmod", "+a", "everyone deny delete", path);
      expect((await check()).capability.writable).toBe(false);
      command("chmod", "-N", path);
      command("chmod", "+a", "everyone deny delete_child", parent);
      expect((await check()).capability.writable).toBe(false);
      command("chmod", "-N", parent);
      for (const flag of ["uchg", "uappnd"]) {
        command("chflags", flag, path);
        expect((await check()).capability.writable).toBe(false);
        command("chflags", `no${flag}`, path);
      }
      await expectWritableEventually();
    });
    test("save replacement revalidates fresh descriptors and keeps the same identity writable", async () => {
      const result = await save();
      if (!result.ok || !result.snapshot) throw Error("save failed");
      expect(result.snapshot.documentId).toBe(base.documentId);
      expect(result.snapshot).not.toHaveProperty("text");
      expect(result.snapshot.mirror).toBeDefined();
      const diskText = await readFile(path, "utf8");
      expect(diskText).toBe("saved\n");
      base = { ...result.snapshot, text: diskText };
      await expectWritableEventually();
      expect(await save()).toMatchObject({ ok: true });
    });
    test("forged requests, replacement and released handles fail closed", async () => {
      expect(
        (
          await service.checkWriteCapability({
            ...request,
            handle: base.handle,
            writable: true,
          })
        ).capability.writable
      ).toBe(false);
      expect(
        (
          await service.checkWriteCapability({
            ...request,
            handle: crypto.randomUUID(),
          })
        ).capability.writable
      ).toBe(false);
      await rename(path, join(parent, "old.md"));
      await writeFile(path, "new");
      expect((await check()).capability.writable).toBe(false);
      expect(await save()).toMatchObject({ ok: false, error: "READ_ONLY" });
      await service.release({ ...request, handle: base.handle });
      expect((await check()).capability.reason).toBe("invalid");
    });
    test("metadata event fences a same-inode permission result shared with a later request", async () => {
      await service.dispose();
      let blocked = false;
      let finish!: () => void;
      service = createDocumentService({
        pickFile: () => Promise.resolve(path),
        onCapabilityChanged: (handle) => hints.push(handle),
        capability: async () => {
          if (blocked)
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          return { writable: true, reason: "writable" };
        },
      });
      const selected = await service.select(request);
      if (!selected.ok || !selected.snapshot) throw Error("select failed");
      base = selected.snapshot;
      blocked = true;
      const before = check();
      while (!finish) await new Promise((resolve) => setTimeout(resolve, 1));
      await chmod(path, 0o444);
      for (let i = 0; i < 100 && !hints.length; i++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      expect(hints).toContain(base.handle);
      const after = check();
      finish();
      expect((await before).capability.writable).toBe(false);
      expect((await after).capability.writable).toBe(false);
    });
    test("backend merges same-handle probes, caps total work and fences released results", async () => {
      await service.dispose();
      let blocked = false,
        calls = 0;
      const complete: (() => void)[] = [];
      service = createDocumentService({
        pickFile: () => Promise.resolve(path),
        capability: async () => {
          if (blocked) {
            calls++;
            await new Promise<void>((resolve) => {
              complete.push(resolve);
            });
          }
          return { writable: true, reason: "writable" };
        },
      });
      const handles: string[] = [];
      for (let i = 0; i < 3; i++) {
        const selected = await service.select({
          ...request,
          requestId: `select-${i}`,
        });
        if (!selected.ok || !selected.snapshot) throw Error("select failed");
        handles.push(selected.snapshot.handle);
      }
      blocked = true;
      const first = Array.from({ length: 20 }, (_, i) =>
        service.checkWriteCapability({
          ...request,
          requestId: `first-${i}`,
          handle: handles[0],
        })
      );
      const second = service.checkWriteCapability({
        ...request,
        handle: handles[1],
      });
      const overloaded = await service.checkWriteCapability({
        ...request,
        handle: handles[2],
      });
      expect(overloaded.capability.writable).toBe(false);
      expect(calls).toBe(2);
      await service.release({ ...request, handle: handles[0] });
      complete.forEach((done) => done());
      expect(
        (await Promise.all(first)).every((value) => !value.capability.writable)
      ).toBe(true);
      expect((await second).capability.writable).toBe(true);
    });
  }
);
