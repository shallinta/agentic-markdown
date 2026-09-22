import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  link,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MAX_DOCUMENT_BYTES,
  type DocumentResponse,
  type DocumentService,
} from "../../shared/documents";

import { authorizeSingleFile } from "./path-authorization";

import { createDocumentService } from ".";

const request = { protocolVersion: 1, requestId: "test" };
function success(response: DocumentResponse) {
  if (!response.ok || !response.snapshot)
    throw new Error(JSON.stringify(response));
  return response.snapshot;
}
describe("read-only document service", () => {
  let directory: string;
  let path: string;
  let selected: string | null;
  let service: DocumentService;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "agentic-document-"));
    path = join(directory, "测试.md");
    await writeFile(path, "\uFEFF# 原文\r\n");
    selected = path;
    service = createDocumentService({
      pickFile: () => Promise.resolve(selected),
    });
  });
  afterEach(async () => {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  });
  test("selected grants keep only closed descriptors between requests", async () => {
    await service.dispose();
    const opened: Awaited<ReturnType<typeof authorizeSingleFile>>[] = [];
    service = createDocumentService({
      pickFile: () => Promise.resolve(selected),
      authorize: async (path) => {
        const grant = await authorizeSingleFile(path);
        opened.push(grant);
        return grant;
      },
    });
    const first = success(await service.select(request));
    expect(opened[0]?.file.fd).toBe(-1);
    expect(
      success(await service.read({ ...request, handle: first.handle }))
        .documentId
    ).toBe(first.documentId);
    expect(opened[0]?.file.fd).toBe(-1);
  });
  test("same-name files and hard links have separate canonical locations", async () => {
    const first = success(await service.select(request));
    await mkdir(join(directory, "nested"));
    selected = join(directory, "nested", "测试.md");
    await link(path, selected);
    const second = success(await service.select(request));
    expect(second.fileName).toBe(first.fileName);
    expect(second.locationId).not.toBe(first.locationId);
    expect(second.displayPath).not.toBe(first.displayPath);
    expect(
      success(await service.read({ ...request, handle: first.handle }))
        .documentId
    ).toBe(first.documentId);
  });
  test("preserves exact text, same identity and revision across reselection; revisions follow content", async () => {
    const original = await readFile(path);
    const first = success(await service.select(request));
    expect(first.text).toBe("\uFEFF# 原文\r\n");
    expect(first.byteLength).toBe(original.length);
    const second = success(await service.select(request));
    expect(second.documentId).toBe(first.documentId);
    expect(second.locationId).toBe(first.locationId);
    expect(second.revision).toBe(1);
    expect(
      success(await service.read({ ...request, handle: first.handle }))
        .documentId
    ).toBe(first.documentId);
    await service.release({ ...request, handle: first.handle });
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "INVALID_HANDLE" });
    expect(await readFile(path)).toEqual(original);
    await writeFile(path, "new");
    const changed = success(
      await service.read({ ...request, handle: second.handle })
    );
    expect(changed.documentId).toBe(first.documentId);
    expect(changed.revision).toBe(2);
    expect(
      success(await service.read({ ...request, handle: second.handle }))
        .revision
    ).toBe(2);
  });
  test("cancel and failed selection retain previous grant", async () => {
    const first = success(await service.select(request));
    selected = null;
    expect(await service.select(request)).toMatchObject({
      ok: true,
      snapshot: null,
    });
    selected = join(directory, "wrong.mdx");
    expect(await service.select(request)).toMatchObject({
      error: "UNSUPPORTED_FILE",
    });
    expect(
      success(await service.read({ ...request, handle: first.handle }))
        .documentId
    ).toBe(first.documentId);
  });
  test("selecting a different file retains old grant and revisiting keeps session identity", async () => {
    const first = success(await service.select(request));
    selected = join(directory, "other.markdown");
    await writeFile(selected, "other");
    const other = success(await service.select(request));
    expect(other.documentId).not.toBe(first.documentId);
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ ok: true, snapshot: { documentId: first.documentId } });
    selected = path;
    const again = success(await service.select(request));
    expect(again.documentId).toBe(first.documentId);
    expect(again.revision).toBe(first.revision);
  });
  test("replacement and missing file revoke authorization", async () => {
    const first = success(await service.select(request));
    await rename(path, join(directory, "old.md"));
    await writeFile(path, "replacement");
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "INVALID_HANDLE" });
    const second = success(await service.select(request));
    expect(second.documentId).not.toBe(first.documentId);
    expect(second.locationId).toBe(first.locationId);
    await unlink(path);
    expect(
      await service.read({ ...request, handle: second.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
  });
  test("bounded UTF8 read rejects invalid data, over-limit and directories", async () => {
    await writeFile(path, Buffer.alloc(MAX_DOCUMENT_BYTES, 97));
    expect(success(await service.select(request)).byteLength).toBe(
      MAX_DOCUMENT_BYTES
    );
    await writeFile(path, Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 97));
    expect(await service.select(request)).toMatchObject({ error: "TOO_LARGE" });
    await writeFile(path, Buffer.from([0xff]));
    expect(await service.select(request)).toMatchObject({
      error: "INVALID_UTF8",
    });
    selected = join(directory, "directory.md");
    await mkdir(selected);
    expect(await service.select(request)).toMatchObject({
      error: "UNSUPPORTED_FILE",
    });
  });
  test("strict request validation and forged/released grants", async () => {
    for (const invalid of [
      null,
      [],
      {},
      { ...request, protocolVersion: 2 },
      { ...request, requestId: "" },
      { ...request, requestId: "a".repeat(81) },
      { ...request, path },
    ]) {
      expect(await service.select(invalid)).toMatchObject({
        error: "INVALID_REQUEST",
      });
    }
    expect(await service.read({ ...request, handle: "bad" })).toMatchObject({
      error: "INVALID_REQUEST",
    });
    expect(
      await service.read({ ...request, handle: randomUUID() })
    ).toMatchObject({ error: "INVALID_HANDLE" });
    const first = success(await service.select(request));
    expect(
      await service.release({ ...request, handle: first.handle })
    ).toMatchObject({ ok: true });
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "INVALID_HANDLE" });
  });
  test("canonical symlink selection shares identity; replacing authorized path with symlink revokes", async () => {
    const first = success(await service.select(request));
    selected = join(directory, "alias.markdown");
    await symlink(path, selected);
    const alias = success(await service.select(request));
    expect(alias.documentId).toBe(first.documentId);
    expect(alias.locationId).toBe(first.locationId);
    await rename(path, join(directory, "moved.md"));
    await symlink(join(directory, "moved.md"), path);
    expect(
      await service.read({ ...request, handle: alias.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
  });
  test("concurrent reads keep latest and release invalidates pending work", async () => {
    const first = success(await service.select(request));
    const reads = await Promise.all([
      service.read({ ...request, requestId: "one", handle: first.handle }),
      service.read({ ...request, requestId: "two", handle: first.handle }),
    ]);
    expect(reads[0]).toMatchObject({ error: "CANCELLED" });
    expect(success(reads[1]).revision).toBe(1);
    const pending = service.read({ ...request, handle: first.handle });
    await service.release({ ...request, handle: first.handle });
    expect(await pending).toMatchObject({ error: "CANCELLED" });
  });
  test("picker is BUSY while pending and disposal prevents late authorization", async () => {
    let finish!: (value: string) => void;
    await service.dispose();
    service = createDocumentService({
      pickFile: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = service.select(request);
    expect(await service.select(request)).toMatchObject({ error: "BUSY" });
    await service.dispose();
    finish(path);
    expect(await pending).toMatchObject({ error: "CANCELLED" });
  });
});
