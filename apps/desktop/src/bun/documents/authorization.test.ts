import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DocumentResponse, DocumentService } from "../../shared/documents";

import { createDocumentService } from ".";

const request = { protocolVersion: 1, requestId: "authorization-test" };
function success(response: DocumentResponse) {
  if (!response.ok || !response.snapshot)
    throw new Error(JSON.stringify(response));
  return response.snapshot;
}

describe("single-file path and authorization", () => {
  let directory: string;
  let path: string;
  let selected: string | null;
  let service: DocumentService;
  beforeEach(async () => {
    directory = await mkdtemp(
      join(
        process.env.AGENTIC_MARKDOWN_TEST_FS_ROOT ?? tmpdir(),
        "agentic-f004-test-"
      )
    );
    path = join(directory, "Case.md");
    await writeFile(path, "# 原文\r\n");
    selected = path;
    service = createDocumentService({
      pickFile: () => Promise.resolve(selected),
    });
  });
  afterEach(async () => {
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  test("dot segments and explicitly selected symlink resolve to one identity without renaming", async () => {
    const original = await readFile(path);
    const first = success(await service.select(request));
    await mkdir(join(directory, "sub"));
    for (const entry of [
      `${directory}/./Case.md`,
      `${directory}/sub/../Case.md`,
    ]) {
      selected = entry;
      expect(success(await service.select(request)).documentId).toBe(
        first.documentId
      );
    }
    selected = join(directory, "Alias.markdown");
    await symlink(path, selected);
    const alias = success(await service.select(request));
    expect(alias.documentId).toBe(first.documentId);
    expect(alias.fileName).toBe("Case.md");
    expect(alias.revision).toBe(1);
    expect(await readFile(path)).toEqual(original);
    selected = join(directory, "Relative.md");
    await symlink("Case.md", selected);
    expect(success(await service.select(request)).documentId).toBe(
      first.documentId
    );
  });

  test("case aliases follow the actual volume instead of unconditional lowercase", async () => {
    const first = success(await service.select(request));
    const lower = join(directory, "case.md");
    const distinct = await writeFile(lower, "different", { flag: "wx" }).then(
      () => true,
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        )
          return false;
        throw error;
      }
    );
    if (process.env.AGENTIC_MARKDOWN_TEST_CASE_SENSITIVE === "1")
      expect(distinct).toBe(true);
    selected = lower;
    const second = success(await service.select(request));
    if (distinct) {
      expect(second.documentId).not.toBe(first.documentId);
      expect(second.fileName).toBe("case.md");
      expect(second.text).toBe("different");
    } else {
      expect(second.documentId).toBe(first.documentId);
      expect(second.fileName).toBe("Case.md");
    }
  });

  test("Unicode aliases follow native resolution and preserve actual spelling", async () => {
    selected = join(directory, "Caf\u00e9.md");
    await writeFile(selected, "unicode");
    const first = success(await service.select(request));
    const originalName = first.fileName;
    const decomposed = join(directory, "Cafe\u0301.md");
    const resolves = await realpath(decomposed).then(
      () => true,
      () => false
    );
    if (!resolves)
      await writeFile(decomposed, "different unicode object", { flag: "wx" });
    selected = decomposed;
    const second = success(await service.select(request));
    if (resolves) {
      expect(second.documentId).toBe(first.documentId);
      expect(second.fileName).toBe(originalName);
    } else expect(second.documentId).not.toBe(first.documentId);
  });

  test("retargeting the selected symlink cannot reuse its old grant", async () => {
    const other = join(directory, "Other.md");
    await writeFile(other, "not previously authorized");
    selected = join(directory, "Alias.md");
    await symlink(path, selected);
    const first = success(await service.select(request));
    await unlink(selected);
    await symlink(other, selected);
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "INVALID_HANDLE" });
    const next = success(await service.select(request));
    expect(next.text).toBe("not previously authorized");
    expect(next.documentId).not.toBe(first.documentId);
  });

  test("replacing canonical parent with a symlink revokes even if the target inode is unchanged", async () => {
    const parent = join(directory, "parent");
    await mkdir(parent);
    path = join(parent, "Doc.md");
    await writeFile(path, "same inode");
    selected = path;
    const first = success(await service.select(request));
    const moved = join(directory, "moved");
    await rename(parent, moved);
    await symlink(moved, parent);
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
  });

  test("replacing parent with a different directory revokes even if the file itself is moved back", async () => {
    const parent = join(directory, "parent");
    await mkdir(parent);
    path = join(parent, "Doc.md");
    await writeFile(path, "same inode");
    selected = path;
    const first = success(await service.select(request));
    const moved = join(directory, "moved");
    await rename(parent, moved);
    await mkdir(parent);
    await rename(join(moved, "Doc.md"), path);
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
  });

  test("replacing symlink entry's parent revokes even when canonical target is unaffected", async () => {
    const entryParent = join(directory, "entries");
    await mkdir(entryParent);
    selected = join(entryParent, "Alias.md");
    await symlink(path, selected);
    const first = success(await service.select(request));
    await rename(entryParent, join(directory, "old-entries"));
    await mkdir(entryParent);
    await symlink(path, selected);
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
  });

  test("sibling modifications do not revoke or grant sibling access", async () => {
    const first = success(await service.select(request));
    const other = join(directory, "Other.md");
    await writeFile(other, "private sibling");
    const next = success(
      await service.read({ ...request, handle: first.handle })
    );
    expect(next.documentId).toBe(first.documentId);
    expect(next.revision).toBe(first.revision);
    expect(
      await service.read({ ...request, handle: first.handle, path: other })
    ).toMatchObject({ error: "INVALID_REQUEST" });
  });

  test("replacing a directory before a symlink ancestor revokes unchanged target access", async () => {
    const entries = join(directory, "entries");
    const target = join(directory, "target");
    await mkdir(entries);
    await mkdir(target);
    await writeFile(join(target, "Doc.md"), "unchanged target");
    await symlink(target, join(entries, "link"));
    selected = join(entries, "link", "Doc.md");
    const first = success(await service.select(request));
    await rename(entries, join(directory, "old-entries"));
    await mkdir(entries);
    await symlink(target, join(entries, "link"));
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "FILE_CHANGED" });
    expect(
      await service.read({ ...request, handle: first.handle })
    ).toMatchObject({ error: "INVALID_HANDLE" });
  });

  test("symlink followed by dot-dot respects filesystem traversal order", async () => {
    await mkdir(join(directory, "inside"));
    await mkdir(join(directory, "outside"));
    await mkdir(join(directory, "outside", "child"));
    await writeFile(join(directory, "outside", "Doc.md"), "resolved target");
    await writeFile(join(directory, "inside", "Doc.md"), "lexical trap");
    await symlink(
      join(directory, "outside", "child"),
      join(directory, "inside", "link")
    );
    selected = `${directory}/inside/link/../Doc.md`;
    expect(success(await service.select(request)).text).toBe("resolved target");
  });

  test("dangling, cyclic, relative and NUL paths fail without disclosing selection", async () => {
    const first = success(await service.select(request));
    const dangling = join(directory, "dangling.md");
    const cyclic = join(directory, "cycle.md");
    await symlink(join(directory, "absent.md"), dangling);
    await symlink(cyclic, cyclic);
    for (const bad of [
      dangling,
      cyclic,
      "relative-private.md",
      `${path}/../Case.md`,
      `${path}\0private`,
    ]) {
      selected = bad;
      const failure = await service.select(request);
      expect(failure.ok).toBe(false);
      expect(JSON.stringify(failure)).not.toContain(bad);
    }
    expect(
      success(await service.read({ ...request, handle: first.handle }))
        .documentId
    ).toBe(first.documentId);
  });
});
