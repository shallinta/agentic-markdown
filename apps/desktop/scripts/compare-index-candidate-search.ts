import { createHash } from "node:crypto";
import { lstatSync, type BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../src/bun/documents";
import { fileFingerprint, verifySingleFileAuthorization } from "../src/bun/documents/path-authorization";
import { inspectAppIndexCacheFootprint } from "../src/bun/index/app-cache";
import { captureIndexPublicationInventory, sameIndexInventoryMetadata } from "../src/bun/index/cache-footprint";
import type { IndexResult, IndexRosterRow } from "../src/bun/index/protocol";
import { readPinnedReclaimCatalog, validReclaimLayout } from "../src/bun/index/reclaim-layout";
import { acquireIndexReuseSlot } from "../src/bun/index/reuse-catalog";
import { createIndexSession } from "../src/bun/index/session";
import { createWorkspaceService } from "../src/bun/workspace";
import { authorizeEntry, authorizeRoot, verifyRoot, type RootAuthorization } from "../src/bun/workspace/authorization";
import { createScanWorker } from "../src/bun/workspace/worker";
import type { WorkspaceRequest } from "../src/shared/workspace";

const arms = ["direct", "candidate"] as const;
type Arm = (typeof arms)[number];
const orders = [arms, ["candidate", "direct"], arms, ["candidate", "direct"]] as const;
const queries = [
  { id: "q01", literal: "单篇授权", firstFrom: 10 },
  { id: "q02", literal: "🧭 dense", firstFrom: 16 },
  { id: "q03", literal: "未写入🚫", firstFrom: undefined },
] as const;
const corpora = [{ id: "tiny", documents: 2, bytes: undefined }, { id: "bounded", documents: 16, bytes: 4096 }] as const;
type Corpus = (typeof corpora)[number];
type NativeSession = ReturnType<typeof createIndexSession>;
type Slot = Extract<Awaited<ReturnType<typeof acquireIndexReuseSlot>>, { ok: true }>["slot"];
type SourceGrant = Awaited<ReturnType<typeof authorizeEntry>>;

class ComparisonError extends Error {}
class SourceChanged extends Error {}
function requireEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ComparisonError(message);
}

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => sha(JSON.stringify(value));
const byId = (a: { id: string }, b: { id: string }) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function fixtureRows(corpus: Corpus) {
  return Array.from({ length: corpus.documents }, (_, index) => {
    const id = `doc-${String(index + 1).padStart(2, "0")}`;
    const sparse = index === 0 ? queries[0].literal : "合成段落";
    const prefix = `\uFEFF第${id.slice(-2)}篇 📄\r\n${sparse}\r\n${queries[1].literal}\r\n# 合成片段\n${queries[1].literal}\n`;
    const filler = `para-${id} The quick brown fox 0123456789.\n`;
    const remaining = corpus.bytes === undefined ? 0 : corpus.bytes - Buffer.byteLength(prefix);
    const raw = prefix + filler.repeat(Math.ceil(remaining / filler.length)).slice(0, remaining);
    return { id, raw, bytes: Buffer.byteLength(raw), hash: sha(raw) };
  });
}

async function withLease<T>(profile: string, use: (slot: Slot, retain: () => void) => Promise<T>) {
  const acquired = await acquireIndexReuseSlot(profile);
  requireEvidence(acquired.ok, "Could not acquire the isolated index lease");
  let retain = false;
  try {
    return await use(acquired.slot, () => { retain = true; });
  } finally {
    if (!retain) await acquired.slot.release();
  }
}

async function readIndex(
  slot: Slot, generation: number, guard: () => void, retain: () => void,
  work: (session: NativeSession) => Promise<IndexResult>, beforeWorker?: () => void
) {
  guard();
  const session = createIndexSession(undefined, () => { guard(); beforeWorker?.(); });
  let openedGeneration: number | undefined;
  const drain = async () => {
    try {
      const closed = await session.close();
      requireEvidence(closed.ok && closed.generation === (openedGeneration ?? 0), "Index reader did not drain");
    } catch (error) {
      retain();
      throw error;
    }
  };
  try {
    const opened = await session.open(slot.indexPath, "reader-only");
    if (opened.ok) openedGeneration = opened.generation;
    requireEvidence(opened.ok && opened.generation === generation, "Index reader opened a different generation");
    guard();
    const result = await work(session);
    requireEvidence(result.ok && result.generation === generation, "Index reader operation did not verify");
    return result;
  } finally {
    await drain();
  }
}

interface CachePins {
  generation: number;
  catalog: BigIntStats;
  bytes: Buffer;
  index: BigIntStats;
  files: ReadonlyMap<string, BigIntStats>;
}

async function pinCache(profile: string, slot: Slot, catalog: BigIntStats, current: () => void) {
  const inventory = await captureIndexPublicationInventory(profile, current, slot.assertInventoryLease, catalog);
  requireEvidence(inventory, "Index artifact layout differs");
  const recheck = () => { current(); inventory.checkProfile(); inventory.recheck(); };
  const pinned = await readPinnedReclaimCatalog(profile, catalog, recheck);
  requireEvidence(pinned, "Pinned index catalog unavailable");
  recheck();
  return { inventory, bytes: pinned.bytes, recheck };
}

function sameCache(expected: CachePins, pinned: Awaited<ReturnType<typeof pinCache>>) {
  return expected.bytes.equals(pinned.bytes) && sameIndexInventoryMetadata(expected.index, pinned.inventory.indexStat) &&
    expected.files.size === pinned.inventory.files.size &&
    [...expected.files].every(([name, stat]) => {
      const current = pinned.inventory.files.get(name);
      return current && sameIndexInventoryMetadata(stat, current);
    });
}

interface SourcePin { path: string; stat: BigIntStats }
interface SourceProof {
  root: RootAuthorization;
  directory: BigIntStats;
  files: readonly SourcePin[];
  current: () => boolean;
}
async function proveSourceRoot(source: SourceProof, check: () => void) {
  check();
  await verifyRoot(source.root, check);
  const latest = await lstat(source.root.path, { bigint: true });
  check();
  if (!sameIndexInventoryMetadata(source.directory, latest)) throw new SourceChanged();
}

function checkSourceStamps(source: SourceProof, check: () => void) {
  check();
  if (!sameIndexInventoryMetadata(source.directory, lstatSync(source.root.path, { bigint: true })))
    throw new SourceChanged();
  for (const { path, stat } of source.files)
    if (!sameIndexInventoryMetadata(stat, lstatSync(path, { bigint: true }))) throw new SourceChanged();
  check();
}

async function verifySourceFile(grant: SourceGrant, stat: BigIntStats, check: () => void) {
  const latest = await verifySingleFileAuthorization(grant, check);
  check();
  if (!sameIndexInventoryMetadata(stat, latest)) throw new SourceChanged();
}

async function prepareCandidate(
  profile: string, source: SourceProof, scopeKey: string, generation: number, rows: readonly IndexRosterRow[]
): Promise<CachePins> {
  const current = () => { if (!source.current()) throw new SourceChanged(); };
  return withLease(profile, async (slot, retain) => {
    current();
    const saved = await slot.readCatalog();
    requireEvidence(saved.status === "existing" && saved.catalog.scopeKey === scopeKey &&
      saved.catalog.generation === generation, "Cold seed catalog is not the authorized generation");
    const expected = rows.map(({ id, raw }) => ({ id, hash: sha(raw) })).sort(byId);
    requireEvidence(JSON.stringify(saved.catalog.entries) === JSON.stringify(expected), "Cold seed catalog roster differs");
    const pinned = await pinCache(profile, slot, saved.identity.catalog, current);
    requireEvidence(sameIndexInventoryMetadata(saved.identity.index, pinned.inventory.indexStat) &&
      await validReclaimLayout(slot.indexPath, pinned.inventory.files, generation, pinned.recheck),
    "Cold seed artifact proof differs");
    await readIndex(slot, generation, pinned.recheck, retain, (session) => session.verifyRoster(rows));
    pinned.recheck();
    return {
      generation, catalog: saved.identity.catalog, bytes: pinned.bytes,
      index: pinned.inventory.indexStat, files: pinned.inventory.files,
    };
  });
}

async function queryCandidate(
  profile: string, source: SourceProof, cache: CachePins, entryByIndexId: ReadonlyMap<string, string>, query: string,
  hooks?: { beforeWorker?: () => void; afterWorker?: () => Promise<void> }
) {
  const check = () => { if (!source.current()) throw new SourceChanged(); };
  const start = performance.now();
  let preEnd = start;
  let workerEnd = start;
  let postEnd = start;
  const hits = await withLease(profile, async (slot, retain) => {
    const grants: SourceGrant[] = [];
    let terminalCacheCheck: (() => void) | undefined;
    try {
      await proveSourceRoot(source, check);
      for (const { path, stat } of source.files) {
        const grant = await authorizeEntry(source.root, path, fileFingerprint(stat), [], false, check);
        grants.push(grant);
        await verifySourceFile(grant, stat, check);
      }
      const pinned = await pinCache(profile, slot, cache.catalog, check);
      requireEvidence(sameCache(cache, pinned), "Candidate cache stamp differs");
      await proveSourceRoot(source, check);
      pinned.recheck();
      preEnd = performance.now();
      const result = await readIndex(slot, cache.generation, pinned.recheck, retain,
        (session) => session.query(query), hooks?.beforeWorker);
      workerEnd = performance.now();
      if (hooks?.afterWorker) await hooks.afterWorker();
      await proveSourceRoot(source, check);
      for (const [index, grant] of grants.entries()) await verifySourceFile(grant, source.files[index].stat, check);
      await proveSourceRoot(source, check);
      pinned.recheck();
      requireEvidence(result.hits, "Candidate query has no hit roster");
      const mapped = result.hits.map(({ id, from, to }) => {
        const entry = entryByIndexId.get(id);
        requireEvidence(entry, "Candidate returned an unauthorized row");
        return { entry, from, to };
      });
      terminalCacheCheck = pinned.recheck;
      postEnd = performance.now();
      return mapped;
    } finally {
      const closed = await Promise.allSettled(grants.map((grant) => grant.file.close()));
      requireEvidence(closed.every((result) => result.status === "fulfilled"), "Candidate source descriptor close failed");
      terminalCacheCheck?.();
    }
  });
  checkSourceStamps(source, check);
  const end = performance.now();
  return {
    hits, ms: end - start,
    phases: { pre: preEnd - start, worker: workerEnd - preEnd, post: postEnd - workerEnd, cleanup: end - postEnd },
  };
}

function timing(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return { min: sorted[0], median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted[sorted.length - 1] };
}

async function runCorpus(scratch: string, corpus: Corpus) {
  const base = join(scratch, corpus.id);
  const home = join(base, "app");
  const rootPath = join(base, "root");
  const profile = join(home, "search-index", "limited-v1");
  for (const directory of [base, home, rootPath]) await mkdir(directory, { mode: 0o700 });
  requireEvidence(await realpath(home) === home && await realpath(rootPath) === rootPath,
    "Synthetic workspace and App home are not canonical");
  process.env.AGENTIC_MARKDOWN_HOME = home;
  const rows = fixtureRows(corpus);
  requireEvidence(rows.every(({ bytes }) => bytes > 0 && (corpus.bytes === undefined || bytes === corpus.bytes)),
    "Synthetic corpus byte count differs");
  await Promise.all(rows.map(({ id, raw }) => writeFile(join(rootPath, `${id}.md`), raw, { flag: "wx", mode: 0o600 })));

  const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const scanner = createScanWorker();
  const watched = new Set<string>();
  // Only observation receipts are controlled. The scanner and document authorization are real.
  const workspace = createWorkspaceService({
    documents, pickDirectory: () => Promise.resolve(rootPath), contentSearchStrategy: "direct",
    worker: {
      call(message) {
        if (message.op === "watchStart" && typeof message.key === "string") {
          watched.add(message.key);
          return Promise.resolve({ bytes: 0 });
        }
        if (message.op === "watchClose" && typeof message.key === "string") {
          watched.delete(message.key);
          return Promise.resolve({ bytes: 0 });
        }
        if (message.op === "watchTick") return Promise.resolve({ bytes: 0, queueBytes: 0,
          roots: [...watched].map((key) => ({ key, status: "watching", dirty: false })) });
        return scanner.call(message);
      },
      dispose: () => scanner.dispose(),
    },
  });
  async function request(input: Omit<WorkspaceRequest, "protocolVersion" | "requestId">) {
    const result = await workspace.request({ protocolVersion: 1, requestId: crypto.randomUUID(), ...input });
    requireEvidence(result.ok, "Synthetic workspace request failed");
    return result;
  }
  async function observedRoot() {
    await request({ op: "select" });
    for (let attempt = 0; attempt < 1000; attempt++) {
      const root = (await request({ op: "state" })).roots.find(({ displayPath }) => displayPath === rootPath);
      if (root?.status === "complete") {
        const hint = workspace.captureIndexWatchHint(root.handle, root.generation);
        if (hint.ok) return { root, hint };
      } else requireEvidence(!root || root.status === "scanning", "Synthetic workspace scan did not complete");
      await Bun.sleep(5);
    }
    throw new ComparisonError("Synthetic workspace did not become observed");
  }

  try {
    const { root, hint } = await observedRoot();
    const page = await request({ op: "page", root: root.handle, generation: root.generation, cursor: 0 });
    requireEvidence(page.nodes?.length === rows.length, "Unexpected source roster count");
    const rowByEntry = new Map(rows.map((row) => {
      const path = join(rootPath, `${row.id}.md`);
      const node = page.nodes?.find((candidate) => candidate.kind === "file" && candidate.displayPath === path);
      requireEvidence(node, "Synthetic source not in workspace");
      return [node.handle, row] as const;
    }));
    requireEvidence(rowByEntry.size === rows.length, "Duplicate workspace entries");
    const sourceRoot = await authorizeRoot(rootPath);
    const source: SourceProof = {
      root: sourceRoot, directory: await lstat(rootPath, { bigint: true }),
      files: await Promise.all(rows.map(async ({ id }) => {
        const path = join(rootPath, `${id}.md`);
        const stat = await lstat(path, { bigint: true });
        requireEvidence(stat.isFile() && stat.nlink === 1n, "Synthetic source file is not private");
        return { path, stat };
      })),
      current: hint.current,
    };
    async function candidateReceipt() {
      const ticket = await workspace.captureIndexRows(root.handle, root.generation);
      requireEvidence(ticket.ok && ticket.rows.length === rows.length && await ticket.verify() && ticket.current(),
        "Synthetic authorized roster unavailable");
      const entryByIndexId = new Map<string, string>();
      for (const { id, entry, bytes, raw, hash } of ticket.rows) {
        const expected = rowByEntry.get(entry);
        requireEvidence(expected?.raw === raw && expected.hash === hash && expected.bytes === bytes &&
          !entryByIndexId.has(id), "Synthetic authorized roster differs");
        entryByIndexId.set(id, entry);
      }
      const seeded = await workspace.prepareObservedIndex(root.handle, root.generation);
      requireEvidence(seeded.ok && seeded.generation === 1 && seeded.documents === rows.length, "Cold seed failed");
      const cache = await prepareCandidate(profile, source, ticket.scopeKey, seeded.generation, ticket.rows.map(
        ({ id, raw }) => ({ id, raw })
      ));
      requireEvidence(await ticket.verify() && ticket.current(), "Source ticket changed during seed");
      return { cache, entryByIndexId };
    }
    const setupStarted = performance.now();
    const { cache, entryByIndexId } = await candidateReceipt();
    const setupMs = performance.now() - setupStarted;
    const checkSource = () => { if (!source.current()) throw new SourceChanged(); };
    await proveSourceRoot(source, checkSource);
    const initialFootprint = await inspectAppIndexCacheFootprint(source.current);
    requireEvidence(initialFootprint.ok && initialFootprint.present, "Initial cache footprint unavailable");

    const coverage = rows.map(({ id, hash, bytes }) => ({ id, hash, bytes }));
    const coverageDigest = digest(coverage);
    const cases = queries.map((query, index) => {
      const hits = rows.flatMap(({ id, raw }) => {
        const from = raw.indexOf(query.literal);
        return from < 0 ? [] : [{ id, from, to: from + query.literal.length }];
      });
      requireEvidence(hits.length === [1, rows.length, 0][index] && hits[0]?.from === query.firstFrom,
        "Synthetic literal anchors differ");
      return { query, hits: hits.length, digest: digest(hits) };
    });
    type SearchCase = (typeof cases)[number];
    async function sample(arm: Arm, search: SearchCase) {
      if (arm === "candidate") {
        const result = await queryCandidate(profile, source, cache, entryByIndexId, search.query.literal);
        const hits = result.hits.map(({ entry, from, to }) => {
          const known = rowByEntry.get(entry);
          requireEvidence(known, "Candidate query returned unknown row");
          return { id: known.id, from, to };
        }).sort(byId);
        requireEvidence(hits.length === search.hits && digest(hits) === search.digest, "Candidate differs from oracle");
        return { ms: result.ms, phases: result.phases };
      }
      const start = performance.now();
      const result = await workspace.searchContentCandidates({
        root: root.handle, generation: root.generation, query: search.query.literal, handles: [],
      });
      const ms = performance.now() - start;
      requireEvidence(result.ok && result.mappings.length === 0 && result.coverage.length === rows.length,
        "Direct workspace coverage unavailable");
      const mapped = result.coverage.map(({ entry, hash, bytes, hit, fragments }) => {
        const row = rowByEntry.get(entry);
        requireEvidence(row && fragments === undefined, "Unexpected direct row");
        return { id: row.id, hash, bytes, hit };
      }).sort(byId);
      const hits = mapped.flatMap(({ id, hit }) => hit ? [{ id, ...hit }] : []);
      requireEvidence(digest(mapped.map(({ id, hash, bytes }) => ({ id, hash, bytes }))) === coverageDigest &&
        hits.length === search.hits && digest(hits) === search.digest, "Direct workspace differs from oracle");
      return { ms, phases: undefined };
    }

    for (const arm of arms) await sample(arm, cases[0]);
    const samples = [];
    const byQuery = [];
    const all: Record<Arm, number[]> = { direct: [], candidate: [] };
    for (const search of cases) {
      const values: Record<Arm, number[]> = { direct: [], candidate: [] };
      for (const [block, order] of orders.entries()) {
        const ms = { direct: 0, candidate: 0 };
        let candidatePhases: Awaited<ReturnType<typeof queryCandidate>>["phases"] | undefined;
        for (const arm of order) {
          const measured = await sample(arm, search);
          ms[arm] = measured.ms;
          values[arm].push(measured.ms);
          all[arm].push(measured.ms);
          if (measured.phases) candidatePhases = measured.phases;
        }
        requireEvidence(candidatePhases, "Candidate timing phases missing");
        samples.push({ query: search.query.id, block: block + 1, order, ms, candidatePhases });
      }
      byQuery.push({ query: search.query.id, direct: timing(values.direct), candidate: timing(values.candidate) });
    }

    for (const [index, { path }] of source.files.entries()) {
      const body = await readFile(path);
      requireEvidence(body.length === rows[index].bytes && sha(body) === rows[index].hash, "Synthetic source bytes changed");
    }
    const finalFootprint = await inspectAppIndexCacheFootprint(source.current);
    requireEvidence(JSON.stringify(initialFootprint) === JSON.stringify(finalFootprint), "Cache footprint changed");
    await withLease(profile, async (slot) => {
      const pinned = await pinCache(profile, slot, cache.catalog, checkSource);
      requireEvidence(sameCache(cache, pinned), "Final cache identity or catalog bytes changed");
    });

    let workerCompleted = false;
    const changed = source.files[1];
    const next = rows[1].raw.replace("合成段落", queries[0].literal);
    requireEvidence(!rows[1].raw.includes(queries[0].literal) && next.indexOf(queries[0].literal) === queries[0].firstFrom,
      "Negative fixture must add a previously absent hit");
    async function rejectChanged(hooks: NonNullable<Parameters<typeof queryCandidate>[5]>) {
      try {
        await queryCandidate(profile, source, cache, entryByIndexId, queries[0].literal, hooks);
      } catch (error) {
        requireEvidence(error instanceof SourceChanged, "Candidate failed for a different reason");
        return;
      }
      throw new ComparisonError("Candidate published hits for a changed source");
    }
    await rejectChanged({ afterWorker: async () => {
      workerCompleted = true;
      await writeFile(changed.path, next);
      const then = Number(changed.stat.mtimeNs) / 1e9 + 2;
      await utimes(changed.path, then, then);
    } });
    requireEvidence(workerCompleted && source.current(), "Negative fixture did not keep observation quiet");
    const latest = await lstat(changed.path, { bigint: true });
    requireEvidence(latest.ino === changed.stat.ino && latest.dev === changed.stat.dev && latest.size === changed.stat.size &&
      latest.mtimeNs !== changed.stat.mtimeNs && sha(await readFile(changed.path)) !== rows[1].hash,
    "Negative fixture did not change bytes in place");
    await rejectChanged({ beforeWorker: () => { throw new ComparisonError("Changed source reached a second worker"); } });

    return {
      corpus: corpus.id, documents: rows.length, bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      corpusDigest: digest(coverage.map(({ id, hash, bytes }) => [id, hash, bytes])), coverageDigest,
      results: cases.map(({ query, hits, digest }) => ({ query: query.id, hits, digest })),
      setupMs, samples, byQuery, summary: { direct: timing(all.direct), candidate: timing(all.candidate) },
      storageUnchanged: true, storageEvidence: "metadata-and-catalog-bytes",
      negative: { sameInode: true, sameSize: true, watchQuiet: true, rejectedBeforeNextWorker: true, rejectedAfterWorker: true },
    };
  } finally {
    try { await workspace.dispose(); }
    finally { await documents.dispose(); }
  }
}

async function compare() {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), "f064bl-compare-"));
  const original = await lstat(scratch, { bigint: true });
  const owner = process.getuid?.();
  requireEvidence(owner !== undefined && original.uid === BigInt(owner) && original.isDirectory() &&
    (original.mode & 0o7777n) === 0o700n && await realpath(scratch) === scratch, "Private comparison scratch unavailable");
  const priorHome = process.env.AGENTIC_MARKDOWN_HOME;
  try {
    const results = [];
    for (const corpus of corpora) results.push(await runCorpus(scratch, corpus));
    const latest = await lstat(scratch, { bigint: true });
    requireEvidence(latest.isDirectory() && original.dev === latest.dev && original.ino === latest.ino &&
      original.uid === latest.uid && original.mode === latest.mode && await realpath(scratch) === scratch,
    "Comparison scratch changed before cleanup");
    await rm(scratch, { recursive: true });
    return { version: 1, unit: "ms", corpora: results };
  } finally {
    if (priorHome === undefined) delete process.env.AGENTIC_MARKDOWN_HOME;
    else process.env.AGENTIC_MARKDOWN_HOME = priorHome;
  }
}

try {
  console.info(JSON.stringify(await compare()));
} catch (error) {
  console.error(error instanceof ComparisonError ? error.message : "Index candidate comparison failed");
  process.exitCode = 1;
}
