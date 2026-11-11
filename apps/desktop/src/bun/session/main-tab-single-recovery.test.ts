import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMainTabCheckpointMetadataStore, type MainTabSessionMetadata } from "./main-tab-metadata";

async function child(operation: "write" | "read" | "reject", directory: string): Promise<unknown> {
  const processHandle = Bun.spawn([
    process.execPath, join(import.meta.dir, "main-tab-single-recovery-child.ts"), operation, directory,
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(), processHandle.exited,
  ]);
  if (code !== 0) throw Error(`Recovery ${operation} failed (${code})\n${stderr}`);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as unknown;
}

test("an independent process reads exactly one reauthorized saved tab and settles its new grant", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "single-tab-recovery-")));
  const folder = join(directory, "workspace");
  const file = join(folder, "original.md");
  const checkpoint = join(directory, "metadata", "main-tab-session-checkpoint.json");
  try {
    await mkdir(folder);
    await writeFile(file, "# Original contents\n");
    await writeFile(join(folder, "sentinel.md"), "# Existing grant\n");
    expect(await child("write", directory)).toEqual({ written: { status: "committed" }, mruUnchanged: true });
    const authority = await readFile(checkpoint);
    const initialFile = await stat(file, { bigint: true });
    await writeFile(file, "# Current contents\n");
    const changedFile = await stat(file, { bigint: true });
    expect([changedFile.dev, changedFile.ino]).toEqual([initialFile.dev, initialFile.ino]);
    expect(await child("read", directory)).toEqual({
      initial: { pending: 1, roots: 0, grants: 0 }, proof: true, grants: 1, mode: "source", pinned: true,
      currentText: true, treeAuthority: true, released: "released", releasedProof: false,
      finalGrants: 0, metadataUnchanged: true, mruUnchanged: true,
    });
    expect(await readFile(checkpoint)).toEqual(authority);
    expect(await readFile(file, "utf8")).toBe("# Current contents\n");

    expect(await child("reject", directory)).toEqual({
      initial: { pending: 1, roots: 0, grants: 0 }, wrongRoot: "rejected:unavailable", expired: "rejected:stale",
      protectedResults: Array.from({ length: 3 }, () => ({ result: "rejected:unavailable", preserved: true })),
      changedRecord: "rejected:stale", afterReread: "rejected:stale", racedPublication: "committed", priorGrantKept: true,
      staleAfterOpen: "rejected:stale", priorGrantKeptAfterOpen: true,
      lateReleased: { result: "rejected:stale", count: 0, releases: 1 },
      unknownRelease: { result: "unknown:release", count: 1, releases: 1 }, existing: "rejected:unavailable",
      existingKept: true, staleGeneration: "rejected:stale", replacement: "rejected:unavailable", finalGrants: 0,
      metadataUnchanged: true, backupUnchanged: true, mruUnchanged: true,
    });
    expect(await readFile(checkpoint)).toEqual(authority);
    expect(await readFile(join(folder, "old.md"), "utf8")).toBe("# Current contents\n");
    expect(await readFile(file, "utf8")).toBe("# A different file\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("same-path owned clear invalidates old observations and fences a queued read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "single-tab-observation-"));
  const writer = createMainTabCheckpointMetadataStore(directory);
  const reader = createMainTabCheckpointMetadataStore(`${directory}/.`);
  try {
    const saved: MainTabSessionMetadata = { tabs: [{ rootId: crypto.randomUUID(), relativePath: "a.md", fingerprint: "1:2:3", pinned: false, mode: "editing" }], activeIndex: 0 };
    expect(await writer.write(saved, () => true)).toEqual({ status: "committed" });
    const before = await reader.readObserved();
    if (before.status !== "valid") throw Error(before.status);
    expect(before.current()).toBe(true);
    const clearing = writer.clearOwned(() => true);
    expect(before.current()).toBe(false);
    expect(await reader.readObserved()).toEqual({ status: "stale" });
    expect(await clearing).toEqual({ status: "committed" });
    const empty = await reader.readObserved();
    if (empty.status !== "valid") throw Error(empty.status);
    expect(empty.data).toEqual({ tabs: [], activeIndex: null });
    expect(empty.current()).toBe(true);
    await reader.close();
    expect(empty.current()).toBe(false);
  } finally {
    await Promise.all([writer.close(), reader.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});
