import { createHash } from "node:crypto";
import { lstatSync, type BigIntStats } from "node:fs";

import {
  captureIndexFootprint, captureIndexPublicationInventory, captureVacantIndexSlot,
  reclaimDirectoryStamp, sameIndexInventoryMetadata,
} from "./cache-footprint";
import {
  encodeChanges, INDEX_LIMITS, keys, natural, parseIndexRoster, record,
  type IndexChange, type IndexResult, type IndexRosterRow,
} from "./protocol";
import { publishColdIndexCatalog, replaceActiveIndexCatalog } from "./purge-publish";
import { readPinnedReclaimCatalog, validReclaimLayout } from "./reclaim-layout";
import { acquireIndexReuseSlot, IndexReuseCleanupError, type IndexReuseCatalog } from "./reuse-catalog";
import { createIndexSession } from "./session";

export interface ColdIndexInput {
  scopeKey: string;
  rows: readonly IndexRosterRow[];
}
export interface ActiveIndexInput extends ColdIndexInput {
  expectedGeneration: number;
}

export interface ColdIndexGuard {
  current: () => boolean;
  verify: () => Promise<boolean>;
}

type IndexWriteError = "INPUT" | "LIMIT" | "BUSY" | "SCHEMA" | "STALE" | "CANCELLED" | "UNAVAILABLE" | "UNKNOWN" |
  "MISSING" | "MISMATCH";
type IndexWriteResult =
  | { ok: true; generation: number; documents: number; applied: number }
  | { ok: false; error: IndexWriteError; accepted: boolean };
const fail = <Error extends IndexWriteError>(error: Error) => ({ ok: false as const, error, accepted: error === "UNKNOWN" });
class IndexWriteSourceStale extends Error {}

export function readColdIndexInput(input: unknown) {
  if (!record(input) || !keys(input, "rows,scopeKey") ||
      typeof input.scopeKey !== "string" || !/^[a-f0-9]{64}$/.test(input.scopeKey))
    return fail("INPUT");
  try {
    return { ok: true as const, scopeKey: input.scopeKey, rows: parseIndexRoster(input.rows) };
  } catch (error) {
    return fail(error instanceof Error && error.message === "LIMIT" ? "LIMIT" : "INPUT");
  }
}

export function readActiveIndexInput(input: unknown) {
  if (!record(input) || !keys(input, "expectedGeneration,rows,scopeKey") || !natural(input.expectedGeneration))
    return fail("INPUT");
  const { scopeKey, rows, expectedGeneration } = input;
  const parsed = readColdIndexInput({ scopeKey, rows });
  return parsed.ok ? { ...parsed, expectedGeneration } : parsed;
}

export async function prepareColdIndex(directory: string, input: ColdIndexInput, guard: ColdIndexGuard) {
  const result = await writeIndex(directory, input, guard);
  if (!result.ok) {
    const { error } = result;
    return { ...result, error: error === "MISSING" || error === "MISMATCH" ? "UNAVAILABLE" as const : error };
  }
  const { generation, documents } = result;
  return { ok: true as const, generation, documents };
}

export function refreshActiveIndex(directory: string, input: ActiveIndexInput, guard: ColdIndexGuard) {
  return writeIndex(directory, input, guard, input.expectedGeneration);
}

async function writeIndex(
  directory: string, { scopeKey, rows }: ColdIndexInput, { current, verify }: ColdIndexGuard, expectedGeneration?: number
): Promise<IndexWriteResult> {
  if (!current()) return fail("CANCELLED");
  const acquired = await acquireIndexReuseSlot(directory);
  if (!acquired.ok) return fail(acquired.error === "UNKNOWN" || current() ? acquired.error : "CANCELLED");
  const { slot } = acquired;
  const { assertInventoryLease } = slot;
  let retainLease = false;
  const check = () => {
    if (!current()) throw Error("Index preparation cancelled");
    assertInventoryLease();
  };
  const verifySource = async () => {
    check();
    const valid = await verify();
    check();
    if (valid !== true) throw new IndexWriteSourceStale();
  };

  let outcome: IndexWriteResult;
  try {
    outcome = await run();
  } catch (error) {
    outcome = fail(error instanceof IndexReuseCleanupError ? "UNKNOWN" :
      !current() ? "CANCELLED" : error instanceof IndexWriteSourceStale ? "STALE" : "UNAVAILABLE");
  } finally {
    if (!retainLease) {
      try {
        await slot.release();
      } catch {
        outcome = fail("UNKNOWN");
      }
    }
  }
  return outcome.ok && !current() ? fail("CANCELLED") : outcome;

  async function nativePhase(
    mode: "create-new" | "writer-existing" | "reader-only", initial: number, beforeWorker: () => void,
    work: (session: ReturnType<typeof createIndexSession>) => Promise<IndexResult>
  ) {
    const session = createIndexSession(undefined, beforeWorker);
    let opened: IndexResult | undefined;
    let generation = 0;
    const confirmClose = async () => {
      try {
        const closed = await session.close();
        if (closed.ok ? closed.generation !== generation :
            !(closed.error === "UNAVAILABLE" && opened?.ok === false && opened.error === "UNAVAILABLE" && !opened.accepted))
          throw Error("Cold index session close unconfirmed");
      } catch {
        retainLease = true;
        throw new IndexReuseCleanupError("Cold index session close unconfirmed");
      }
    };
    try {
      opened = await session.open(slot.indexPath, mode);
      if (opened.ok) generation = opened.generation;
      else if (opened.error === "UNKNOWN") return nativeFailure(opened);
      check();
      if (!opened.ok) return nativeFailure(opened);
      if (generation !== initial) return fail("SCHEMA");
      const worked = await work(session);
      if (worked.ok) generation = worked.generation;
      else if (worked.error === "UNKNOWN") return nativeFailure(worked);
      check();
      return worked.ok ? worked : nativeFailure(worked);
    } finally {
      await confirmClose();
    }
  }

  async function captureActive(generation: number) {
    check();
    const cached = await slot.readCatalog();
    check();
    if (cached.status === "cold") {
      const vacant = await captureVacantIndexSlot(directory, check, assertInventoryLease);
      return fail(vacant ? "MISSING" : "SCHEMA");
    }
    if (cached.status !== "existing" || cached.catalog.scopeKey !== scopeKey) return fail("SCHEMA");
    if (cached.catalog.generation !== generation) return fail("MISMATCH");
    const { identity } = cached;
    const native = await captureIndexPublicationInventory(directory, check, assertInventoryLease, identity.catalog);
    if (!native || !sameIndexInventoryMetadata(native.indexStat, identity.index)) return fail("SCHEMA");
    const recheck = () => { check(); native.checkProfile(); native.recheck(); };
    const prior = await readPinnedReclaimCatalog(directory, identity.catalog, recheck);
    if (!prior || !await validReclaimLayout(slot.indexPath, native.files, generation, recheck)) return fail("SCHEMA");
    recheck();
    return { ok: true as const, entries: cached.catalog.entries, identity, contents: prior.bytes, recheck };
  }

  async function run() {
    const active = expectedGeneration === undefined ? undefined : await captureActive(expectedGeneration);
    if (active?.ok === false) return active;
    const vacant = active ? undefined : await captureVacantIndexSlot(directory, check, assertInventoryLease);
    const initialCheck = active?.recheck ?? vacant?.recheck;
    if (!initialCheck) return fail("SCHEMA");
    const initial = expectedGeneration ?? 0;
    const entries = rows.map(({ id, raw }) => ({ id, hash: createHash("sha256").update(raw).digest("hex") }))
      .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const roster = new Set(rows.map(({ id }) => id));
    const previous = new Map(active?.entries.map(({ id, hash }) => [id, hash]));
    const changed = new Set(entries.filter(({ id, hash }) => previous.get(id) !== hash).map(({ id }) => id));
    const changes: IndexChange[] = [
      ...[...previous.keys()].filter((id) => !roster.has(id)).map((id) => ({ kind: "delete" as const, id })),
      ...rows.filter(({ id }) => changed.has(id)).map(({ id, raw }) => ({ kind: "put" as const, id, path: id, raw })),
    ];
    const applied = changes.length;
    if (applied > INDEX_LIMITS.documents || (applied && initial === Number.MAX_SAFE_INTEGER)) return fail("LIMIT");
    try {
      if (applied) encodeChanges(changes);
    } catch {
      return fail("LIMIT");
    }
    await verifySource();
    initialCheck();
    const generation = initial + Number(applied > 0);
    const verifyRoster = (session: ReturnType<typeof createIndexSession>) => session.verifyRoster(rows);
    if (active && !applied) {
      const checked = await nativePhase("reader-only", generation, initialCheck, verifyRoster);
      if (!checked.ok) return checked;
      if (checked.generation !== generation) return fail("UNKNOWN");
      await verifySource();
      initialCheck();
      return { ok: true as const, generation, documents: rows.length, applied };
    }

    let created: BigIntStats | undefined;
    const written = await nativePhase(active ? "writer-existing" : "create-new", initial, initialCheck, async (session) => {
      created = lstatSync(slot.indexPath, { bigint: true });
      if (!created.isDirectory() || created.uid !== assertInventoryLease().uid || (created.mode & 0o022n) !== 0n ||
          (active && !sameDirectory(created, active.identity.index)))
        throw Error("Index writer directory unavailable");
      if (active) initialCheck();
      return applied ? session.applyAndCommit(changes) : { ok: true, generation: 0 };
    });
    if (!written.ok) return written;
    if (written.generation !== generation) return fail("UNKNOWN");
    const native = await captureIndexPublicationInventory(directory, check, assertInventoryLease, active?.identity.catalog);
    check();
    if (!native || !created || !sameDirectory(created, native.indexStat)) return fail("SCHEMA");
    const checkNative = () => { check(); native.recheck(); native.checkProfile(); };
    if (!await validReclaimLayout(slot.indexPath, native.files, generation, checkNative)) return fail("SCHEMA");
    const checked = await nativePhase("reader-only", generation, checkNative, verifyRoster);
    if (!checked.ok) return checked;
    if (checked.generation !== generation) return fail("UNKNOWN");
    checkNative();

    const catalog: IndexReuseCatalog = {
      version: 1, profile: "limited-v1", scopeKey, generation,
      entries,
    };
    const contents = Buffer.from(JSON.stringify(catalog));
    return slot.withIndexProfile(async (held) => {
      if (active) {
        const prior = await readPinnedReclaimCatalog(directory, active.identity.catalog, checkNative);
        if (!prior?.bytes.equals(active.contents)) return fail("SCHEMA");
      }
      await verifySource();
      checkNative();
      const beforeCommit = () => { check(); native.recheck(); native.checkCatalog(); };
      const published = active
        ? replaceActiveIndexCatalog(directory, held, contents, beforeCommit, () => {
          native.recheck();
          native.checkCatalog();
        })
        : publishColdIndexCatalog(directory, held, contents, beforeCommit);
      if (!published.ok) return fail(published.error);
      const physical = () => { held.checkProfile(); native.recheck(); };
      let terminal: Awaited<ReturnType<typeof captureIndexFootprint>>;
      try {
        physical();
        await held.sync();
        terminal = await captureIndexFootprint(directory, assertInventoryLease(), native.indexStat.uid, physical,
          assertInventoryLease, { catalog: published.installed, index: native.indexStat });
        if (terminal.status !== "existing") throw Error("Cold index catalog unavailable");
        const readback = await readPinnedReclaimCatalog(directory, published.installed, terminal.recheck);
        terminal.recheck();
        if (!readback?.bytes.equals(contents)) throw Error("Cold index catalog differs");
      } catch {
        throw new IndexReuseCleanupError("Cold index catalog publication unconfirmed");
      }
      await verifySource();
      try {
        terminal.recheck();
      } catch {
        throw new IndexReuseCleanupError("Cold index catalog changed after verification");
      }
      return { ok: true as const, generation, documents: rows.length, applied };
    });
  }
}

function sameDirectory(left: BigIntStats, right: BigIntStats) {
  return reclaimDirectoryStamp(left).join(":") === reclaimDirectoryStamp(right).join(":");
}

function nativeFailure(result: Extract<IndexResult, { ok: false }>) {
  return fail(result.error === "READONLY" || result.error === "CLOSED" ? "UNAVAILABLE" : result.error);
}
