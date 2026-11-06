import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { WorkspaceRequest, WorkspaceRoot } from "../../shared/workspace";
import { createDocumentService } from "../documents";
import { record } from "../index/protocol";

import { createScanWorker } from "./worker";

import { createWorkspaceService } from ".";

const prefix = "f064bh-index-prepare-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_PREPARE_OBSERVED_TEST === "1";
const fail = <E extends string>(error: E) => ({ ok: false as const, error });
const first = "\uFEFF# 中文\r\n😀target\r\n";
const second = "没有匹配词的行\n";

test.skipIf(isolated)("isolated observed preparation exits with a clean fixture", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: join(scratch, "app"),
        AGENTIC_MARKDOWN_INDEX_PREPARE_OBSERVED_TEST: "1",
      },
      stdout: "pipe", stderr: "pipe",
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
}, 20_000);

async function awaitFixture<T>(ready: () => T | undefined | Promise<T | undefined>) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const value = await ready();
    if (value !== undefined) return value;
    await Bun.sleep(2);
  }
  throw Error("Fixture did not settle");
}

test.skipIf(!isolated)("only current observed root rows prepare a cold index with verified native receipts", async () => {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "app");
  if (!basename(scratch).startsWith(prefix) ||
      process.env.AGENTIC_MARKDOWN_HOME !== home || (await readdir(scratch)).length)
    throw Error("Missing isolated observed index preparation fixture");
  const rootPath = join(scratch, "root");
  const firstPath = join(rootPath, "first.md");
  const secondPath = join(rootPath, "second.md");
  const profile = join(home, "search-index", "limited-v1");
  const catalog = join(profile, "catalog.json");
  const index = join(profile, "index");
  const lease = join(profile, ".lease");
  const OriginalWorker = globalThis.Worker;
  const operations: unknown[][] = [];
  const leases = new Set<string>();
  let workers = 0;
  let holdRoster: ((resume: () => void) => void) | undefined;
  function noteLease() {
    const stat = lstatSync(lease, { bigint: true });
    if (!stat.isDirectory() || (stat.mode & 0o777n) !== 0o700n)
      throw Error("Missing private fixture lease");
    leases.add(`${stat.dev}:${stat.ino}:${stat.birthtimeNs}`);
  }
  class RecordingWorker extends OriginalWorker {
    private readonly serial: number;
    private rosterId: number | undefined;
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      this.serial = basename(String(args[0])) === "index-worker.js" ? ++workers : 0;
      if (!this.serial) return;
      noteLease();
      this.addEventListener("close", event => {
        noteLease();
        operations.push([this.serial, "exit", "code" in event ? event.code : undefined]);
      });
      Object.defineProperty(this, "onmessage", {
        set: (listener: (event: MessageEvent<unknown>) => void) => {
          super.onmessage = (event: MessageEvent<unknown>) => {
            if (holdRoster && this.rosterId !== undefined && record(event.data) &&
                event.data.id === this.rosterId && record(event.data.result) && event.data.result.ok === true) {
              const entered = holdRoster;
              holdRoster = undefined;
              entered(() => listener(event));
            } else listener(event);
          };
        },
      });
    }
    override postMessage(message: unknown) {
      if (this.serial && record(message)) {
        noteLease();
        const { op, payload, id } = message;
        if (op === "verify-roster" && typeof id === "number") this.rosterId = id;
        const extra = op === "open" && record(payload) ? payload.mode : op === "verify-roster" ? payload : undefined;
        operations.push(extra === undefined ? [this.serial, op] : [this.serial, op, extra]);
      }
      super.postMessage(message);
    }
  }

  const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const scanner = createScanWorker();
  const watchKeys = new Set<string>();
  let watchStatus: "establishing" | "watching" = "establishing";
  let dirty = false;
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(rootPath),
    contentSearchStrategy: "direct",
    worker: {
      call(message) {
        if (message.op === "watchStart" && typeof message.key === "string") {
          watchKeys.add(message.key);
          return Promise.resolve({ bytes: 0 });
        }
        if (message.op === "watchClose" && typeof message.key === "string") {
          watchKeys.delete(message.key);
          return Promise.resolve({ bytes: 0 });
        }
        if (message.op === "watchTick") return Promise.resolve({
          bytes: 0, queueBytes: 0,
          roots: [...watchKeys].map(key => ({ key, status: watchStatus, dirty })),
        });
        return scanner.call(message);
      },
      dispose: () => scanner.dispose(),
    },
  });
  async function request(input: Omit<WorkspaceRequest, "protocolVersion" | "requestId">) {
    const result = await workspace.request({ protocolVersion: 1, requestId: crypto.randomUUID(), ...input });
    if (!result.ok) throw Error("Fixture workspace request failed: " + result.error);
    return result;
  }
  const settle = () => awaitFixture(async () => {
    const root = (await request({ op: "state" })).roots.find(({ displayPath }) => displayPath === rootPath);
    if (root?.status === "complete") return root;
    if (root && root.status !== "scanning") throw Error("Fixture scan incomplete: " + root.status);
  });
  const prepare = (root: WorkspaceRoot, signal?: AbortSignal) =>
    workspace.prepareObservedIndex(root.handle, root.generation, signal);
  const cleanHint = (root: WorkspaceRoot) => awaitFixture(() => {
    const hint = workspace.captureIndexWatchHint(root.handle, root.generation);
    return hint.ok ? hint : undefined;
  });
  async function heldPreparation(root: WorkspaceRoot, signal?: AbortSignal) {
    const entered = Promise.withResolvers<() => void>();
    holdRoster = entered.resolve;
    try {
      const pending = prepare(root, signal);
      const resume = await Promise.race([
        entered.promise,
        pending.then(result => { throw Error("Expected native roster receipt: " + JSON.stringify(result)); }),
      ]);
      return { pending, resume };
    } finally {
      holdRoster = undefined;
    }
  }
  async function removeFixtureIndex() {
    await rm(profile, { recursive: true });
    workers = 0;
    operations.length = 0;
    leases.clear();
  }

  try {
    await mkdir(home, { mode: 0o700 });
    await mkdir(rootPath);
    await writeFile(firstPath, first);
    await writeFile(secondPath, second);
    Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
    await request({ op: "select" });
    let root = await settle();
    expect(await prepare(root)).toEqual(fail("UNAVAILABLE"));
    const preAborted = new AbortController();
    preAborted.abort();
    expect(await prepare(root, preAborted.signal)).toEqual(fail("CANCELLED"));
    expect(await prepare({ ...root, generation: root.generation + 1 })).toEqual(fail("STALE"));
    expect(await readdir(home)).toEqual([]);
    expect(workers).toBe(0);
    expect(operations).toEqual([]);

    watchStatus = "watching";
    const quiet = await cleanHint(root);
    const capture = await workspace.captureIndexRows(root.handle, root.generation);
    if (!capture.ok) throw Error("Fixture rows unavailable: " + capture.error);
    const rows = capture.rows.map(({ id, raw }) => ({ id, raw }));
    expect(rows.map(({ raw }) => raw).sort()).toEqual([first, second].sort());
    const firstEntry = capture.rows.find(({ raw }) => raw === first)?.entry;
    if (!firstEntry) throw Error("Missing first fixture row");
    const preparedTrace = [
      [1, "open", "create-new"], [1, "apply"], [1, "close"], [1, "exit", 0],
      [2, "open", "reader-only"], [2, "verify-roster", rows], [2, "close"], [2, "exit", 0],
    ];
    expect(await prepare(root)).toEqual({ ok: true, generation: 1, documents: 2 });
    expect(workers).toBe(2);
    expect(operations).toEqual(preparedTrace);
    expect(leases.size).toBe(1);
    expect(quiet.current()).toBe(true);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    const stored = await readFile(catalog, "utf8");
    expect(JSON.parse(stored)).toEqual({
      version: 1, profile: "limited-v1", scopeKey: capture.scopeKey, generation: 1,
      entries: rows.map(({ id, raw }) => ({ id, hash: createHash("sha256").update(raw).digest("hex") }))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    });
    const existing = () => workspace.searchExistingIndex(root.handle, root.generation, "target", undefined, {
      requireObserved: true, maxLogicalBytes: 1024 * 1024,
    });
    expect(await existing()).toEqual({ ok: true, hits: [{ entry: firstEntry, from: 9, to: 15 }] });
    expect(workers).toBe(3);
    expect(await prepare(root)).toEqual(fail("SCHEMA"));
    expect(workers).toBe(3);
    expect(await readFile(catalog, "utf8")).toBe(stored);
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);

    await removeFixtureIndex();
    const invalidated = await heldPreparation(root);
    try {
      expect((await readdir(profile)).sort()).toEqual([".lease", "index"]);
      expect(await prepare(root)).toEqual(fail("BUSY"));
      expect(await existing()).toEqual(fail("BUSY"));
      expect(await workspace.captureIndexRows(root.handle, root.generation)).toEqual(fail("BUSY"));
      dirty = true;
      await awaitFixture(() => quiet.current() ? undefined : true);
      dirty = false;
      expect(await prepare(root)).toEqual(fail("BUSY"));
      expect(await readFile(firstPath, "utf8")).toBe(first);
    } finally {
      invalidated.resume();
    }
    expect(await invalidated.pending).toEqual(fail("STALE"));
    expect(await readdir(profile)).toEqual(["index"]);
    expect(operations).toEqual(preparedTrace);
    expect(leases.size).toBe(1);
    expect((await readdir(index)).length).toBeGreaterThan(0);
    root = await settle();
    const renewed = await cleanHint(root);

    await removeFixtureIndex();
    const controller = new AbortController();
    const cancelled = await heldPreparation(root, controller.signal);
    try {
      controller.abort();
      expect(await prepare(root)).toEqual(fail("BUSY"));
    } finally {
      cancelled.resume();
    }
    expect(await cancelled.pending).toEqual(fail("CANCELLED"));
    expect(await readdir(profile)).toEqual(["index"]);
    expect(operations).toEqual(preparedTrace);
    expect(leases.size).toBe(1);

    await removeFixtureIndex();
    const changed = first.replace("中文", "改文");
    const staleBody = await heldPreparation(root);
    try {
      const before = await lstat(firstPath, { bigint: true });
      await writeFile(firstPath, changed);
      await utimes(firstPath, before.atime, new Date(Number(before.mtimeMs) + 10_000));
      const after = await lstat(firstPath, { bigint: true });
      expect({ dev: after.dev, ino: after.ino, size: after.size }).toEqual({
        dev: before.dev, ino: before.ino, size: before.size,
      });
      expect(after.mtimeNs > before.mtimeNs).toBe(true);
      expect(renewed.current()).toBe(true);
    } finally {
      staleBody.resume();
    }
    expect(await staleBody.pending).toEqual(fail("STALE"));
    expect(await readdir(profile)).toEqual(["index"]);
    expect(operations).toEqual(preparedTrace);
    expect(leases.size).toBe(1);
    expect(renewed.current()).toBe(true);
    expect(await readFile(firstPath, "utf8")).toBe(changed);
    expect(await readFile(secondPath, "utf8")).toBe(second);
    expect(documents.locations()).toEqual([]);
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    try {
      try { await workspace.dispose(); }
      finally { await documents.dispose(); }
    } finally {
      await Promise.all([rootPath, home].map(path => rm(path, { recursive: true, force: true })));
    }
  }
}, 15_000);
