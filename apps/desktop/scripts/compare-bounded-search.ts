import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IndexHit, IndexResult } from "../src/bun/index/protocol";
import { searchWithIndexReuse } from "../src/bun/index/reuse";
import { acquireIndexReuseSlot, IndexReuseCleanupError } from "../src/bun/index/reuse-catalog";
import { createIndexSession } from "../src/bun/index/session";

const armNames = ["cold", "warm", "direct"] as const;
type Arm = (typeof armNames)[number];
const queries = [
  { id: "q01", literal: "授权正文", hitCount: 8 },
  { id: "q02", literal: "🧭 route-42", hitCount: 6 },
  { id: "q03", literal: "未写入🚫", hitCount: 0 },
] as const;
type Query = (typeof queries)[number];
const rowBytes = 4096;
const rows = Array.from({ length: 16 }, (_, index) => {
  const label = String(index + 1).padStart(2, "0");
  const id = `doc-${label}`;
  const heading = `\uFEFF第${label}篇\r\n`;
  const first = index % 2 === 0 ? queries[0].literal : "无关键词";
  const second = index % 3 === 0 ? queries[1].literal : "plain route";
  const prefix = `${heading}${first}\r\n${second}\r\n# 合成片段 📄\n${first}\n${second}\n`;
  const filler = `para-${label} The quick brown fox 0123456789.\n`;
  const remaining = rowBytes - Buffer.byteLength(prefix);
  return { id, raw: prefix + filler.repeat(Math.ceil(remaining / filler.length)).slice(0, remaining) };
});

interface Evidence {
  hashes: readonly { id: string; hash: string }[];
  hits: readonly IndexHit[];
}

class ComparisonError extends Error {}
function requireEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ComparisonError(message);
}

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const hashRows = () => rows.map(({ id, raw }) => ({ id, hash: sha(raw) }));
function findHits(query: Query): IndexHit[] {
  return rows.flatMap(({ id, raw }) => {
    const from = raw.indexOf(query.literal);
    return from < 0 ? [] : [{ id, from, to: from + query.literal.length }];
  });
}
function direct(query: Query): Evidence {
  return { hashes: hashRows(), hits: findHits(query) };
}
function requireGeneration(
  result: IndexResult,
  expected: number,
  step: string
): asserts result is Extract<IndexResult, { ok: true }> {
  requireEvidence(result.ok, `${step}: ${result.ok ? "" : result.error}`);
  requireEvidence(result.generation === expected, `${step}: unexpected generation`);
}

async function compare() {
  requireEvidence(rows.length === 16 && rows.every(({ raw }) => Buffer.byteLength(raw) === rowBytes),
    "Unexpected synthetic corpus size");
  const cases = queries.map((query) => ({ query, evidence: direct(query) }));
  const first = cases[0];
  const second = cases[1];
  requireEvidence(first && second &&
    cases.every(({ query, evidence }) => evidence.hits.length === query.hitCount) &&
    first.evidence.hits[0]?.from === 7 && second.evidence.hits[0]?.from === 13,
    "Unexpected synthetic literal anchors");
  const corpusDigest = sha(JSON.stringify(first.evidence.hashes));
  const root = await realpath(await mkdtemp(join(tmpdir(), "f064q-compare-")));
  const warmSlot = join(root, "warm");
  let retainFixture = false;
  try {
    await mkdir(warmSlot, { mode: 0o700 });
    const seeded = await searchWithIndexReuse(warmSlot, {
      scopeKey: corpusDigest, rows, query: first.query.literal,
    }, () => true);
    if (!seeded.ok && seeded.error === "UNKNOWN") retainFixture = true;
    requireEvidence(seeded.ok && seeded.generation === 1 && seeded.applied === rows.length,
      "Warm fixture did not build exactly once");
    const hashes = await warmHashes();
    checkEvidence({ hashes, hits: seeded.hits }, first.evidence, "seed");

    for (const arm of armNames) await sample(arm, first.query, first.evidence, hashes);
    const rounds = [];
    const timings: Record<Arm, number[]> = { cold: [], warm: [], direct: [] };
    for (const { query, evidence } of cases) {
      for (const rotation of armNames.keys()) {
        const order = [...armNames.slice(rotation), ...armNames.slice(0, rotation)];
        const samples = [];
        for (const arm of order) {
          const ms = await sample(arm, query, evidence, hashes);
          samples.push({ arm, ms });
          timings[arm].push(ms);
        }
        rounds.push({ round: rounds.length + 1, query: query.id, samples });
      }
    }
    checkEvidence({ hashes: await warmHashes(), hits: [] }, { hashes, hits: [] }, "warm catalog after rounds");
    requireEvidence((await readdir(root)).join(",") === "warm", "Temporary index cleanup incomplete");
    return {
      schema: 1,
      corpus: { rows: rows.length, bytes: rows.length * rowBytes, sha256: corpusDigest },
      queries: cases.map(({ query, evidence }) => ({
        id: query.id, hitCount: query.hitCount, evidenceSha256: sha(JSON.stringify(evidence)),
      })),
      warmupsPerArm: 1,
      rounds,
      summaryMs: Object.fromEntries(armNames.map((arm) => {
        const sorted = [...timings[arm]].sort((left, right) => left - right);
        return [arm, { min: sorted[0], median: sorted[4], max: sorted[8] }];
      })),
    };
  } finally {
    if (!retainFixture) await rm(root, { recursive: true });
  }

  async function warmHashes() {
    const acquired = await acquireIndexReuseSlot(warmSlot);
    if (!acquired.ok && acquired.error === "UNKNOWN") retainFixture = true;
    requireEvidence(acquired.ok, "Warm catalog lease unavailable");
    const { slot } = acquired;
    try {
      const result = await slot.readCatalog();
      requireEvidence(result.status === "existing" && result.catalog.scopeKey === corpusDigest &&
        result.catalog.generation === 1, "Warm catalog identity mismatch");
      return result.catalog.entries;
    } catch (error) {
      if (error instanceof IndexReuseCleanupError) retainFixture = true;
      throw error;
    } finally {
      await slot.release().catch(() => {
        retainFixture = true;
        throw new ComparisonError("Warm catalog lease release unconfirmed");
      });
    }
  }

  async function sample(arm: Arm, query: Query, expected: Evidence, hashes: Evidence["hashes"]) {
    const started = performance.now();
    const evidence = arm === "direct" ? direct(query)
      : arm === "cold" ? await cold(query)
        : await warm(query, hashes);
    const elapsed = performance.now() - started;
    checkEvidence(evidence, expected, `${arm}/${query.id}`);
    return elapsed;
  }

  async function cold(query: Query): Promise<Evidence> {
    const hashes = hashRows();
    const directory = await mkdtemp(join(root, "cold-"));
    const session = createIndexSession();
    let generation = 0;
    try {
      requireGeneration(await session.open(join(directory, "index"), "create-new"), 0, "cold open");
      const applied = await session.applyAndCommit(rows.map(({ id, raw }) => ({
        kind: "put", id, path: id, raw,
      })));
      if (applied.ok) generation = applied.generation;
      requireGeneration(applied, 1, "cold apply");
      const result = await session.query(query.literal);
      requireGeneration(result, generation, "cold query");
      requireEvidence(result.hits, "Cold query omitted hits");
      return { hashes, hits: result.hits };
    } finally {
      await session.close().then((result) => requireGeneration(result, generation, "cold close"))
        .catch((error: unknown) => {
          retainFixture = true;
          throw error;
        });
      await rm(directory, { recursive: true });
    }
  }

  async function warm(query: Query, hashes: Evidence["hashes"]): Promise<Evidence> {
    const result = await searchWithIndexReuse(warmSlot, {
      scopeKey: corpusDigest, rows, query: query.literal,
    }, () => true);
    if (!result.ok && result.error === "UNKNOWN") retainFixture = true;
    requireEvidence(result.ok && result.generation === 1 && result.applied === 0,
      "Warm sample did not reuse the unchanged index");
    // The warm coordinator hashes every current row against this catalog.
    return { hashes, hits: result.hits };
  }
}

function checkEvidence(actual: Evidence, expected: Evidence, step: string) {
  requireEvidence(JSON.stringify(actual.hashes) === JSON.stringify(expected.hashes) &&
    JSON.stringify(actual.hits) === JSON.stringify(expected.hits),
    `${step}: evidence differs`);
}

if (import.meta.main) {
  try {
    console.info(JSON.stringify(await compare(), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof ComparisonError ? error.message : "Bounded comparison failed",
    }));
    process.exitCode = 1;
  }
}
