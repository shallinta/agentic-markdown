import { createHash } from "node:crypto";
import type { Dir } from "node:fs";
import { opendir } from "node:fs/promises";
import { join } from "node:path";

import { captureIndexFootprint, sameIndexInventoryMetadata } from "./cache-footprint";
import {
  INDEX_LIMITS,
  encodeChanges,
  keys,
  natural,
  record,
  scalar,
  type IndexChange,
  type IndexHit,
  type IndexResult,
} from "./protocol";
import { samePurgeStamp, verifyPurgeSubset } from "./purge-proof";
import { publishPurgeRoster } from "./purge-publish";
import { unlinkPurgeMember } from "./purge-remove";
import { encodePurgeRoster, purgeMemberOrder } from "./purge-roster";
import { readPinnedPurgeRoster, readPreparedReclaimCatalog, validReclaimLayout } from "./reclaim-layout";
import { loadReclaimStage } from "./reclaim-stage";
import {
  acquireIndexReuseSlot,
  IndexReuseCleanupError,
  reclaimDirectoryName,
  type IndexPurgeMemberTarget,
  type IndexReclaimIntentTarget,
  type IndexRetirementTarget,
  type IndexReuseCatalog,
} from "./reuse-catalog";
import { createIndexSession } from "./session";

export interface IndexReuseInput {
  scopeKey: string;
  rows: readonly { id: string; raw: string }[];
  query: string;
}

type Failure = Extract<IndexResult, { ok: false }>;
type ReuseResult =
  | Failure
  | { ok: true; generation: number; hits: IndexHit[]; applied: number };
type ExactError = "MISSING" | "MISMATCH";
type ExactReuseResult = ReuseResult | { ok: false; error: ExactError; accepted: boolean };
interface RetirementFailure {
  ok: false;
  error: ExactError | "INPUT" | "SCHEMA" | "BUSY" | "CANCELLED" | "UNKNOWN" | "UNAVAILABLE";
  accepted: boolean;
}
type RetirementSlot = Extract<Awaited<ReturnType<typeof acquireIndexReuseSlot>>, { ok: true }>["slot"];
type ProvenCatalog = Extract<
  Awaited<ReturnType<RetirementSlot["readCatalog"]>>, { status: "existing" | "retired" | "prepared" }
>;

const fail = <Error extends Failure["error"] | ExactError>(error: Error) => ({
  ok: false as const,
  error,
  accepted: error === "UNKNOWN",
});

async function closeProfileInspection(directory: Dir) {
  try {
    await directory.close();
  } catch {
    throw new IndexReuseCleanupError("Index reuse profile inspection close unconfirmed");
  }
}

async function profileContainsOnlyLease(directory: string, check: () => void) {
  const directoryHandle = await opendir(directory, { bufferSize: 2 });
  try {
    check();
    const first = await directoryHandle.read();
    check();
    if (first?.name !== ".lease") return false;
    const second = await directoryHandle.read();
    check();
    return second === null;
  } finally {
    await closeProfileInspection(directoryHandle);
  }
}

async function useRetirementSlot<Result extends { ok: true }>(
  directory: string, target: IndexRetirementTarget, current: () => boolean,
  use: (slot: RetirementSlot, cached: ProvenCatalog, check: () => void) => Promise<Result | RetirementFailure>,
  mode: "retirement" | "prepare" | "stage" = "retirement"
): Promise<Result | RetirementFailure> {
  if (!current()) return fail("CANCELLED");
  const acquired = await acquireIndexReuseSlot(directory);
  if (!acquired.ok)
    return fail(acquired.error === "UNKNOWN" || current() ? acquired.error : "CANCELLED");
  const { slot } = acquired;
  const check = () => {
    if (!current()) throw Error("Index retirement cancelled");
  };
  let result: Result | RetirementFailure;
  try {
    result = await run();
  } catch (error) {
    result = fail(error instanceof IndexReuseCleanupError
      ? "UNKNOWN" : current() ? "UNAVAILABLE" : "CANCELLED");
  } finally {
    try {
      await slot.release();
    } catch {
      result = fail("UNKNOWN");
    }
  }
  return result;

  async function run(): Promise<Result | RetirementFailure> {
    check();
    const cached = await (mode === "stage" ? slot.readStageCatalog()
      : mode === "prepare" ? slot.readPrepareCatalog() : slot.readCatalog());
    check();
    if (cached.status === "invalid" || (mode === "retirement" && cached.status === "prepared")) return fail("SCHEMA");
    if (cached.status === "cold") {
      const checkCold = () => {
        check();
        slot.assertInventoryLease();
      };
      checkCold();
      const empty = await profileContainsOnlyLease(directory, checkCold);
      checkCold();
      return fail(empty ? "MISSING" : "SCHEMA");
    }
    const { catalog } = cached;
    if (catalog.scopeKey !== target.scopeKey) return fail("SCHEMA");
    if (catalog.generation !== target.generation) return fail("MISMATCH");
    return use(slot, cached, check);
  }
}

function captureRetirementFootprint(
  directory: string, { assertInventoryLease }: RetirementSlot, cached: ProvenCatalog, check: () => void,
  includePurge = false
) {
  const { identity } = cached;
  const placement = cached.status === "prepared" ? cached.placement : "original";
  return captureIndexFootprint(
    directory, assertInventoryLease(), identity.catalog.uid, check, assertInventoryLease, identity, placement, includePurge
  );
}

async function verifyRetiredFootprint(
  directory: string, slot: RetirementSlot, cached: ProvenCatalog, check: () => void,
  target: IndexRetirementTarget, expectedDigest: string, includePurge = false
) {
  const footprint = await captureRetirementFootprint(directory, slot, cached, check, includePurge);
  footprint.recheck();
  if (footprint.status !== "existing") return fail("UNAVAILABLE");
  const inventoryDigest = footprint.inventoryDigest(target);
  const placement = cached.status === "prepared" ? cached.placement : "original";
  if (placement === "original" && inventoryDigest !== expectedDigest) return fail("MISMATCH");
  const valid = await validReclaimLayout(
    join(directory, reclaimDirectoryName(placement)), new Map(footprint.nativeFiles()), target.generation, footprint.checkIndex
  );
  footprint.recheck();
  if (!valid) return fail("SCHEMA");
  return { ok: true as const, footprint, inventoryDigest };
}

export function retireIndexReuse(
  directory: string, target: IndexRetirementTarget, current: () => boolean, seal?: true
) {
  return useRetirementSlot<{ ok: true; alreadyRetired: boolean }>(directory, target, current, async (slot, cached, check) => {
    const { identity } = cached;
    if (seal) {
      if (cached.status === "retired" && cached.catalog.version !== 2) return fail("SCHEMA");
      const footprint = await captureRetirementFootprint(directory, slot, cached, check);
      footprint.recheck();
      if (footprint.status !== "existing") return fail("UNAVAILABLE");
      const inventoryDigest = footprint.inventoryDigest(target);
      if (cached.status === "retired") {
        return cached.catalog.version === 2 && cached.catalog.inventoryDigest === inventoryDigest
          ? { ok: true, alreadyRetired: true } : fail("MISMATCH");
      }
      await slot.retireCatalog(target, identity, footprint.recheckAfterStaging, inventoryDigest);
      return { ok: true, alreadyRetired: false };
    }
    if (cached.status === "retired") {
      slot.assertCatalogIdentity(identity);
      return { ok: true, alreadyRetired: true };
    }
    await slot.retireCatalog(target, identity, check);
    return { ok: true, alreadyRetired: false };
  });
}

export async function inspectRetiredIndexReuse(directory: string, target: IndexRetirementTarget, current: () => boolean) {
  const result = await useRetirementSlot<{ ok: true; inventoryDigest: string; files: number; logicalBytes: number }>(
    directory, target, current, async (slot, cached, check) => {
      if (cached.status !== "retired" || cached.catalog.version !== 2) return fail("SCHEMA");
      const verified = await verifyRetiredFootprint(directory, slot, cached, check, target, cached.catalog.inventoryDigest);
      if (!verified.ok) return verified;
      const { footprint, inventoryDigest } = verified;
      if (footprint.totalBytes > BigInt(Number.MAX_SAFE_INTEGER)) return fail("UNAVAILABLE");
      return { ok: true, inventoryDigest, files: footprint.files, logicalBytes: Number(footprint.totalBytes) };
    }
  );
  return result.ok && !current() ? fail("CANCELLED") : result;
}

export function prepareRetiredIndexReuse(directory: string, target: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetirementSlot<{ ok: true; alreadyPrepared: boolean }>(
    directory, target, current, async (slot, cached, check) => {
      if (cached.status !== "prepared" && (cached.status !== "retired" || cached.catalog.version !== 2))
        return fail("SCHEMA");
      const { catalog } = cached;
      if (!("inventoryDigest" in catalog) || catalog.inventoryDigest !== target.inventoryDigest)
        return fail("MISMATCH");
      const verified = await verifyRetiredFootprint(directory, slot, cached, check, target, target.inventoryDigest);
      if (!verified.ok) return verified;
      const { footprint } = verified;
      const stagingDigest = footprint.stagingDigest(target);
      const alreadyPrepared = cached.status === "prepared";
      if (alreadyPrepared && cached.catalog.stagingDigest !== stagingDigest) return fail("MISMATCH");
      await slot.prepareReclaimCatalog({
        version: 3, profile: "limited-v1", state: "reclaim-prepared", ...target, stagingDigest,
      }, cached.identity, {
        alreadyPrepared,
        beforeCommit: alreadyPrepared ? footprint.recheck : footprint.recheckAfterStaging,
        verifyNative: footprint.recheckNative,
      });
      return { ok: true, alreadyPrepared };
    },
    "prepare"
  );
}

export function stageRetiredIndexReuse(directory: string, target: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetirementSlot<{ ok: true; alreadyStaged: boolean }>(
    directory, target, current, async (slot, cached, check) => {
      if (cached.status !== "prepared") return fail("SCHEMA");
      if (cached.catalog.inventoryDigest !== target.inventoryDigest) return fail("MISMATCH");
      const verified = await verifyRetiredFootprint(directory, slot, cached, check, target, target.inventoryDigest);
      if (!verified.ok) return verified;
      const { stagingDigest } = cached.catalog;
      if (verified.footprint.stagingDigest(target) !== stagingDigest) return fail("MISMATCH");
      const alreadyStaged = cached.placement === "pending";
      const native = alreadyStaged ? undefined : loadReclaimStage();
      if (!alreadyStaged && !native) return fail("UNAVAILABLE");

      return slot.withStageDirectories(cached.placement, cached.identity, native?.openIndex, async (held) => {
        verified.footprint.recheck();
        held.check(cached.placement);
        if (native) {
          const result = native.stage(held.profileFd, held.indexFd);
          if (result !== "staged") return fail(result);
        }
        try {
          const checkPending = () => held.check("pending");
          checkPending();
          await held.sync();
          checkPending();
          const saved = await slot.readStageCatalog();
          if (saved.status !== "prepared" || saved.placement !== "pending" ||
              saved.catalog.scopeKey !== target.scopeKey || saved.catalog.generation !== target.generation ||
              saved.catalog.inventoryDigest !== target.inventoryDigest || saved.catalog.stagingDigest !== stagingDigest)
            throw Error("Index staging marker changed");
          const terminal = await verifyRetiredFootprint(
            directory, slot, saved, checkPending, target, target.inventoryDigest
          );
          if (!terminal.ok || terminal.footprint.stagingDigest(target) !== stagingDigest)
            throw Error("Index staging inventory changed");
          checkPending();
        } catch {
          throw new IndexReuseCleanupError("Index staging sync or confirmation unconfirmed");
        }
        return { ok: true, alreadyStaged };
      });
    },
    "stage"
  );
}

export function prepareStagedIndexReusePurge(directory: string, target: IndexReclaimIntentTarget, current: () => boolean) {
  return useRetirementSlot<{ ok: true; alreadyPrepared: boolean }>(
    directory, target, current, async (slot, cached, check) => {
      if (cached.status !== "prepared" || cached.placement !== "pending") return fail("SCHEMA");
      const { catalog } = cached;
      if (catalog.inventoryDigest !== target.inventoryDigest) return fail("MISMATCH");
      const alreadyPrepared = slot.hasPurgeRoster();
      const verified = await verifyRetiredFootprint(
        directory, slot, cached, check, target, target.inventoryDigest, alreadyPrepared
      );
      if (!verified.ok) return verified;
      const { footprint } = verified;
      if (footprint.stagingDigest(target) !== catalog.stagingDigest) return fail("MISMATCH");
      const prepared = await readPreparedReclaimCatalog(directory, footprint.catalogStat, footprint.checkIndex);
      footprint.recheck();
      if (!prepared) return fail("MISMATCH");
      if (prepared.catalog.scopeKey !== target.scopeKey || prepared.catalog.generation !== target.generation ||
          prepared.catalog.inventoryDigest !== target.inventoryDigest || prepared.catalog.stagingDigest !== catalog.stagingDigest)
        return fail("MISMATCH");
      const contents = encodePurgeRoster(catalog, prepared.catalogSha256, footprint.directoryStamp(), footprint.fileStamps());
      if (!contents) return fail("UNAVAILABLE");
      if (footprint.purgeStat) {
        const prior = await readPinnedPurgeRoster(directory, footprint.purgeStat, footprint.checkIndex);
        footprint.recheck();
        if (!prior) return fail("UNAVAILABLE");
        if (!prior.equals(contents)) return fail("MISMATCH");
      }

      return slot.withStageDirectories("pending", cached.identity, undefined, async (held) => {
        footprint.recheck();
        held.check("pending");
        let installed = footprint.purgeStat;
        if (!installed) {
          const result = publishPurgeRoster(directory, held, contents, footprint.recheckAfterStaging);
          if (!result.ok) return fail(result.error);
          installed = result.installed;
        }
        try {
          const checkPending = () => held.check("pending");
          checkPending();
          await held.sync();
          const terminal = await captureRetirementFootprint(directory, slot, cached, checkPending, true);
          terminal.recheck();
          if (terminal.status !== "existing" || !terminal.purgeStat ||
              !sameIndexInventoryMetadata(installed, terminal.purgeStat) ||
              terminal.stagingDigest(target) !== catalog.stagingDigest)
            throw Error("Purge roster or native index changed");
          const savedCatalog = await readPreparedReclaimCatalog(directory, terminal.catalogStat, terminal.checkIndex);
          const savedRoster = await readPinnedPurgeRoster(directory, terminal.purgeStat, terminal.checkIndex);
          terminal.recheck();
          if (savedCatalog?.catalogSha256 !== prepared.catalogSha256 || !savedRoster?.equals(contents))
            throw Error("Purge roster confirmation changed");
        } catch {
          throw new IndexReuseCleanupError("Purge roster sync or confirmation unconfirmed");
        }
        return { ok: true, alreadyPrepared };
      });
    },
    "stage"
  );
}

export function removeStagedIndexReuseMember(directory: string, target: IndexPurgeMemberTarget, current: () => boolean) {
  return useRetirementSlot<{ ok: true; alreadyMissing: boolean; remainingFiles: number }>(
    directory, target, current, async (slot, cached, check) => {
      if (cached.status !== "prepared" || cached.placement !== "pending") return fail("SCHEMA");
      const owner = cached.identity.catalog.uid;
      const footprint = await captureRetirementFootprint(directory, slot, cached, check, true);
      const proof = await verifyPurgeSubset(directory, footprint, target, owner);
      if (!proof.ok) return proof;
      const order = purgeMemberOrder(proof.roster.files);
      const selected = order[target.ordinal];
      if (!selected) return fail("INPUT");
      const [name] = selected;
      const present = new Map(proof.footprint.nativeFiles());
      const pinned = present.get(name);
      const alreadyMissing = !pinned;
      if (pinned && order.find(([member]) => present.has(member))?.[0] !== name) return fail("MISMATCH");
      const expected = proof.remaining.filter(([member]) => member !== name);
      const { assertInventoryLease } = slot;

      return slot.withStageDirectories("pending", cached.identity, undefined, async (held) => {
        proof.footprint.recheck();
        held.check("pending");
        if (pinned) {
          const result = unlinkPurgeMember(held, name, pinned, proof.footprint.recheck);
          if (result !== "removed") return fail(result);
        }
        try {
          const checkPending = () => pinned ? held.checkPendingAfterRemoval() : held.check("pending");
          checkPending();
          await held.syncPending();
          const index = checkPending();
          const snapshot = await captureIndexFootprint(
            directory, assertInventoryLease(), owner, checkPending, assertInventoryLease,
            { catalog: cached.identity.catalog, index }, "pending", true
          );
          const terminal = await verifyPurgeSubset(directory, snapshot, target, owner);
          if (!terminal.ok || terminal.catalogSha256 !== proof.catalogSha256 ||
              !terminal.rosterBytes.equals(proof.rosterBytes) ||
              !sameIndexInventoryMetadata(proof.footprint.catalogStat, terminal.footprint.catalogStat) ||
              !sameIndexInventoryMetadata(proof.purgeStat, terminal.purgeStat) ||
              terminal.remaining.length !== expected.length ||
              terminal.remaining.some(([member, stamp], i) =>
                member !== expected[i][0] || !samePurgeStamp(expected[i][1], stamp)))
            throw Error("Purge member receipt does not match the remaining inventory");
          terminal.footprint.recheck();
          checkPending();
          return { ok: true, alreadyMissing, remainingFiles: terminal.remaining.length };
        } catch {
          throw new IndexReuseCleanupError("Purge member sync or confirmation unconfirmed");
        }
      });
    },
    "stage"
  );
}

/** One private cache, one bounded verified snapshot. Cache state never grants access. */
export function searchWithIndexReuse(
  directory: string,
  input: IndexReuseInput,
  current: () => boolean
): Promise<ReuseResult> {
  return runIndexReuse(directory, input, current, false);
}

export function reopenWithIndexReuse(
  directory: string,
  input: IndexReuseInput,
  current: () => boolean,
  maxLogicalBytes?: number
): Promise<ExactReuseResult> {
  return runIndexReuse(directory, input, current, true, maxLogicalBytes);
}

function runIndexReuse(directory: string, input: IndexReuseInput, current: () => boolean, exact: false): Promise<ReuseResult>;
function runIndexReuse(directory: string, input: IndexReuseInput, current: () => boolean, exact: true, maxLogicalBytes?: number): Promise<ExactReuseResult>;
async function runIndexReuse(
  directory: string, input: IndexReuseInput, current: () => boolean, exact: boolean, maxLogicalBytes?: number
): Promise<ExactReuseResult> {
  if (maxLogicalBytes !== undefined && !natural(maxLogicalBytes)) return fail("INPUT");
  if (!current()) return fail("CANCELLED");
  const { scopeKey, query } = input;
  const source: unknown = input.rows;
  if (typeof scopeKey !== "string" || !/^[a-f0-9]{64}$/.test(scopeKey) ||
      !scalar(query, INDEX_LIMITS.query) || !query.length || !Array.isArray(source))
    return fail("INPUT");
  if (source.length > INDEX_LIMITS.documents) return fail("LIMIT");

  const rows = new Map<string, { raw: string; hash: string }>();
  let remaining = INDEX_LIMITS.bytes;
  for (const value of source) {
    const row: unknown = value;
    if (!record(row) || !keys(row, "id,raw") ||
        typeof row.id !== "string" || !/^[A-Za-z0-9-]{1,32}$/.test(row.id) ||
        rows.has(row.id) || typeof row.raw !== "string")
      return fail("INPUT");
    if (row.raw.length > remaining) return fail("LIMIT");
    if (!scalar(row.raw, INDEX_LIMITS.bytes)) return fail("INPUT");
    remaining -= Buffer.byteLength(row.raw);
    if (remaining < 0) return fail("LIMIT");
    rows.set(row.id, { raw: row.raw, hash: createHash("sha256").update(row.raw).digest("hex") });
  }

  const check = () => {
    if (!current()) throw Error("Index reuse cancelled");
  };
  const caught = (error: unknown) =>
    fail(error instanceof IndexReuseCleanupError
      ? "UNKNOWN" : current() ? "UNAVAILABLE" : "CANCELLED");
  const acquired = await acquireIndexReuseSlot(directory);
  if (!acquired.ok)
    return fail(acquired.error === "UNKNOWN" || current() ? acquired.error : "CANCELLED");
  const { slot } = acquired;
  let session: ReturnType<typeof createIndexSession> | undefined;
  let nativeGeneration: number | undefined;
  let catalog: IndexReuseCatalog | undefined;
  let result: ExactReuseResult;
  try {
    try {
      result = await run();
    } catch (error) {
      result = caught(error);
    }
    try {
      const closed = await session?.close();
      if (closed && (!closed.ok
        ? nativeGeneration !== undefined || closed.error !== "UNAVAILABLE"
        : nativeGeneration !== undefined && closed.generation !== nativeGeneration))
        result = fail("UNKNOWN");
    } catch {
      result = fail("UNKNOWN");
    }
    if (result.ok && catalog) {
      try {
        check();
        await slot.writeCatalog(catalog, check);
      } catch (error) {
        result = caught(error);
      }
    }
  } finally {
    try {
      await slot.release();
    } catch {
      result = fail("UNKNOWN");
    }
  }
  return result.ok && !current() ? fail("CANCELLED") : result;

  async function run(): Promise<ExactReuseResult> {
    check();
    const cached = await slot.readCatalog();
    check();
    if (cached.status === "invalid" || cached.status === "retired" || cached.status === "prepared")
      return fail("SCHEMA");
    const prior = cached.status === "existing" ? cached.catalog : undefined;
    if (prior && prior.scopeKey !== scopeKey) return fail("SCHEMA");
    if (exact && !prior) {
      const empty = await profileContainsOnlyLease(directory, check);
      check();
      return fail(empty ? "MISSING" : "SCHEMA");
    }

    const previous = new Map(prior?.entries.map(({ id, hash }) => [id, hash]));
    const changes: IndexChange[] = [];
    for (const id of previous.keys())
      if (!rows.has(id)) changes.push({ kind: "delete", id });
    for (const [id, { raw, hash }] of rows)
      if (previous.get(id) !== hash) changes.push({ kind: "put", id, path: id, raw });
    if (exact && changes.length) return fail("MISMATCH");
    if (changes.length) {
      try {
        encodeChanges(changes);
      } catch {
        return fail("LIMIT");
      }
    }
    if (maxLogicalBytes !== undefined && cached.status === "existing") {
      const { identity } = cached;
      const { assertInventoryLease } = slot;
      const footprint = await captureIndexFootprint(
        directory, assertInventoryLease(), identity.catalog.uid, check, assertInventoryLease, identity
      );
      footprint.recheck();
      if (footprint.status !== "existing") return fail("UNAVAILABLE");
      if (footprint.totalBytes > BigInt(maxLogicalBytes)) return fail("LIMIT");
    } else check();
    if (slot.hasPurgeRoster()) return fail("SCHEMA");
    session = createIndexSession();
    const opened = await session.open(slot.indexPath, exact ? "reader-only" : prior ? "writer-existing" : "create-new");
    if (opened.ok) nativeGeneration = opened.generation;
    if (!opened.ok && opened.error === "UNKNOWN") return opened;
    check();
    if (!opened.ok) return opened;
    let generation = opened.generation;
    if (generation !== (prior?.generation ?? 0)) return fail("SCHEMA");
    if (exact) {
      const verified = await session.verifyRoster([...rows].map(([id, { raw }]) => ({ id, raw })));
      if (!verified.ok && verified.error === "UNKNOWN") return verified;
      check();
      if (!verified.ok) return verified;
    }
    if (changes.length) {
      const applied = await session.applyAndCommit(changes);
      if (applied.ok) nativeGeneration = applied.generation;
      if (!applied.ok && applied.error === "UNKNOWN") return applied;
      check();
      if (!applied.ok) return applied;
      generation = applied.generation;
    }
    const queried = await session.query(query);
    if (!queried.ok && queried.error === "UNKNOWN") return queried;
    check();
    if (!queried.ok) return queried;
    const expected = new Map<string, number>();
    for (const [id, { raw }] of rows) {
      const from = raw.indexOf(query);
      if (from >= 0) expected.set(id, from);
    }
    const hits = queried.hits;
    if (!hits || queried.generation !== generation || hits.length !== expected.size ||
        hits.some(({ id, from, to }) => expected.get(id) !== from || to !== from + query.length))
      return fail("UNKNOWN");
    if (!exact && (!prior || changes.length)) {
      catalog = {
        version: 1,
        profile: "limited-v1",
        scopeKey,
        generation,
        entries: [...rows.keys()].sort().map((id) => ({ id, hash: rows.get(id)!.hash })),
      };
    }
    return { ok: true, generation, hits, applied: changes.length };
  }
}
