import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../src/bun/documents";
import { inspectAppIndexCacheFootprint, searchAppIndexCache } from "../src/bun/index/app-cache";
import { createWorkspaceService } from "../src/bun/workspace";
import type { WorkspaceRequest } from "../src/shared/workspace";

const arms = ["direct", "indexed"] as const;
type Arm = (typeof arms)[number];
const orders = [arms, ["indexed", "direct"], arms, ["indexed", "direct"]] as const;
const queries = [
  { id: "q01", literal: "授权正文", firstFrom: 10 },
  { id: "q02", literal: "🧭 route-42", firstFrom: 16 },
  { id: "q03", literal: "未写入🚫", firstFrom: undefined },
] as const;
const profiles = [
  { id: "tiny", documents: 2, fileBytes: undefined, hits: [1, 1, 0] },
  { id: "bounded", documents: 16, fileBytes: 4096, hits: [8, 5, 0] },
] as const;
type Profile = (typeof profiles)[number];

interface Hit { entry: string; from: number; to: number }
class ComparisonError extends Error {}
function requireEvidence(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ComparisonError(message);
}

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => sha(JSON.stringify(value));
function fixtureRows(profile: Profile) {
  return Array.from({ length: profile.documents }, (_, index) => {
    const id = `doc-${String(index + 1).padStart(2, "0")}`;
    const cjk = index % 2 === 0 ? queries[0].literal : "无关键词";
    const emoji = index % 3 === 1 ? queries[1].literal : "plain route";
    const prefix = `\uFEFF第${id.slice(-2)}篇 📄\r\n${cjk}\r\n${emoji}\r\n# 合成片段\n${cjk}\n${emoji}\n`;
    const filler = `para-${id} The quick brown fox 0123456789.\n`;
    const remaining = profile.fileBytes === undefined ? 0 : profile.fileBytes - Buffer.byteLength(prefix);
    const raw = prefix + filler.repeat(Math.ceil(remaining / filler.length)).slice(0, remaining);
    return { id, raw, bytes: Buffer.byteLength(raw), hash: sha(raw) };
  });
}

async function footprint() {
  const result = await inspectAppIndexCacheFootprint(() => true);
  requireEvidence(result.ok && result.present && result.totalBytes > 0, "Cache footprint unavailable");
  const { files, catalogBytes, indexBytes, totalBytes } = result;
  return { files, catalogBytes, indexBytes, totalBytes };
}

async function storage(home: string, files: number) {
  const profile = join(home, "search-index", "limited-v1");
  const index = join(profile, "index");
  requireEvidence(JSON.stringify((await readdir(profile)).sort()) === '["catalog.json","index"]',
    "Unexpected cache members or outstanding lease");
  const names = (await readdir(index)).sort();
  requireEvidence(names.length + 1 === files && names.length <= 128, "Unexpected native index inventory");
  return Promise.all([join(profile, "catalog.json"), ...names.map((name) => join(index, name))].map(async (path) => {
    const before = await lstat(path, { bigint: true });
    requireEvidence(before.isFile() && before.nlink === 1n, "Unexpected cache file type");
    const body = await readFile(path);
    const after = await lstat(path, { bigint: true });
    const stamp = (stat: typeof before) =>
      [stat.dev, stat.ino, stat.uid, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join("/");
    requireEvidence(stamp(before) === stamp(after) && BigInt(body.length) === after.size, "Cache file changed during audit");
    return { name: path.slice(profile.length + 1), metadata: stamp(after), hash: sha(body) };
  }));
}

function timing(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted[sorted.length - 1],
  };
}

async function runProfile(scratch: string, profile: Profile) {
  const base = join(scratch, profile.id);
  const home = join(base, "app");
  const rootPath = join(base, "root");
  await mkdir(base, { mode: 0o700 });
  await mkdir(home, { mode: 0o700 });
  await mkdir(rootPath, { mode: 0o700 });
  requireEvidence(await realpath(home) === home && await realpath(rootPath) === rootPath,
    "Invalid isolated fixture directories");
  process.env.AGENTIC_MARKDOWN_HOME = home;
  const rows = fixtureRows(profile);
  requireEvidence(rows.length === profile.documents &&
    rows.every(({ bytes }) => bytes > 0 && (profile.fileBytes === undefined || bytes === profile.fileBytes)),
    "Unexpected synthetic corpus size");
  await Promise.all(rows.map(({ id, raw }) => writeFile(join(rootPath, `${id}.md`), raw, { flag: "wx", mode: 0o600 })));

  const documents = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const workspace = createWorkspaceService({
    documents, pickDirectory: () => Promise.resolve(rootPath), contentSearchStrategy: "direct",
  });
  async function request(input: Omit<WorkspaceRequest, "protocolVersion" | "requestId">) {
    const result = await workspace.request({ protocolVersion: 1, requestId: crypto.randomUUID(), ...input });
    requireEvidence(result.ok, "Synthetic workspace request failed");
    return result;
  }
  async function scan() {
    await request({ op: "select" });
    for (let attempt = 0; attempt < 1000; attempt++) {
      const root = (await request({ op: "state" })).roots.find(({ displayPath }) => displayPath === rootPath);
      if (root?.status === "complete") return root;
      requireEvidence(!root || root.status === "scanning", "Synthetic workspace scan incomplete");
      await Bun.sleep(2);
    }
    throw new ComparisonError("Synthetic workspace scan did not finish");
  }

  try {
    const root = await scan();
    const page = await request({ op: "page", root: root.handle, generation: root.generation, cursor: 0 });
    requireEvidence(page.nodes?.length === rows.length, "Unexpected scan entry count");
    const knownRows = rows.map((row) => {
      const path = join(rootPath, `${row.id}.md`);
      const file = page.nodes?.find((node) => node.kind === "file" && node.displayPath === path);
      requireEvidence(file, "Synthetic scan entry missing");
      return { ...row, entry: file.handle };
    });
    const rowByEntry = new Map(knownRows.map((row) => [row.entry, row]));
    requireEvidence(rowByEntry.size === rows.length, "Duplicate scan entry");
    const cases = queries.map((query, index) => {
      const hits = knownRows.flatMap(({ entry, raw }) => {
        const from = raw.indexOf(query.literal);
        return from < 0 ? [] : [{ entry, from, to: from + query.literal.length }];
      });
      requireEvidence(hits.length === profile.hits[index] && hits[0]?.from === query.firstFrom,
        "Unexpected synthetic literal anchors");
      return { query, hits };
    });
    type SearchCase = (typeof cases)[number];
    function normalize(hits: readonly Hit[]) {
      return hits.map(({ entry, from, to }) => {
        const row = rowByEntry.get(entry);
        requireEvidence(row, "Query returned an unknown scan entry");
        return { id: row.id, from, to };
      }).sort((a, b) => a.id.localeCompare(b.id));
    }
    function checkHits(actual: readonly Hit[], expected: readonly Hit[]) {
      requireEvidence(JSON.stringify(normalize(actual)) === JSON.stringify(normalize(expected)),
        "First-hit ranges differ from the synthetic oracle");
    }

    const ticket = await workspace.captureIndexRows(root.handle, root.generation);
    requireEvidence(ticket.ok && ticket.rows.length === rows.length && await ticket.verify() && ticket.current(),
      "Synthetic authorized index seed unavailable");
    const entryByIndexId = new Map<string, string>();
    for (const { id, entry, bytes, raw, hash } of ticket.rows) {
      const row = rowByEntry.get(entry);
      requireEvidence(row?.raw === raw && row.hash === hash && row.bytes === bytes && !entryByIndexId.has(id),
        "Synthetic seed rows differ from the oracle");
      entryByIndexId.set(id, entry);
    }
    const first = cases[0];
    const seeded = await searchAppIndexCache({
      scopeKey: ticket.scopeKey, rows: ticket.rows.map(({ id, raw }) => ({ id, raw })),
      query: first.query.literal,
    }, ticket.current);
    requireEvidence(seeded.ok && seeded.generation === 1 && seeded.applied === rows.length &&
      await ticket.verify() && ticket.current(), "Private index did not cold-build exactly once");
    checkHits(seeded.hits.map(({ id, from, to }) => {
      const entry = entryByIndexId.get(id);
      requireEvidence(entry, "Private seed returned an unknown entry");
      return { entry, from, to };
    }), first.hits);
    const beforeFootprint = await footprint();
    const beforeStorage = await storage(home, beforeFootprint.files);

    async function sample(arm: Arm, { query, hits }: SearchCase) {
      const start = performance.now();
      if (arm === "direct") {
        const result = await workspace.searchContentCandidates({
          root: root.handle, generation: root.generation, query: query.literal, handles: [],
        });
        const ms = performance.now() - start;
        if (!result.ok) throw new ComparisonError(`Direct query failed: ${result.error}`);
        requireEvidence(result.coverage.length === rows.length && result.mappings.length === 0,
          "Direct coverage or mapping count differs");
        const seen = new Set<string>();
        const actual = result.coverage.flatMap(({ entry, bytes, hash, hit, fragments }) => {
          const row = rowByEntry.get(entry);
          requireEvidence(row?.hash === hash && row.bytes === bytes && !seen.has(entry) && fragments === undefined,
            "Direct coverage differs from the synthetic oracle");
          seen.add(entry);
          return hit ? [{ entry, ...hit }] : [];
        });
        checkHits(actual, hits);
        return ms;
      }
      const result = await workspace.searchExistingIndex(root.handle, root.generation, query.literal);
      const ms = performance.now() - start;
      if (!result.ok) throw new ComparisonError(`Indexed query failed: ${result.error}`);
      checkHits(result.hits, hits);
      return ms;
    }

    for (const arm of arms) await sample(arm, first);
    const samples = [];
    const all: Record<Arm, number[]> = { direct: [], indexed: [] };
    const byQuery = [];
    for (const searchCase of cases) {
      const timings: Record<Arm, number[]> = { direct: [], indexed: [] };
      for (const [block, order] of orders.entries()) {
        const times: Record<Arm, number> = { direct: 0, indexed: 0 };
        for (const arm of order) {
          const ms = await sample(arm, searchCase);
          times[arm] = ms;
          timings[arm].push(ms);
          all[arm].push(ms);
        }
        samples.push({ query: searchCase.query.id, block: block + 1, order, ms: times });
      }
      byQuery.push({ query: searchCase.query.id, direct: timing(timings.direct), indexed: timing(timings.indexed) });
    }

    const afterFootprint = await footprint();
    const afterStorage = await storage(home, afterFootprint.files);
    requireEvidence(JSON.stringify(beforeFootprint) === JSON.stringify(afterFootprint) &&
      JSON.stringify(beforeStorage) === JSON.stringify(afterStorage), "Read-only comparison changed cache files");
    for (const { id, bytes, hash } of rows) {
      const contents = await readFile(join(rootPath, `${id}.md`));
      requireEvidence(contents.length === bytes && sha(contents) === hash, "Synthetic source bytes changed");
    }
    return {
      corpus: profile.id,
      documents: rows.length,
      bytes: rows.reduce((sum, row) => sum + row.bytes, 0),
      corpusDigest: digest(rows.map(({ id, hash, bytes }) => ({ id, hash, bytes }))),
      results: cases.map(({ query, hits }) => ({ query: query.id, hits: hits.length, digest: digest(normalize(hits)) })),
      cache: afterFootprint,
      storageUnchanged: true,
      samples,
      byQuery,
      summary: { direct: timing(all.direct), indexed: timing(all.indexed) },
    };
  } finally {
    try { await workspace.dispose(); }
    finally { await documents.dispose(); }
  }
}

async function compare() {
  const scratch = await mkdtemp(join(await realpath(tmpdir()), "f064ak-compare-"));
  const original = await lstat(scratch, { bigint: true });
  const owner = process.getuid?.();
  requireEvidence(owner !== undefined && original.uid === BigInt(owner) && original.isDirectory() &&
    (original.mode & 0o7777n) === 0o700n && await realpath(scratch) === scratch,
    "Could not establish private comparison scratch");
  const priorHome = process.env.AGENTIC_MARKDOWN_HOME;
  try {
    const corpora = [];
    for (const profile of profiles) corpora.push(await runProfile(scratch, profile));
    const latest = await lstat(scratch, { bigint: true });
    requireEvidence(latest.isDirectory() && original.ino === latest.ino && original.dev === latest.dev &&
      original.uid === latest.uid && original.mode === latest.mode && await realpath(scratch) === scratch,
    "Comparison scratch changed before cleanup");
    await rm(scratch, { recursive: true });
    return { version: 1, unit: "ms", corpora };
  } finally {
    if (priorHome === undefined) delete process.env.AGENTIC_MARKDOWN_HOME;
    else process.env.AGENTIC_MARKDOWN_HOME = priorHome;
  }
}

try {
  console.info(JSON.stringify(await compare()));
} catch (error) {
  // Retain isolated evidence on failure, and never print filesystem paths or document text.
  console.error(error instanceof ComparisonError ? error.message : "Authorized search comparison failed");
  process.exitCode = 1;
}
