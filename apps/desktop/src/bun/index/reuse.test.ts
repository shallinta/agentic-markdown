import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { record } from "./protocol";
import { searchWithIndexReuse } from "./reuse";
import { createIndexSession } from "./session";

const isolated = process.env.AGENTIC_MARKDOWN_INDEX_REUSE_TEST === "1";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test.skipIf(isolated)("isolated formal native reuse suite exits with a clean fixture", async () => {
  const temp = await mkdtemp(join(tmpdir(), "f064p-native-child-"));
  try {
    const child = Bun.spawn([process.execPath, "test", import.meta.path], {
      env: { ...process.env, TMPDIR: temp, AGENTIC_MARKDOWN_INDEX_REUSE_TEST: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exit, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    if (exit !== 0) throw Error(stdout + stderr);
    expect(stderr).toContain("1 pass");
    expect(await readdir(temp)).toEqual([]);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 15_000);

test.skipIf(!isolated)("reopens the formal index, commits exact deltas and rejects invalid reuse", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "f064p-reuse-")));
  const slot = join(scratch, "slot");
  const poisonSlot = join(scratch, "poison");
  const catalog = join(slot, "catalog.json");
  const index = join(slot, "index");
  const first = { id: "fixture-a", raw: "\uFEFF😀target\r\n" };
  const second = { id: "fixture-b", raw: "无匹配" };
  const edited = { ...first, raw: "\uFEFF甲\r\n😀target" };
  const scopeKey = sha("synthetic-authorized-scope");
  const input = { scopeKey, rows: [first, second], query: "target" };
  const expected = (generation: number, applied: number, from?: number) => ({
    ok: true as const,
    generation,
    applied,
    hits: from === undefined ? [] : [{ id: first.id, from, to: from + input.query.length }],
  });
  const failed = (error: "SCHEMA" | "BUSY" | "CANCELLED" | "LIMIT" | "UNKNOWN") => ({
    ok: false as const, error,
  });
  const run = (
    rows: readonly { id: string; raw: string }[] = input.rows,
    current = () => true,
  ) => searchWithIndexReuse(slot, { ...input, rows }, current);
  const restore = (content: Buffer | string) => writeFile(catalog, content, { mode: 0o600 });
  const slotReleased = async () => expect((await readdir(slot)).sort()).toEqual(["catalog.json", "index"]);
  const OriginalWorker = globalThis.Worker;
  const operations: string[] = [];
  const exits: unknown[] = [];
  let holdQuery: ((resume: () => void) => void) | undefined;
  class RecordingWorker extends OriginalWorker {
    constructor(...args: ConstructorParameters<typeof Worker>) {
      super(...args);
      this.addEventListener("close", (event) => exits.push("code" in event ? event.code : undefined));
    }
    override postMessage(message: unknown) {
      const op = record(message) ? message.op : undefined;
      if (typeof op === "string") operations.push(op);
      if (op === "query" && holdQuery) {
        const hold = holdQuery;
        holdQuery = undefined;
        hold(() => super.postMessage(message));
      } else super.postMessage(message);
    }
  }

  async function pauseQuery(rows: readonly { id: string; raw: string }[], current?: () => boolean) {
    const entered = Promise.withResolvers<() => void>();
    holdQuery = entered.resolve;
    const pending = run(rows, current);
    try {
      const resume = await Promise.race([
        entered.promise,
        pending.then((value) => { throw Error("Expected native query: " + JSON.stringify(value)); }),
      ]);
      return { pending, resume };
    } finally {
      holdQuery = undefined;
    }
  }

  try {
    await mkdir(slot, { mode: 0o700 });
    await mkdir(poisonSlot, { mode: 0o700 });
    Object.defineProperty(globalThis, "Worker", { value: RecordingWorker, configurable: true });
    expect(await run()).toEqual(expected(1, 2, 3));
    expect(operations).toEqual(["open", "apply", "query", "close"]);
    expect(exits).toEqual([0]);
    await slotReleased();

    const coldCatalog = await readFile(catalog);
    const parsed: unknown = JSON.parse(coldCatalog.toString("utf8"));
    if (!record(parsed)) throw Error("Missing catalog evidence");
    expect(parsed).toEqual({
      version: 1,
      profile: "limited-v1",
      scopeKey,
      generation: 1,
      entries: [{ id: first.id, hash: sha(first.raw) }, { id: second.id, hash: sha(second.raw) }],
    });

    operations.length = 0;
    expect(await run([second, first])).toEqual(expected(1, 0, 3));
    expect(operations).toEqual(["open", "query", "close"]);
    expect(await readFile(catalog)).toEqual(coldCatalog);
    expect(exits).toEqual([0, 0]);
    await slotReleased();

    operations.length = 0;
    expect(await run(Array.from({ length: 16 }, (_, index) => ({ id: `new-${index}`, raw: "target" }))))
      .toMatchObject(failed("LIMIT"));
    expect(operations).toEqual([]);
    expect(await readFile(catalog)).toEqual(coldCatalog);

    operations.length = 0;
    expect(await run([edited, second])).toEqual(expected(2, 1, 6));
    expect(operations).toEqual(["open", "apply", "query", "close"]);
    expect(await run([edited])).toEqual(expected(3, 1, 6));
    expect(await run([])).toEqual(expected(4, 1));
    expect(await run([])).toEqual(expected(4, 0));
    await slotReleased();

    const stableCatalog = await readFile(catalog);
    const stable: unknown = JSON.parse(stableCatalog.toString("utf8"));
    if (!record(stable)) throw Error("Missing empty catalog evidence");
    expect(stable).toMatchObject({ generation: 4, entries: [] });
    expect(await searchWithIndexReuse(slot, { ...input, rows: [], scopeKey: sha("another-scope") }, () => true))
      .toMatchObject(failed("SCHEMA"));
    expect(await readFile(catalog)).toEqual(stableCatalog);
    for (const corrupt of ["{", JSON.stringify({ ...stable, version: 2 }), JSON.stringify({ ...stable, generation: 3 })]) {
      await restore(corrupt);
      expect(await run([])).toMatchObject(failed("SCHEMA"));
      expect(await readFile(catalog, "utf8")).toBe(corrupt);
      await slotReleased();
    }
    const nonemptyInitial = JSON.stringify({
      ...stable,
      generation: 0,
      entries: [{ id: first.id, hash: sha(first.raw) }],
    });
    operations.length = 0;
    await restore(nonemptyInitial);
    expect(await run([])).toMatchObject(failed("SCHEMA"));
    expect(operations).toEqual([]);
    expect(await readFile(catalog, "utf8")).toBe(nonemptyInitial);
    await slotReleased();
    await restore(stableCatalog);
    await rm(catalog);
    expect(await run([])).toMatchObject(failed("SCHEMA"));
    expect(await readdir(slot)).toEqual(["index"]);
    await restore(stableCatalog);
    const parked = join(scratch, "parked-index");
    await rename(index, parked);
    try {
      expect(await run([])).toMatchObject(failed("SCHEMA"));
      expect(await readdir(slot)).toEqual(["catalog.json"]);
    } finally {
      await rename(parked, index);
    }

    // A schema-valid catalog cannot certify a different body's native hits.
    const poisoned = createIndexSession();
    try {
      expect(await poisoned.open(join(poisonSlot, "index"), "create-new")).toMatchObject({ ok: true });
      expect(await poisoned.applyAndCommit([
        { kind: "put", id: first.id, path: first.id, raw: "missing the query" },
        { kind: "put", id: second.id, path: second.id, raw: second.raw },
      ])).toEqual({ ok: true, generation: 1 });
    } finally {
      expect(await poisoned.close()).toEqual({ ok: true, generation: 1 });
    }
    const poisonedCatalog = join(poisonSlot, "catalog.json");
    await writeFile(poisonedCatalog, coldCatalog, { mode: 0o600 });
    expect(await searchWithIndexReuse(poisonSlot, input, () => true)).toEqual({
      ...failed("UNKNOWN"), accepted: true,
    });
    expect(await readFile(poisonedCatalog)).toEqual(coldCatalog);

    const blocked = await pauseQuery([]);
    const lease = join(slot, ".lease");
    const marker = join(lease, "fixture-owned-marker");
    try {
      await writeFile(marker, "keep", { mode: 0o600, flag: "wx" });
    } finally {
      blocked.resume();
    }
    expect(await blocked.pending).toEqual({ ...failed("UNKNOWN"), accepted: true });
    expect(await readFile(marker, "utf8")).toBe("keep");
    expect(await readFile(catalog)).toEqual(stableCatalog);
    expect(await run([])).toMatchObject(failed("BUSY"));
    await rm(marker);
    await rmdir(lease);

    let current = true;
    const aborted = await pauseQuery([first], () => current);
    try {
      expect(await readdir(slot)).toContain(".lease");
      expect(await run([])).toMatchObject(failed("BUSY"));
      current = false;
    } finally {
      aborted.resume();
    }
    const cancelled = await aborted.pending;
    expect(cancelled).toMatchObject(failed("CANCELLED"));
    expect(cancelled).not.toHaveProperty("hits");
    expect(await readFile(catalog)).toEqual(stableCatalog);
    await slotReleased();
    const advanced = createIndexSession();
    try {
      expect(await advanced.open(index, "reader-only")).toEqual({ ok: true, generation: 5 });
    } finally {
      expect(await advanced.close()).toEqual({ ok: true, generation: 5 });
    }
    expect(await run([])).toMatchObject(failed("SCHEMA"));
    expect(await readFile(catalog)).toEqual(stableCatalog);
    await slotReleased();
    expect(exits.length).toBeGreaterThan(5);
    expect(exits.every((code) => code === 0)).toBe(true);
  } finally {
    Object.defineProperty(globalThis, "Worker", { value: OriginalWorker, configurable: true });
    await rm(scratch, { recursive: true, force: true });
  }
}, 15_000);
