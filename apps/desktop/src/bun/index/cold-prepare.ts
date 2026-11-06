import { createHash } from "node:crypto";
import { lstatSync, type BigIntStats } from "node:fs";

import { captureColdNativeIndex, captureIndexFootprint, captureVacantIndexSlot, reclaimDirectoryStamp } from "./cache-footprint";
import { encodeChanges, keys, parseIndexRoster, record, type IndexResult, type IndexRosterRow } from "./protocol";
import { publishColdIndexCatalog } from "./purge-publish";
import { readPinnedReclaimCatalog, validReclaimLayout } from "./reclaim-layout";
import { acquireIndexReuseSlot, IndexReuseCleanupError, type IndexReuseCatalog } from "./reuse-catalog";
import { createIndexSession } from "./session";

export interface ColdIndexInput {
  scopeKey: string;
  rows: readonly IndexRosterRow[];
}

export interface ColdIndexGuard {
  current: () => boolean;
  verify: () => Promise<boolean>;
}

type ColdError = "INPUT" | "LIMIT" | "BUSY" | "SCHEMA" | "STALE" | "CANCELLED" | "UNAVAILABLE" | "UNKNOWN";
const fail = (error: ColdError) => ({ ok: false as const, error, accepted: error === "UNKNOWN" });
class ColdSourceStale extends Error {}

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

export async function prepareColdIndex(
  directory: string, { scopeKey, rows }: ColdIndexInput, { current, verify }: ColdIndexGuard
) {
  const changes = rows.map(({ id, raw }) => ({ kind: "put" as const, id, path: id, raw }));
  try {
    if (changes.length) encodeChanges(changes);
  } catch {
    return fail("LIMIT");
  }
  if (!current()) return fail("CANCELLED");
  const acquired = await acquireIndexReuseSlot(directory);
  if (!acquired.ok) return fail(acquired.error === "UNKNOWN" || current() ? acquired.error : "CANCELLED");
  const { slot } = acquired;
  const { assertInventoryLease } = slot;
  let retainLease = false;
  const check = () => {
    if (!current()) throw Error("Cold index preparation cancelled");
    assertInventoryLease();
  };
  const verifySource = async () => {
    check();
    const valid = await verify();
    check();
    if (valid !== true) throw new ColdSourceStale();
  };

  let outcome: Awaited<ReturnType<typeof run>>;
  try {
    outcome = await run();
  } catch (error) {
    outcome = fail(error instanceof IndexReuseCleanupError ? "UNKNOWN" :
      !current() ? "CANCELLED" : error instanceof ColdSourceStale ? "STALE" : "UNAVAILABLE");
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
    mode: "create-new" | "reader-only", initial: number, beforeWorker: () => void,
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

  async function run() {
    const vacant = await captureVacantIndexSlot(directory, check, assertInventoryLease);
    if (!vacant) return fail("SCHEMA");
    await verifySource();
    vacant.recheck();
    const generation = rows.length ? 1 : 0;
    let created: BigIntStats | undefined;
    const written = await nativePhase("create-new", 0, vacant.recheck, async (session) => {
      created = lstatSync(slot.indexPath, { bigint: true });
      if (!created.isDirectory() || created.uid !== vacant.profile.uid || (created.mode & 0o022n) !== 0n)
        throw Error("Cold index directory unavailable");
      return changes.length ? session.applyAndCommit(changes) : { ok: true, generation: 0 };
    });
    if (!written.ok) return written;
    if (written.generation !== generation) return fail("UNKNOWN");
    const native = await captureColdNativeIndex(directory, check, assertInventoryLease);
    check();
    if (!native || !created ||
        reclaimDirectoryStamp(created).join(":") !== reclaimDirectoryStamp(native.indexStat).join(":"))
      return fail("SCHEMA");
    const checkNative = () => { check(); native.recheck(); native.checkProfile(); };
    if (!await validReclaimLayout(slot.indexPath, native.files, generation, checkNative)) return fail("SCHEMA");
    const checked = await nativePhase("reader-only", generation, checkNative, (session) => session.verifyRoster(rows));
    if (!checked.ok) return checked;
    if (checked.generation !== generation) return fail("UNKNOWN");
    checkNative();

    const catalog: IndexReuseCatalog = {
      version: 1, profile: "limited-v1", scopeKey, generation,
      entries: rows.map(({ id, raw }) => ({ id, hash: createHash("sha256").update(raw).digest("hex") }))
        .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    };
    const contents = Buffer.from(JSON.stringify(catalog));
    return slot.withIndexProfile(async (held) => {
      await verifySource();
      checkNative();
      const published = publishColdIndexCatalog(directory, held, contents, () => { check(); native.recheck(); });
      if (!published.ok) return fail(published.error);
      const physical = () => { held.checkProfile(); native.recheck(); };
      let terminal: Awaited<ReturnType<typeof captureIndexFootprint>>;
      try {
        physical();
        await held.sync();
        terminal = await captureIndexFootprint(directory, assertInventoryLease(), vacant.profile.uid, physical,
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
      return { ok: true as const, generation, documents: rows.length };
    });
  }
}

function nativeFailure(result: Extract<IndexResult, { ok: false }>) {
  return fail(result.error === "READONLY" || result.error === "CLOSED" ? "UNAVAILABLE" : result.error);
}
