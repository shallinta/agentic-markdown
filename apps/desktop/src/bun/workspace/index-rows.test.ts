import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { WorkspaceRequest, WorkspaceRoot } from "../../shared/workspace";
import { createDocumentService } from "../documents";

import { createWorkspaceService } from ".";

const prefix = "f064af-index-rows-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_ROWS_TEST === "1";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const rowId = (scopeKey: string, relative: string) =>
  sha(JSON.stringify([1, "agentic-markdown-index-row", scopeKey, relative])).slice(0, 32);

test.skipIf(isolated)("isolated root-row checks leave app data empty", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const home = join(scratch, "app");
  try {
    await mkdir(home, { mode: 0o700 });
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: home,
        AGENTIC_MARKDOWN_INDEX_ROWS_TEST: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw Error(stdout + stderr);
    expect(stderr).toContain("3 pass");
    expect(await readdir(scratch)).toEqual(["app"]);
    expect(await readdir(home)).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);

async function createFixture() {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "app");
  if (!basename(scratch).startsWith(prefix) || process.env.AGENTIC_MARKDOWN_HOME !== home ||
      !(await lstat(home)).isDirectory())
    throw Error("Missing isolated index-row fixture");
  const parent = await mkdtemp(join(scratch, "root-fixture-"));
  const path = join(parent, "root");
  await mkdir(path);
  const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(path),
    contentSearchStrategy: "direct",
  });
  async function request(input: Omit<WorkspaceRequest, "protocolVersion" | "requestId">) {
    const response = await workspace.request({ protocolVersion: 1, requestId: crypto.randomUUID(), ...input });
    if (!response.ok) throw Error("Workspace fixture command failed: " + response.error);
    return response;
  }
  async function settle() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const state = await request({ op: "state" });
      const root = state.roots.find(({ displayPath }) => displayPath === path);
      if (root?.status === "complete") return root;
      if (root && root.status !== "scanning") throw Error("Fixture scan incomplete: " + root.status);
      await Bun.sleep(2);
    }
    throw Error("Fixture scan did not finish");
  }
  const capture = (root: WorkspaceRoot, signal?: AbortSignal) =>
    workspace.captureIndexRows(root.handle, root.generation, signal);
  async function snapshot(root: WorkspaceRoot, signal?: AbortSignal) {
    const result = await capture(root, signal);
    if (!result.ok) throw Error("Fixture index rows unavailable: " + result.error);
    return result;
  }
  async function entry(root: WorkspaceRoot, relative: string) {
    const page = await request({ op: "page", root: root.handle, generation: root.generation, cursor: 0 });
    const file = page.nodes?.find((node) => node.kind === "file" && node.displayPath === join(path, relative));
    if (!file) throw Error("Missing fixture file entry");
    return file.handle;
  }
  return {
    parent, path, home, documents, capture, snapshot, entry,
    async select(this: void) { await request({ op: "select" }); return settle(); },
    async rescan(this: void, root: WorkspaceRoot) {
      await request({ op: "rescan", root: root.handle });
      return settle();
    },
    async dispose() {
      await workspace.dispose();
      await documents.dispose();
      await rm(parent, { recursive: true, force: true });
    },
  };
}

test.skipIf(!isolated)("index rows preserve original bytes and stable relative-path IDs across fresh scans", async () => {
  const fixture = await createFixture();
  const { parent, path, home, documents, select, rescan, snapshot, entry } = fixture;
  const firstRelative = "甲/同名.md";
  const secondRelative = "乙/同名.md";
  const firstPath = join(path, firstRelative);
  const secondPath = join(path, secondRelative);
  const first = "\uFEFF# 中文\r\n😀target\r\n";
  const second = "# 相同文件名\n";
  const updated = "\uFEFF# 修改\r\n😀target\r\n";
  const replaced = "replacement 😀\n";
  async function expected(root: WorkspaceRoot, scopeKey: string, relative: string, raw: string) {
    const data = Buffer.from(raw);
    return { entry: await entry(root, relative), id: rowId(scopeKey, relative), raw, bytes: data.length, hash: sha(data) };
  }
  try {
    await mkdir(join(path, "甲"));
    await mkdir(join(path, "乙"));
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    const root = await select();
    const initial = await snapshot(root);
    expect(initial.scopeKey).toMatch(/^[0-9a-f]{64}$/);
    const firstRow = await expected(root, initial.scopeKey, firstRelative, first);
    const secondRow = await expected(root, initial.scopeKey, secondRelative, second);
    expect(initial.rows).toHaveLength(2);
    expect(initial.rows).toContainEqual(firstRow);
    expect(initial.rows).toContainEqual(secondRow);
    expect(firstRow.id).toMatch(/^[0-9a-f]{32}$/);
    expect(firstRow.id).not.toBe(secondRow.id);
    expect(firstRow.entry).not.toBe(secondRow.entry);
    expect(initial.current()).toBe(true);
    expect(await initial.verify()).toBe(true);

    const beforeUpdate = await lstat(firstPath);
    await writeFile(firstPath, updated);
    await utimes(firstPath, beforeUpdate.atime, new Date(beforeUpdate.mtimeMs + 10_000));
    expect(await initial.verify()).toBe(false);
    expect(initial.current()).toBe(false);
    const changedRoot = await rescan(root);
    const changed = await snapshot(changedRoot);
    expect(changed.scopeKey).toBe(initial.scopeKey);
    expect(changed.rows).toContainEqual(await expected(changedRoot, initial.scopeKey, firstRelative, updated));
    expect(changed.rows.find(({ id }) => id === firstRow.id)?.hash).not.toBe(firstRow.hash);
    expect(changed.rows.find(({ id }) => id === secondRow.id)?.hash).toBe(secondRow.hash);

    await rename(firstPath, join(parent, "parked-original.md"));
    await writeFile(firstPath, replaced);
    expect(await changed.verify()).toBe(false);
    const replacedRoot = await rescan(changedRoot);
    const replacement = await snapshot(replacedRoot);
    expect(replacement.scopeKey).toBe(initial.scopeKey);
    expect(replacement.rows).toContainEqual(await expected(replacedRoot, initial.scopeKey, firstRelative, replaced));

    const renamedRelative = "甲/改名.md";
    await rename(firstPath, join(path, renamedRelative));
    expect(await replacement.verify()).toBe(false);
    const renamedRoot = await rescan(replacedRoot);
    const renamed = await snapshot(renamedRoot);
    expect(renamed.scopeKey).toBe(initial.scopeKey);
    expect(renamed.rows).toContainEqual(await expected(renamedRoot, initial.scopeKey, renamedRelative, replaced));
    expect(renamed.rows.some(({ id }) => id === firstRow.id)).toBe(false);
    expect(await renamed.verify()).toBe(true);
    expect(await readFile(join(path, renamedRelative))).toEqual(Buffer.from(replaced));
    expect(await readFile(secondPath)).toEqual(Buffer.from(second));
    expect(await readFile(join(parent, "parked-original.md"))).toEqual(Buffer.from(updated));
    expect(documents.locations()).toEqual([]);
    expect(await readdir(home)).toEqual([]);
  } finally {
    await fixture.dispose();
  }
}, 10_000);

test.skipIf(!isolated)("empty and exact-size snapshots succeed, while Trash, oversized and invalid UTF-8 return no rows", async () => {
  const fixture = await createFixture();
  const { path, home, documents, select, rescan, capture, snapshot } = fixture;
  const smallPath = join(path, "unicode.md");
  const largePath = join(path, "full.md");
  const unicode = Buffer.from("\uFEFF😀\r\n");
  const large = Buffer.alloc(65_536 - unicode.length, 0x61);
  try {
    const root = await select();
    const empty = await snapshot(root);
    expect(empty.rows).toEqual([]);
    expect(await empty.verify()).toBe(true);
    documents.setTrashGuard((candidate) => candidate === path);
    expect(await capture(root)).toEqual({ ok: false, error: "BUSY" });
    expect(await empty.verify()).toBe(false);
    documents.setTrashGuard(() => false);
    expect(empty.current()).toBe(false);
    expect(await empty.verify()).toBe(false);

    await writeFile(smallPath, unicode);
    await writeFile(largePath, large);
    const fullRoot = await rescan(root);
    const full = await snapshot(fullRoot);
    expect(full.rows.reduce((bytes, row) => bytes + row.bytes, 0)).toBe(65_536);
    expect(full.rows.find(({ id }) => id === rowId(full.scopeKey, "unicode.md")))
      .toMatchObject({ bytes: unicode.length, raw: "\uFEFF😀\r\n", hash: sha(unicode) });
    expect(full.rows.find(({ id }) => id === rowId(full.scopeKey, "full.md")))
      .toMatchObject({ bytes: large.length, raw: large.toString(), hash: sha(large) });
    expect(await full.verify()).toBe(true);
    documents.setTrashGuard((candidate) => candidate === largePath);
    expect(await capture(fullRoot)).toEqual({ ok: false, error: "BUSY" });
    expect(await full.verify()).toBe(false);
    documents.setTrashGuard(() => false);

    const oversized = Buffer.concat([large, Buffer.of(0x61)]);
    await writeFile(largePath, oversized);
    const overRoot = await rescan(fullRoot);
    expect(await capture(overRoot)).toEqual({ ok: false, error: "LIMIT" });
    expect(await readFile(largePath)).toEqual(oversized);

    const invalid = Buffer.of(0xf0, 0x28, 0x8c, 0x28);
    await writeFile(largePath, invalid);
    const invalidRoot = await rescan(overRoot);
    expect(await capture(invalidRoot)).toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(await readFile(largePath)).toEqual(invalid);
    expect(await readFile(smallPath)).toEqual(unicode);
    await Promise.all(Array.from({ length: 15 }, (_, n) => writeFile(join(path, `empty-${n}.md`), "")));
    const overCount = await rescan(invalidRoot);
    expect(overCount.entries).toBe(17);
    expect(await capture(overCount)).toEqual({ ok: false, error: "LIMIT" });
    expect(documents.locations()).toEqual([]);
    expect(await readdir(home)).toEqual([]);
  } finally {
    await fixture.dispose();
  }
}, 10_000);

test.skipIf(!isolated)("changing an earlier read or cancelling mid-snapshot drops all rows and frees the task", async () => {
  const fixture = await createFixture();
  const { path, home, documents, select, rescan, capture, snapshot } = fixture;
  const a = join(path, "a.md");
  const b = join(path, "b.md");
  const source = new Map([[a, "first"], [b, "other"]]);
  try {
    for (const [file, raw] of source) await writeFile(file, raw);
    const root = await select();
    const started = new AbortController();
    started.abort();
    expect(await capture(root, started.signal)).toEqual({ ok: false, error: "CANCELLED" });

    let earlier: string | undefined;
    let mutated = false;
    documents.setTrashGuard((candidate) => {
      if (!source.has(candidate)) return false;
      if (!earlier) earlier = candidate;
      else if (!mutated && candidate !== earlier) {
        // The first pass authorizes, reads and closes each file before
        // checking Trash for the next candidate.
        const stat = lstatSync(earlier);
        writeFileSync(earlier, "newer");
        utimesSync(earlier, stat.atime, new Date(stat.mtimeMs + 10_000));
        const changed = lstatSync(earlier);
        expect(changed.ino).toBe(stat.ino);
        expect(changed.size).toBe(stat.size);
        expect(changed.mtimeMs).toBeGreaterThan(stat.mtimeMs);
        mutated = true;
      }
      return false;
    });
    const stale = await capture(root);
    expect(mutated).toBe(true);
    expect(stale).toEqual({ ok: false, error: "STALE" });
    if (!earlier) throw Error("Missing first fixture read");
    expect(readFileSync(earlier, "utf8")).toBe("newer");
    const other = earlier === a ? b : a;
    const untouched = source.get(other);
    if (untouched === undefined) throw Error("Missing second fixture body");
    expect(await readFile(other, "utf8")).toBe(untouched);
    documents.setTrashGuard(() => false);
    const rescanned = await rescan(root);
    expect((await snapshot(rescanned)).rows.map(({ raw }) => raw).sort())
      .toEqual(["newer", untouched].sort());

    const cancel = new AbortController();
    const visited = new Set<string>();
    documents.setTrashGuard((candidate) => {
      if (source.has(candidate)) {
        visited.add(candidate);
        if (visited.size === 2) cancel.abort();
      }
      return false;
    });
    const pending = capture(rescanned, cancel.signal);
    expect(await capture(rescanned)).toEqual({ ok: false, error: "BUSY" });
    expect(await pending).toEqual({ ok: false, error: "CANCELLED" });
    expect(visited.size).toBe(2);
    documents.setTrashGuard(() => false);
    const proofSignal = new AbortController();
    const fresh = await snapshot(rescanned, proofSignal.signal);
    expect(fresh.rows).toHaveLength(2);
    const verifying = fresh.verify();
    const concurrentVerify = fresh.verify();
    const concurrentCapture = capture(rescanned);
    expect(await concurrentVerify).toBe(false);
    expect(await concurrentCapture).toEqual({ ok: false, error: "BUSY" });
    expect(await verifying).toBe(true);
    expect(fresh.current()).toBe(true);
    expect((await snapshot(rescanned)).rows).toEqual(fresh.rows);
    proofSignal.abort();
    expect(fresh.current()).toBe(false);
    expect(await fresh.verify()).toBe(false);
    expect(documents.locations()).toEqual([]);
    expect(await readdir(home)).toEqual([]);
  } finally {
    await fixture.dispose();
  }
}, 10_000);
