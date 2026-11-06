import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, rmdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { WorkspaceRequest, WorkspaceRoot } from "../../shared/workspace";
import { createDocumentService } from "../documents";
import { searchAppIndexCache } from "../index/app-cache";
import { record } from "../index/protocol";

import { createWorkspaceService } from ".";

const prefix = "f064aj-index-readonly-search-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_READONLY_SEARCH_TEST === "1";
const fail = <E extends string>(error: E) => ({ ok: false as const, error });

test.skipIf(isolated)("isolated workspace index query leaves no fixture data", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: join(scratch, "app"),
        AGENTIC_MARKDOWN_INDEX_READONLY_SEARCH_TEST: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw Error(stdout + stderr);
    expect(stderr).toContain("1 pass");
    expect(await readdir(scratch)).toEqual([]);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(!isolated)("fresh workspace proofs fence existing-index query from preflight through publication", async () => {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "app");
  if (!basename(scratch).startsWith(prefix) ||
      process.env.AGENTIC_MARKDOWN_HOME !== home || (await readdir(scratch)).length)
    throw Error("Missing isolated read-only index search fixture");
  const rootPath = join(scratch, "root");
  const otherPath = join(scratch, "foreign");
  const profile = join(home, "search-index", "limited-v1");
  const catalog = join(profile, "catalog.json");
  const index = join(profile, "index");
  const firstPath = join(rootPath, "first.md");
  const secondPath = join(rootPath, "second.md");
  const first = "\uFEFF# 中文\r\n😀target\r\n";
  const second = "开头😀 target target\r\n";
  const changed = first.replace("中文", "改文");
  const foreignBody = "foreign target";
  const query = "target";
  const OriginalWorker = globalThis.Worker;
  const closeAll: (() => Promise<void>)[] = [];
  const operations: unknown[] = [];
  let nativeWorkers = 0;
  let holdQuery: ((resume: () => void) => void) | undefined;

  class RecordingWorker extends OriginalWorker {
    readonly indexWorker: boolean;
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      this.indexWorker = basename(String(args[0])) === "index-worker.js";
      if (this.indexWorker) nativeWorkers++;
    }
    override postMessage(message: unknown) {
      if (this.indexWorker && record(message)) {
        const { op, payload } = message;
        operations.push(op === "open" && record(payload) ? [op, payload.mode] : op);
        if (op === "query" && holdQuery) {
          const held = holdQuery;
          holdQuery = undefined;
          held(() => super.postMessage(message));
          return;
        }
      }
      super.postMessage(message);
    }
  }
  const readonlyOperations = [["open", "reader-only"], "verify-roster", "query", "close"];

  function workspaceFor(path: string) {
    const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
    const workspace = createWorkspaceService({
      documents, pickDirectory: () => Promise.resolve(path), contentSearchStrategy: "direct",
    });
    let closed = false;
    async function close() {
      if (closed) return;
      closed = true;
      try { await workspace.dispose(); }
      finally { await documents.dispose(); }
    }
    closeAll.push(close);
    async function request(input: Omit<WorkspaceRequest, "protocolVersion" | "requestId">) {
      const result = await workspace.request({ protocolVersion: 1, requestId: crypto.randomUUID(), ...input });
      if (!result.ok) throw Error("Fixture workspace request failed: " + result.error);
      return result;
    }
    async function settle() {
      for (let attempt = 0; attempt < 1000; attempt++) {
        const root = (await request({ op: "state" })).roots.find(({ displayPath }) => displayPath === path);
        if (root?.status === "complete") return root;
        if (root && root.status !== "scanning") throw Error("Fixture scan incomplete: " + root.status);
        await Bun.sleep(2);
      }
      throw Error("Fixture scan did not finish");
    }
    const search = (root: WorkspaceRoot, text = query, signal?: AbortSignal) =>
      workspace.searchExistingIndex(root.handle, root.generation, text, signal);
    return {
      documents, close, search,
      rows: (root: WorkspaceRoot) => workspace.captureIndexRows(root.handle, root.generation),
      async join(this: void) { await request({ op: "select" }); return settle(); },
      async rescan(this: void, root: WorkspaceRoot) {
        await request({ op: "rescan", root: root.handle });
        return settle();
      },
      async file(this: void, root: WorkspaceRoot, name: string) {
        const page = await request({ op: "page", root: root.handle, generation: root.generation, cursor: 0 });
        const item = page.nodes?.find((node) => node.kind === "file" && node.name === name);
        if (!item) throw Error("Missing fixture file");
        return item.handle;
      },
      async heldSearch(this: void, root: WorkspaceRoot, signal?: AbortSignal) {
        const entered = Promise.withResolvers<() => void>();
        holdQuery = entered.resolve;
        const pending = search(root, query, signal);
        const resume = await Promise.race([
          entered.promise, pending.then((result) => { throw Error("Expected native query: " + JSON.stringify(result)); }),
        ]);
        return { pending, resume };
      },
    };
  }
  async function snapshotStorage() {
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    const files = [catalog, ...(await readdir(index)).sort().map((name) => join(index, name))];
    return Promise.all(files.map(async (path) => {
      const stat = await lstat(path, { bigint: true });
      return {
        path, ino: stat.ino, mode: stat.mode, size: stat.size, mtime: stat.mtimeNs,
        hash: createHash("sha256").update(await readFile(path)).digest("hex"),
      };
    }));
  }
  async function closeWorkspaces() {
    const closed = await Promise.allSettled(closeAll.map((close) => close()));
    if (closed.some((result) => result.status === "rejected"))
      throw Error("Fixture workspace cleanup failed");
  }

  try {
    await mkdir(home, { mode: 0o700 });
    await mkdir(rootPath);
    await mkdir(otherPath);
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    await writeFile(join(otherPath, "foreign.md"), foreignBody);
    Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
    const initial = workspaceFor(rootPath);
    const initialRoot = await initial.join();
    expect(await initial.search(initialRoot)).toEqual(fail("MISSING"));
    expect(await readdir(home)).toEqual([]);
    expect(nativeWorkers).toBe(0);
    const initialEntry = await initial.file(initialRoot, "first.md");
    const seed = await initial.rows(initialRoot);
    if (!seed.ok) throw Error("No authorized fixture for cache setup: " + seed.error);
    expect(await seed.verify()).toBe(true);
    expect(await searchAppIndexCache({
      scopeKey: seed.scopeKey, rows: seed.rows.map(({ id, raw }) => ({ id, raw })), query,
    }, seed.current)).toMatchObject({ ok: true, generation: 1, applied: 2 });
    expect(await seed.verify()).toBe(true);
    await initial.close();
    expect(seed.current()).toBe(false);
    const storage = await snapshotStorage();

    const live = workspaceFor(rootPath);
    const root = await live.join();
    expect(root.handle).not.toBe(initialRoot.handle);
    const firstEntry = await live.file(root, "first.md");
    expect(firstEntry).not.toBe(initialEntry);
    const secondEntry = await live.file(root, "second.md");
    const sortHits = (a: { entry: string }, b: { entry: string }) => a.entry.localeCompare(b.entry);
    const hits = [
      { entry: firstEntry, from: 9, to: 15 },
      { entry: secondEntry, from: 5, to: 11 },
    ].sort(sortHits);
    nativeWorkers = 0;
    operations.length = 0;
    const result = await live.search(root);
    if (!result.ok) throw Error("Read-only fixture query failed: " + result.error);
    expect({ ...result, hits: [...result.hits].sort(sortHits) }).toEqual({ ok: true, hits });
    expect(nativeWorkers).toBe(1);
    expect(operations.splice(0)).toEqual(readonlyOperations);
    expect(await snapshotStorage()).toEqual(storage);
    expect(live.documents.locations()).toEqual([]);

    nativeWorkers = 0;
    expect(await live.search(root, "")).toEqual(fail("INPUT"));
    expect(await live.search(root, "\ud800")).toEqual(fail("INPUT"));
    expect(await live.search({ ...root, generation: root.generation + 1 })).toEqual(fail("STALE"));
    expect(await live.search(initialRoot)).toEqual(fail("STALE"));
    const aborted = new AbortController();
    aborted.abort();
    expect(await live.search(root, query, aborted.signal)).toEqual(fail("CANCELLED"));
    const foreign = workspaceFor(otherPath);
    expect(await foreign.search(await foreign.join())).toEqual(fail("SCHEMA"));
    await writeFile(firstPath, changed);
    const edited = await live.rescan(root);
    expect(await live.search(edited)).toEqual(fail("MISMATCH"));
    expect(nativeWorkers).toBe(0);
    expect(operations).toEqual([]);
    expect(await snapshotStorage()).toEqual(storage);

    await writeFile(firstPath, first);
    const restored = await live.rescan(edited);
    const cancellation = new AbortController();
    const held = await live.heldSearch(restored, cancellation.signal);
    try {
      expect(await readdir(profile)).toContain(".lease");
      expect(await live.search(restored)).toEqual(fail("BUSY"));
      expect(await live.rows(restored)).toEqual(fail("BUSY"));
      cancellation.abort();
      expect(await live.search(restored)).toEqual(fail("BUSY"));
    } finally {
      held.resume();
    }
    expect(await held.pending).toEqual(fail("CANCELLED"));
    expect(nativeWorkers).toBe(1);
    expect(operations.splice(0)).toEqual(readonlyOperations);
    expect(await snapshotStorage()).toEqual(storage);

    const late = await live.heldSearch(restored);
    try {
      const before = await lstat(firstPath, { bigint: true });
      await writeFile(firstPath, changed);
      await utimes(firstPath, before.atime, new Date(Number(before.mtimeMs) + 10_000));
      const after = await lstat(firstPath, { bigint: true });
      expect({ dev: after.dev, ino: after.ino, size: after.size }).toEqual({
        dev: before.dev, ino: before.ino, size: before.size,
      });
      expect(after.mtimeNs > before.mtimeNs).toBe(true);
    } finally {
      late.resume();
    }
    expect(await late.pending).toEqual(fail("STALE"));
    expect(nativeWorkers).toBe(2);
    expect(operations.splice(0)).toEqual(readonlyOperations);
    expect(await snapshotStorage()).toEqual(storage);
    expect(await readFile(firstPath, "utf8")).toBe(changed);
    expect(await readFile(secondPath, "utf8")).toBe(second);
    expect(await readFile(join(otherPath, "foreign.md"), "utf8")).toBe(foreignBody);
    await writeFile(firstPath, first);
    const next = await live.rescan(restored);
    expect(await live.search(next)).toMatchObject({ ok: true });
    expect(await readFile(firstPath, "utf8")).toBe(first);
    expect(await snapshotStorage()).toEqual(storage);

    // A controlled lease cleanup failure stays UNKNOWN even when the caller
    // cancelled. The original lease and marker must not be reclaimed.
    const uncertainSignal = new AbortController();
    const uncertain = await live.heldSearch(next, uncertainSignal.signal);
    const lease = join(profile, ".lease");
    const marker = join(lease, "fixture-blocks-release");
    try {
      await writeFile(marker, "keep", { flag: "wx", mode: 0o600 });
      uncertainSignal.abort();
    } finally {
      uncertain.resume();
    }
    expect(await uncertain.pending).toEqual(fail("UNKNOWN"));
    expect(await readFile(marker, "utf8")).toBe("keep");
    expect(await live.search(next)).toEqual(fail("BUSY"));
    await rm(marker);
    await rmdir(lease);
    expect(await snapshotStorage()).toEqual(storage);
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    try {
      await closeWorkspaces();
    } finally {
      await Promise.all([rootPath, otherPath, home].map((path) => rm(path, { recursive: true, force: true })));
    }
  }
}, 15_000);
