import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
} from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  chmod,
  link,
  stat,
  readdir,
  rename,
  mkdir,
  utimes,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_DOCUMENT_BYTES,
  type DocumentResponse,
  type DocumentService,
  type SaveDocumentResponse,
} from "../../shared/documents";
import { rawPatch } from "../../shared/save-content";

import type { AtomicSaveInput } from "./atomic-save";
import { authorizeSingleFile } from "./path-authorization";
import { runAtomicSave, type NativeSave } from "./save-operation";

import { createDocumentService } from ".";

function snapshot(result: DocumentResponse) {
  if (!result.ok || !result.snapshot) throw new Error(JSON.stringify(result));
  return result.snapshot;
}
function savedSnapshot(result: SaveDocumentResponse) {
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(result.snapshot).not.toHaveProperty("text");
  expect(result.snapshot.mirror).toBeDefined();
  return result.snapshot;
}
const content = (before: string, after: string) => ({
  kind: "patch" as const,
  ...rawPatch(before, after),
  targetHash: createHash("sha256").update(after).digest("hex"),
});
const savedText = "\uFEFFnew\r\nLF\nCR\rlast";
const request = { protocolVersion: 1, requestId: "save-test" };
describe.skipIf(process.platform !== "darwin")(
  "native atomic save worker",
  () => {
    const desktop = fileURLToPath(new URL("../../../", import.meta.url));
    let native: NativeSave;
    beforeAll(() => {
      const built = Bun.spawnSync(
        [process.execPath, "scripts/build-save-native.ts"],
        { cwd: desktop }
      );
      expect(built.exitCode).toBe(0);
      native = createRequire(import.meta.url)(
        join(desktop, "dist-native/save-primitives.node")
      ) as NativeSave;
    });
    let root: string, path: string, service: DocumentService;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "agentic-save-test-"));
      path = join(root, "a.md");
      await writeFile(path, "\uFEFFold\r\n", { mode: 0o640 });
      service = createDocumentService({
        pickFile: () => Promise.resolve(path),
      });
    });
    afterEach(async () => {
      await service.dispose();
      await rm(root, { recursive: true, force: true });
    });
    async function saveRequest(text = savedText) {
      const base = snapshot(await service.select(request));
      return {
        ...request,
        handle: base.handle,
        documentId: base.documentId,
        expectedHash: base.hash,
        expectedRevision: base.revision,
        bufferRevision: 7,
        mirror: base.mirror,
        content: content(base.text, text),
      };
    }
    async function input(): Promise<AtomicSaveInput> {
      const grant = await authorizeSingleFile(path);
      const base = snapshot(await service.select(request));
      const { file, ...authorization } = grant;
      await file.close();
      return { authorization, expectedHash: base.hash, text: "replacement" };
    }
    test("native entrypoints reject malformed descriptors and path components", () => {
      expect(() => native.createTemp(NaN, ".agentic-save-test")).toThrow();
      expect(() => native.createTemp(-1, ".agentic-save-test")).toThrow();
      expect(() => native.createTemp(0, "../outside")).toThrow();
      expect(() => native.createTemp(0, "not-private")).toThrow();
    });
    test("metadata/rename failures keep original; post-rename sync failure is uncertain", async () => {
      const prepared = await input();
      const methods = {
        createTemp: native.createTemp,
        copyMetadata: native.copyMetadata,
        fullSync: native.fullSync,
        replace: native.replace,
        removeTemp: native.removeTemp,
      };
      for (const method of [
        "createTemp",
        "copyMetadata",
        "fullSync",
        "replace",
      ] as const) {
        expect(
          await runAtomicSave(prepared, () => ({
            ...methods,
            [method]: () => {
              throw new Error("injected");
            },
          }))
        ).toMatchObject({ error: "SAVE_FAILED" });
        expect(await readFile(path, "utf8")).toBe("\uFEFFold\r\n");
        expect(await readdir(root)).toEqual(["a.md"]);
      }
      let syncs = 0;
      expect(
        await runAtomicSave(prepared, () => ({
          ...methods,
          fullSync: (fd) => {
            if (++syncs === 2) throw new Error("dir sync failed");
            native.fullSync(fd);
          },
        }))
      ).toMatchObject({ error: "SAVE_UNCERTAIN" });
      expect(await readFile(path, "utf8")).toBe("replacement");
    });
    test("held directory replacement cannot redirect writes outside authorization", async () => {
      const prepared = await input();
      const outer = await mkdtemp(join(tmpdir(), "agentic-save-outside-"));
      const moved = root + "-moved";
      try {
        await mkdir(join(outer, "outside"));
        await writeFile(join(outer, "outside/a.md"), "untouched");
        const methods = {
          createTemp: native.createTemp,
          copyMetadata: native.copyMetadata,
          fullSync: native.fullSync,
          removeTemp: native.removeTemp,
          replace: (fd: number, from: string, to: string) => {
            // Synchronous filesystem mutation at the exact pre-replace seam.
            const result = Bun.spawnSync([
              process.execPath,
              "-e",
              "await import('node:fs/promises').then(async f=>{await f.rename(process.argv[1],process.argv[2]);await f.symlink(process.argv[3],process.argv[1]);})",
              root,
              moved,
              join(outer, "outside"),
            ]);
            expect(result.exitCode).toBe(0);
            native.replace(fd, from, to);
          },
        };
        expect(await runAtomicSave(prepared, () => methods)).toMatchObject({
          error: "SAVE_UNCERTAIN",
        });
        expect(await readFile(join(outer, "outside/a.md"), "utf8")).toBe(
          "untouched"
        );
      } finally {
        await rm(root, { force: true });
        await rename(moved, root);
        await rm(outer, { recursive: true });
      }
    });
    test("Node-API preserves xattrs ACL and refreshes modification time", async () => {
      await utimes(path, new Date(0), new Date(0));
      expect(
        Bun.spawnSync([
          "/usr/bin/xattr",
          "-w",
          "com.agenticmarkdown.test",
          "metadata",
          path,
        ]).exitCode
      ).toBe(0);
      expect(
        Bun.spawnSync([
          "/bin/chmod",
          "+a",
          `user:${userInfo().username} allow read`,
          path,
        ]).exitCode
      ).toBe(0);
      const before = Bun.spawnSync(["/bin/ls", "-le", path])
        .stdout.toString()
        .split("\n")
        .slice(1)
        .join("\n");
      expect((await service.save(await saveRequest())).ok).toBe(true);
      expect(
        Bun.spawnSync([
          "/usr/bin/xattr",
          "-p",
          "com.agenticmarkdown.test",
          path,
        ])
          .stdout.toString()
          .trim()
      ).toBe("metadata");
      expect(
        Bun.spawnSync(["/bin/ls", "-le", path])
          .stdout.toString()
          .split("\n")
          .slice(1)
          .join("\n")
      ).toBe(before);
      expect((await stat(path)).mtimeMs).toBeGreaterThan(Date.now() - 60000);
    });
    test("durable save keeps identities, fidelity, mode and supports read plus second save", async () => {
      const r = await saveRequest();
      const first = await service.save(r);
      const saved = savedSnapshot(first);
      expect(first).toMatchObject({ savedBufferRevision: 7 });
      expect(saved.handle).toBe(r.handle);
      expect(saved.documentId).toBe(r.documentId);
      expect(await readFile(path, "utf8")).toBe(savedText);
      expect(await readFile(path)).toEqual(Buffer.from(savedText, "utf8"));
      expect((await stat(path)).mode & 0o777).toBe(0o640);
      const reread = snapshot(
        await service.read({ ...request, handle: r.handle })
      );
      expect(reread.documentId).toBe(r.documentId);
      const again = savedSnapshot(
        await service.save({
          ...r,
          expectedHash: saved.hash,
          expectedRevision: saved.revision,
          mirror: reread.mirror,
          content: content(reread.text, "again"),
        })
      );
      expect(again.revision).toBe(saved.revision + 1);
      expect(await readFile(path, "utf8")).toBe("again");
    });
    test("external content, read-only and hardlinks fail without overwriting", async () => {
      const r = await saveRequest();
      await writeFile(path, "external");
      expect(await service.save(r)).toMatchObject({
        ok: false,
        error: "CONFLICT",
      });
      expect(await readFile(path, "utf8")).toBe("external");
      const fresh = await saveRequest();
      await chmod(path, 0o400);
      expect(await service.save(fresh)).toMatchObject({
        ok: false,
        error: "READ_ONLY",
      });
      await chmod(path, 0o600);
      await link(path, join(root, "other.md"));
      expect(await service.save(fresh)).toMatchObject({
        ok: false,
        error: "READ_ONLY",
      });
    });
    test("strict envelope and document binding reject forged inputs", async () => {
      const r = await saveRequest();
      for (const invalid of [
        { ...r, path },
        { ...r, expectedRevision: NaN },
        { ...r, content: { ...r.content, insert: "\ud800" } },
        { ...r, text: savedText },
        { ...r, bufferRevision: -1 },
      ])
        expect(await service.save(invalid)).toMatchObject({
          ok: false,
          error: "INVALID_REQUEST",
        });
      expect(
        await service.save({
          ...r,
          content: content(
            "\uFEFFold\r\n",
            "中".repeat(MAX_DOCUMENT_BYTES / 2)
          ),
        })
      ).toMatchObject({ error: "TOO_LARGE" });
      expect(
        await service.save({ ...r, documentId: crypto.randomUUID() })
      ).toMatchObject({ error: "INVALID_HANDLE" });
    });
    test("write barrier drains pending write then blocks new writes and release; uncertainty fences retries", async () => {
      await service.dispose();
      let complete!: (result: { ok: false; error: "SAVE_UNCERTAIN" }) => void;
      let writes = 0;
      service = createDocumentService({
        pickFile: () => Promise.resolve(path),
        write: () =>
          ++writes === 1
            ? new Promise((resolve) => {
                complete = resolve;
              })
            : Promise.resolve({ ok: false, error: "SAVE_FAILED" }),
      });
      const r = await saveRequest();
      const saving = service.save(r);
      while (!complete) await new Promise((resolve) => setTimeout(resolve, 1));
      let acknowledged = false;
      const ack = service
        .waitForSaves({ ...request, requestId: "after-rpc-timeout" })
        .then((result) => {
          acknowledged = result.settled;
        });
      await Promise.resolve();
      expect(acknowledged).toBe(false);
      let called = false;
      const barrier = service.withWriteBarrier(async () => {
        called = true;
        expect(await service.save(r)).toMatchObject({ error: "BUSY" });
        return false;
      });
      expect(called).toBe(false);
      expect(
        await service.release({ ...request, handle: r.handle })
      ).toMatchObject({ error: "BUSY" });
      complete({ ok: false, error: "SAVE_UNCERTAIN" });
      await saving;
      await barrier;
      await ack;
      expect(acknowledged).toBe(true);
      expect(called).toBe(true);
      expect(await service.save(r)).toMatchObject({ error: "SAVE_UNCERTAIN" });
      const reread = snapshot(
        await service.read({ ...request, handle: r.handle })
      );
      expect(await service.save({ ...r, mirror: reread.mirror })).toMatchObject(
        { error: "SAVE_FAILED" }
      );
      expect(writes).toBe(2);
    });
  }
);
