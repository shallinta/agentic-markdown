import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import type { WorkspaceRequest, WorkspaceRoot } from "../../shared/workspace";
import { createDocumentService } from "../documents";
import { inspectAppIndexCacheFootprint, searchAppIndexCache } from "../index/app-cache";
import { record } from "../index/protocol";

import { createWorkspaceService, type TrustedWorkspaceService } from ".";

const prefix = "f064ag-index-integration-";
const isolated = process.env.AGENTIC_MARKDOWN_INDEX_INTEGRATION_TEST === "1";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const rowId = (scopeKey: string, relative: string) =>
  sha(JSON.stringify([1, "agentic-markdown-index-row", scopeKey, relative])).slice(0, 32);

type Ticket = Extract<Awaited<ReturnType<TrustedWorkspaceService["captureIndexRows"]>>, { ok: true }>;
type CacheSuccess = Extract<Awaited<ReturnType<typeof searchAppIndexCache>>, { ok: true }>;

test.skipIf(isolated)("isolated authorized index integration exits with a clean fixture", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: {
        ...process.env,
        TMPDIR: scratch,
        AGENTIC_MARKDOWN_HOME: join(scratch, "app"),
        AGENTIC_MARKDOWN_INDEX_INTEGRATION_TEST: "1",
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

test.skipIf(!isolated)("fresh authorized rows cold build, reopen and update the formal private cache", async () => {
  const scratch = await realpath(tmpdir());
  const home = join(scratch, "app");
  if (!basename(scratch).startsWith(prefix) ||
      process.env.AGENTIC_MARKDOWN_HOME !== home || (await readdir(scratch)).length)
    throw Error("Missing isolated authorized index integration fixture");
  const rootPath = join(scratch, "root");
  const otherPath = join(scratch, "other");
  const profile = join(home, "search-index", "limited-v1");
  const catalog = join(profile, "catalog.json");
  const first = "甲/同名.md";
  const second = "乙/同名.md";
  const initial = "\uFEFF# 中文\r\n😀target\r\n";
  const peer = "开头😀 target target\r\n";
  const updated = "\uFEFF标题\r\n先😀target\r\n";
  const changedAfterQuery = updated.replace("先", "后");
  const query = "target";
  const OriginalWorker = globalThis.Worker;
  const closeAll: (() => Promise<void>)[] = [];

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
      const response = await workspace.request({ protocolVersion: 1, requestId: crypto.randomUUID(), ...input });
      if (!response.ok) throw Error("Fixture workspace command failed: " + response.error);
      return response;
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
    return {
      documents,
      close,
      async join(this: void) { await request({ op: "select" }); return settle(); },
      async rescan(this: void, root: WorkspaceRoot) {
        await request({ op: "rescan", root: root.handle });
        return settle();
      },
      async snapshot(this: void, root: WorkspaceRoot, signal?: AbortSignal) {
        const ticket = await workspace.captureIndexRows(root.handle, root.generation, signal);
        if (!ticket.ok) throw Error("Fixture snapshot failed: " + ticket.error);
        return ticket;
      },
      async entry(this: void, root: WorkspaceRoot, relative: string) {
        const page = await request({ op: "page", root: root.handle, generation: root.generation, cursor: 0 });
        const node = page.nodes?.find((item) => item.kind === "file" && item.displayPath === join(path, relative));
        if (!node) throw Error("Missing fixture file entry");
        return node.handle;
      },
    };
  }
  async function execute(ticket: Ticket, beforePublish?: (result: CacheSuccess) => Promise<void>) {
    if (!ticket.current() || !await ticket.verify() || !ticket.current())
      return { status: "blocked-before" } as const;
    const result = await searchAppIndexCache({
      scopeKey: ticket.scopeKey,
      rows: ticket.rows.map(({ id, raw }) => ({ id, raw })),
      query,
    }, ticket.current);
    if (!result.ok) return { status: "failed", result } as const;
    await beforePublish?.(result);
    return await ticket.verify() && ticket.current()
      ? { status: "published", result } as const
      : { status: "blocked-after" } as const;
  }
  function published(receipt: Awaited<ReturnType<typeof execute>>) {
    if (receipt.status !== "published") throw Error("Fixture search not publishable: " + receipt.status);
    return receipt.result;
  }
  async function checkRows(
    fixture: ReturnType<typeof workspaceFor>, root: WorkspaceRoot, ticket: Ticket, expectedFirst: string
  ) {
    const expected = await Promise.all([[first, expectedFirst], [second, peer]].map(async ([name, raw]) => ({
      entry: await fixture.entry(root, name), id: rowId(ticket.scopeKey, name),
      raw, bytes: Buffer.byteLength(raw), hash: sha(raw),
    })));
    expect([...ticket.rows].sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([...expected].sort((a, b) => a.id.localeCompare(b.id)));
    expect(fixture.documents.locations()).toEqual([]);
    return expected;
  }
  function checkHits(result: CacheSuccess, ticket: Ticket, rows: Ticket["rows"], spans: readonly number[]) {
    const expected = rows.map(({ entry, id, raw }, index) => {
      const from = spans[index];
      expect(raw.indexOf(query)).toBe(from);
      return { entry, id, from, to: from + query.length };
    });
    const actual = result.hits.map((hit) => {
      const row = ticket.rows.find(({ id }) => id === hit.id);
      if (!row) throw Error("Native hit missing from the verified fixture snapshot");
      return { ...hit, entry: row.entry };
    });
    expect(actual.sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual(expected.sort((a, b) => a.id.localeCompare(b.id)));
  }
  async function catalogReceipt(ticket: Ticket, generation: number) {
    expect((await readdir(profile)).sort()).toEqual(["catalog.json", "index"]);
    const bytes = await readFile(catalog);
    const stat = await lstat(catalog, { bigint: true });
    const value: unknown = JSON.parse(bytes.toString("utf8"));
    expect(value).toEqual({
      version: 1, profile: "limited-v1", scopeKey: ticket.scopeKey, generation,
      entries: ticket.rows.map(({ id, hash }) => ({ id, hash })).sort((a, b) => a.id.localeCompare(b.id)),
    });
    return { bytes, ino: stat.ino, mtime: stat.mtimeNs };
  }
  async function closeWorkspaces() {
    const closed = await Promise.allSettled(closeAll.map((close) => close()));
    if (closed.some((result) => result.status === "rejected"))
      throw Error("Fixture workspaces failed to close");
  }

  try {
    await mkdir(home, { mode: 0o700 });
    for (const relative of [first, second]) await mkdir(dirname(join(rootPath, relative)), { recursive: true });
    await mkdir(otherPath);
    await writeFile(join(rootPath, first), initial);
    await writeFile(join(rootPath, second), peer);
    await writeFile(join(otherPath, "foreign.md"), "other target");
    expect(await inspectAppIndexCacheFootprint(() => true)).toMatchObject({ ok: true, present: false, totalBytes: 0 });
    expect(await readdir(home)).toEqual([]);

    const original = workspaceFor(rootPath);
    const originalRoot = await original.join();
    const coldTicket = await original.snapshot(originalRoot);
    const coldRows = await checkRows(original, originalRoot, coldTicket, initial);
    const cold = published(await execute(coldTicket));
    expect(cold).toMatchObject({ generation: 1, applied: 2 });
    checkHits(cold, coldTicket, coldRows, [9, 5]);
    const firstCatalog = await catalogReceipt(coldTicket, 1);
    await original.close();
    expect(coldTicket.current()).toBe(false);

    const reopened = workspaceFor(rootPath);
    const reopenedRoot = await reopened.join();
    expect(reopenedRoot.handle).not.toBe(originalRoot.handle);
    const warmTicket = await reopened.snapshot(reopenedRoot);
    expect(warmTicket.scopeKey).toBe(coldTicket.scopeKey);
    const warmRows = await checkRows(reopened, reopenedRoot, warmTicket, initial);
    expect(warmRows.every(({ entry }, index) => entry !== coldRows[index].entry)).toBe(true);
    const warm = published(await execute(warmTicket));
    expect(warm).toMatchObject({ generation: 1, applied: 0 });
    checkHits(warm, warmTicket, warmRows, [9, 5]);
    expect(await catalogReceipt(warmTicket, 1)).toEqual(firstCatalog);

    const firstPath = join(rootPath, first);
    await writeFile(firstPath, updated);
    expect(await execute(warmTicket)).toEqual({ status: "blocked-before" });
    expect(await catalogReceipt(warmTicket, 1)).toEqual(firstCatalog);
    const rescanned = await reopened.rescan(reopenedRoot);
    const updatedTicket = await reopened.snapshot(rescanned);
    const updatedRows = await checkRows(reopened, rescanned, updatedTicket, updated);
    expect(updatedTicket.scopeKey).toBe(warmTicket.scopeKey);
    expect(updatedRows.map(({ id }) => id)).toEqual(warmRows.map(({ id }) => id));
    const increment = published(await execute(updatedTicket));
    expect(increment).toMatchObject({ generation: 2, applied: 1 });
    checkHits(increment, updatedTicket, updatedRows, [8, 5]);
    const secondCatalog = await catalogReceipt(updatedTicket, 2);

    const foreign = workspaceFor(otherPath);
    const foreignTicket = await foreign.snapshot(await foreign.join());
    expect(foreignTicket.scopeKey).not.toBe(updatedTicket.scopeKey);
    expect(await execute(foreignTicket)).toEqual({
      status: "failed", result: { ok: false, error: "SCHEMA", accepted: false },
    });
    expect(await catalogReceipt(updatedTicket, 2)).toEqual(secondCatalog);

    const abort = new AbortController();
    const cancelTicket = await reopened.snapshot(rescanned, abort.signal);
    const entered = Promise.withResolvers<() => void>();
    let holding = true;
    class PausingWorker extends OriginalWorker {
      override postMessage(message: unknown) {
        if (!holding || !record(message) || message.op !== "query") {
          super.postMessage(message);
          return;
        }
        holding = false;
        entered.resolve(() => super.postMessage(message));
      }
    }
    Object.defineProperty(globalThis, "Worker", { value: PausingWorker, configurable: true });
    const cancelled = execute(cancelTicket);
    try {
      const resume = await Promise.race([
        entered.promise, cancelled.then((result) => { throw Error("Native query was not reached: " + result.status); }),
      ]);
      abort.abort();
      resume();
      expect(await cancelled).toEqual({
        status: "failed", result: { ok: false, error: "CANCELLED", accepted: false },
      });
    } finally {
      Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    }
    expect(await catalogReceipt(updatedTicket, 2)).toEqual(secondCatalog);

    const before = await lstat(firstPath, { bigint: true });
    let sawNativeSuccess = false;
    const stale = await execute(updatedTicket, async (native) => {
      expect(native).toMatchObject({ generation: 2, applied: 0 });
      checkHits(native, updatedTicket, updatedRows, [8, 5]);
      sawNativeSuccess = true;
      await writeFile(firstPath, changedAfterQuery);
      await utimes(firstPath, before.atime, new Date(Number(before.mtimeMs) + 10_000));
    });
    expect(sawNativeSuccess).toBe(true);
    expect(stale).toEqual({ status: "blocked-after" });
    expect(updatedTicket.current()).toBe(false);
    const after = await lstat(firstPath, { bigint: true });
    expect({ ino: after.ino, size: after.size }).toEqual({ ino: before.ino, size: before.size });
    expect(await catalogReceipt(updatedTicket, 2)).toEqual(secondCatalog);
    expect(await readFile(firstPath, "utf8")).toBe(changedAfterQuery);
    expect(await readFile(join(rootPath, second), "utf8")).toBe(peer);
    expect(await readFile(join(otherPath, "foreign.md"), "utf8")).toBe("other target");
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    try {
      await closeWorkspaces();
    } finally {
      for (const path of [rootPath, otherPath, home]) await rm(path, { recursive: true, force: true });
    }
  }
}, 12_000);
