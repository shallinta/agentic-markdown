import { expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { WorkspaceRequest, WorkspaceRoot } from "../../shared/workspace";
import { createDocumentService } from "../documents";

import { createScanWorker } from "./worker";

import { createWorkspaceService } from ".";

const prefix = "f064ae-index-scope-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_SCOPE_TEST === "1";

test.skipIf(isolated)("isolated root-scope checks leave app data empty", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const home = join(scratch, "app");
  try {
    await mkdir(home, { mode: 0o700 });
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: home,
        AGENTIC_MARKDOWN_INDEX_SCOPE_TEST: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw Error(stdout + stderr);
    expect(stderr).toContain("4 pass");
    expect(await readdir(scratch)).toEqual(["app"]);
    expect(await readdir(home)).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);

async function createFixture(fakeWatch = false) {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "app");
  if (!basename(scratch).startsWith(prefix) || process.env.AGENTIC_MARKDOWN_HOME !== home ||
      !(await lstat(home)).isDirectory())
    throw Error("Missing isolated root scope fixture");
  const parent = await mkdtemp(join(scratch, "root-fixture-"));
  let selected: string | null = null;
  const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const scanner = createScanWorker();
  const gate = Promise.withResolvers<void>();
  const watchKeys = new Set<unknown>();
  let watchStarts = 0, reportedWatchStarts = 0;
  let delayStart = false;
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(selected),
    worker: {
      call: async (message) => {
        if (delayStart && message.op === "start") await gate.promise;
        if (fakeWatch && message.op === "watchStart") {
          watchKeys.add(message.key);
          watchStarts++;
          return { bytes: 0 };
        }
        if (fakeWatch && message.op === "watchClose") {
          watchKeys.delete(message.key);
          return { bytes: 0 };
        }
        if (fakeWatch && message.op === "watchTick") {
          if (watchKeys.size) reportedWatchStarts = watchStarts;
          return {
            bytes: 0, queueBytes: 0,
            roots: [...watchKeys].map(key => ({ key, dirty: false, status: "watching" })),
          };
        }
        return scanner.call(message);
      },
      dispose: () => scanner.dispose(),
    },
    contentSearchStrategy: "direct",
  });
  async function request(input: Omit<WorkspaceRequest, "protocolVersion" | "requestId">) {
    const response = await workspace.request({ protocolVersion: 1, requestId: crypto.randomUUID(), ...input });
    if (!response.ok) throw Error("Workspace fixture command failed: " + response.error);
    return response;
  }
  async function select(path: string) {
    selected = path;
    const state = await request({ op: "select" });
    const canonical = await realpath(path);
    const root = state.roots.find(({ displayPath }) => displayPath === canonical);
    if (!root) throw Error("Fixture root was not selected");
    return root;
  }
  async function settle(path: string, expectedWatchStarts = 0) {
    const canonical = await realpath(path);
    for (let attempt = 0; attempt < 1000; attempt++) {
      const state = await request({ op: "state" });
      const root = state.roots.find(({ displayPath }) => displayPath === canonical);
      if (root?.status === "complete") {
        if (!expectedWatchStarts || (reportedWatchStarts >= expectedWatchStarts &&
            root.observation === "watching")) return root;
      } else if (root && root.status !== "scanning") throw Error("Fixture scan incomplete: " + root.status);
      await Bun.sleep(2);
    }
    throw Error("Fixture scan did not finish");
  }
  const capture = (root: WorkspaceRoot, signal?: AbortSignal) =>
    workspace.captureIndexScope(root.handle, root.generation, signal);
  async function ticket(root: WorkspaceRoot, signal?: AbortSignal) {
    const result = await capture(root, signal);
    if (!result.ok) throw Error("Fixture root scope unavailable: " + result.error);
    return result;
  }
  return {
    parent, documents, select, settle, request, capture, ticket, workspace,
    holdFirstScan() { delayStart = true; },
    releaseScan() { delayStart = false; gate.resolve(); },
    async dispose() {
      gate.resolve();
      await workspace.dispose();
      await documents.dispose();
      await rm(parent, { recursive: true, force: true });
    },
  };
}

test.skipIf(!isolated)("the trusted watch hint requires the exact authorized root and scan generation", async () => {
  const fixture = await createFixture(true);
  const { parent, select, settle, request, workspace } = fixture;
  const path = join(parent, "root");
  try {
    await mkdir(path);
    await writeFile(join(path, "note.md"), "fixture");
    fixture.holdFirstScan();
    const scanning = await select(path);
    const watch = (root: WorkspaceRoot) => workspace.captureIndexWatchHint(root.handle, root.generation);
    expect(watch(scanning)).toEqual({ ok: false, error: "NOT_READY" });
    fixture.releaseScan();
    const root = await settle(path, 1);
    expect(watch({ ...root, handle: crypto.randomUUID() })).toEqual({ ok: false, error: "STALE" });
    expect(watch({ ...root, generation: root.generation + 1 })).toEqual({ ok: false, error: "STALE" });
    const first = watch(root);
    if (!first.ok) throw Error("Fixture watcher unavailable: " + first.error);
    expect(Object.keys(first).sort()).toEqual(["current", "ok"]);
    expect(first.current()).toBe(true);

    await request({ op: "hidden", root: root.handle, showHidden: true });
    expect(first.current()).toBe(false);
    const nextRoot = await settle(path, 2);
    expect(nextRoot.generation).toBeGreaterThan(root.generation);
    expect(watch(root)).toEqual({ ok: false, error: "STALE" });
    const second = watch(nextRoot);
    if (!second.ok) throw Error("New fixture watcher unavailable: " + second.error);
    expect(second.current()).toBe(true);
    expect(first.current()).toBe(false);
    await workspace.dispose();
    expect(second.current()).toBe(false);
    expect(watch(nextRoot)).toEqual({ ok: false, error: "STALE" });
    expect(await readFile(join(path, "note.md"), "utf8")).toBe("fixture");
  } finally {
    await fixture.dispose();
  }
}, 10_000);

test.skipIf(!isolated)("a physical root keeps its key across rescan and rejoin but the live proof and hidden policy change", async () => {
  const fixture = await createFixture();
  const { parent, select, settle, request, capture, ticket, workspace } = fixture;
  const path = join(parent, "root");
  const file = join(path, "note.md");
  try {
    await mkdir(path);
    await writeFile(file, "# first");
    await writeFile(join(path, ".hidden.md"), "# hidden");
    fixture.holdFirstScan();
    const scanning = await select(path);
    expect(scanning.status).toBe("scanning");
    expect(await capture(scanning)).toEqual({ ok: false, error: "NOT_READY" });
    fixture.releaseScan();
    const firstRoot = await settle(path);
    const first = await ticket(firstRoot);
    expect(Object.keys(first).sort()).toEqual(["current", "ok", "scopeKey", "verify"]);
    expect(first.scopeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.current()).toBe(true);
    expect(await first.verify()).toBe(true);
    expect(await workspace.captureIndexScope(crypto.randomUUID(), firstRoot.generation))
      .toEqual({ ok: false, error: "STALE" });
    expect(await capture({ ...firstRoot, generation: firstRoot.generation + 1 }))
      .toEqual({ ok: false, error: "STALE" });

    await writeFile(file, "# edited but still authorized");
    await request({ op: "rescan", root: firstRoot.handle });
    expect(first.current()).toBe(false);
    expect(await first.verify()).toBe(false);
    expect(await capture(firstRoot)).toEqual({ ok: false, error: "STALE" });
    const rescanned = await settle(path);
    expect(rescanned.generation).toBeGreaterThan(firstRoot.generation);
    const second = await ticket(rescanned);
    expect(second.scopeKey).toBe(first.scopeKey);
    await request({ op: "clear" });
    expect(second.current()).toBe(false);
    expect(await second.verify()).toBe(false);
    expect(await capture(rescanned)).toEqual({ ok: false, error: "STALE" });

    await select(path);
    const rejoined = await settle(path);
    expect(rejoined.handle).not.toBe(firstRoot.handle);
    const third = await ticket(rejoined);
    expect(third.scopeKey).toBe(first.scopeKey);
    await request({ op: "hidden", root: rejoined.handle, showHidden: true });
    expect(third.current()).toBe(false);
    expect(await third.verify()).toBe(false);
    const shown = await settle(path);
    expect(shown.showHidden).toBe(true);
    expect((await ticket(shown)).scopeKey).not.toBe(first.scopeKey);
    await request({ op: "hidden", root: shown.handle, showHidden: false });
    expect((await ticket(await settle(path))).scopeKey).toBe(first.scopeKey);
    expect(await readFile(file, "utf8")).toBe("# edited but still authorized");
    expect(fixture.documents.locations()).toEqual([]);
  } finally {
    await fixture.dispose();
  }
}, 10_000);

test.skipIf(!isolated)("a same-path root replacement and ancestor symlink cannot reuse an earlier physical proof", async () => {
  const fixture = await createFixture();
  const { parent, select, settle, request, capture, ticket } = fixture;
  const ancestor = join(parent, "ancestor");
  const root = join(ancestor, "root");
  const oldRoot = join(ancestor, "parked-root");
  const oldAncestor = join(parent, "parked-ancestor");
  try {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "same.md"), "first");
    await select(root);
    const original = await settle(root);
    const first = await ticket(original);
    await rename(root, oldRoot);
    await mkdir(root);
    await writeFile(join(root, "same.md"), "replacement");
    expect(await first.verify()).toBe(false);
    expect(await capture(original)).toMatchObject({ ok: false });
    await request({ op: "clear" });
    await select(root);
    const replacement = await settle(root);
    expect(replacement.displayPath).toBe(original.displayPath);
    const second = await ticket(replacement);
    expect(second.scopeKey).not.toBe(first.scopeKey);
    expect(await second.verify()).toBe(true);

    const canonical = await realpath(root);
    await rename(ancestor, oldAncestor);
    await symlink(oldAncestor, ancestor, "dir");
    expect((await lstat(ancestor)).isSymbolicLink()).toBe(true);
    expect(await realpath(root)).not.toBe(canonical);
    expect(await second.verify()).toBe(false);
    expect(await capture(replacement)).toMatchObject({ ok: false });
    expect(await readFile(join(root, "same.md"), "utf8")).toBe("replacement");
    await rm(ancestor);
    await rename(oldAncestor, ancestor);
    expect(second.current()).toBe(false);
    expect(await second.verify()).toBe(false);
    await request({ op: "clear" });
    await select(root);
    expect((await ticket(await settle(root))).scopeKey).toBe(second.scopeKey);
  } finally {
    await fixture.dispose();
  }
}, 10_000);

test.skipIf(!isolated)("scope captures obey cancellation and the file cap without decoding any body", async () => {
  const fixture = await createFixture();
  const { parent, select, settle, request, capture, ticket } = fixture;
  const path = join(parent, "root");
  const invalid = Uint8Array.of(0xff, 0xfe, 0x00);
  const oversized = Buffer.alloc(65_537, 0x61);
  try {
    await mkdir(path);
    await writeFile(join(path, "bad-utf8.md"), invalid);
    await writeFile(join(path, "over-budget.md"), oversized);
    await Promise.all(Array.from({ length: 14 }, (_, index) =>
      writeFile(join(path, `note-${index}.md`), "fixture")
    ));
    await select(path);
    const root = await settle(path);
    expect(root.entries).toBe(16);
    const controller = new AbortController();
    controller.abort();
    expect(await capture(root, controller.signal)).toEqual({ ok: false, error: "CANCELLED" });
    const mid = new AbortController();
    const pending = capture(root, mid.signal);
    expect(await capture(root)).toEqual({ ok: false, error: "BUSY" });
    mid.abort();
    expect(await pending).toEqual({ ok: false, error: "CANCELLED" });
    const guard = new AbortController();
    const verified = await ticket(root, guard.signal);
    expect(await verified.verify()).toBe(true);
    guard.abort();
    expect(verified.current()).toBe(false);
    expect(await verified.verify()).toBe(false);
    expect(await readFile(join(path, "bad-utf8.md"))).toEqual(Buffer.from(invalid));
    expect(await readFile(join(path, "over-budget.md"))).toEqual(oversized);
    expect(fixture.documents.locations()).toEqual([]);
    await writeFile(join(path, "seventeenth.md"), "fixture");
    await request({ op: "rescan", root: root.handle });
    const tooMany = await settle(path);
    expect(tooMany.entries).toBe(17);
    expect(await capture(tooMany)).toEqual({ ok: false, error: "LIMIT" });
  } finally {
    await fixture.dispose();
  }
}, 10_000);
