import { createHash } from "node:crypto";
import type { Dir } from "node:fs";
import { opendir } from "node:fs/promises";

import { captureIndexFootprint } from "./cache-footprint";
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
import {
  acquireIndexReuseSlot,
  IndexReuseCleanupError,
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
type RetirementResult =
  | { ok: true; alreadyRetired: boolean }
  | { ok: false; error: ExactError | "SCHEMA" | "BUSY" | "CANCELLED" | "UNKNOWN" | "UNAVAILABLE"; accepted: boolean };

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

export async function retireIndexReuse(
  directory: string, target: IndexRetirementTarget, current: () => boolean
): Promise<RetirementResult> {
  if (!current()) return fail("CANCELLED");
  const acquired = await acquireIndexReuseSlot(directory);
  if (!acquired.ok)
    return fail(acquired.error === "UNKNOWN" || current() ? acquired.error : "CANCELLED");
  const { slot } = acquired;
  const check = () => {
    if (!current()) throw Error("Index retirement cancelled");
  };
  let result: RetirementResult;
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

  async function run(): Promise<RetirementResult> {
    check();
    const cached = await slot.readCatalog();
    check();
    if (cached.status === "invalid") return fail("SCHEMA");
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
    const { catalog, identity } = cached;
    if (catalog.scopeKey !== target.scopeKey) return fail("SCHEMA");
    if (catalog.generation !== target.generation) return fail("MISMATCH");
    if (cached.status === "retired") {
      slot.assertCatalogIdentity(identity);
      return { ok: true, alreadyRetired: true };
    }
    await slot.retireCatalog(target, identity, check);
    return { ok: true, alreadyRetired: false };
  }
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
    if (cached.status === "invalid" || cached.status === "retired") return fail("SCHEMA");
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
