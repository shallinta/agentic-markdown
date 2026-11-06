import { createHash, randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SearchCoverage } from "../../shared/content-search";
import {
  DocumentPathError,
  verifySingleFileAuthorization,
  type SingleFileAuthorization,
} from "../documents/path-authorization";
import { encodeChanges, INDEX_LIMITS, scalar } from "../index/protocol";
import type { IndexChange, IndexResult } from "../index/protocol";
import { createIndexSession } from "../index/session";

import { authorizeEntry, verifyRoot } from "./authorization";
import type { RootAuthorization } from "./authorization";
import type { ScanFile } from "./scan";

export const SEARCH_SNAPSHOT_ROOT_LIMIT = 16;
export interface SearchSnapshotRoot {
  authorization: RootAuthorization;
  files: ReadonlyMap<string, ScanFile>;
  showHidden: boolean;
}

type Failure = Extract<IndexResult, { ok: false }>;
type EvidenceResult =
  | Failure
  | {
      ok: true;
      coverage: SearchCoverage[];
    };
const fail = (error: Failure["error"], accepted = false): Failure => ({
  ok: false,
  error,
  accepted,
});

// Bound the number of open snapshots and any cache left by an uncertain close.
let busy = false;
let quarantined = false;

export async function readStableSearchBytes(
  grant: SingleFileAuthorization,
  limit: number,
  check: () => void
): Promise<Buffer | null> {
  const before = await verifySingleFileAuthorization(grant, check);
  if (before.size > BigInt(limit)) return null;
  const bytes = Buffer.alloc(Number(before.size) + 1);
  let length = 0;
  while (length < bytes.length) {
    check();
    const { bytesRead } = await grant.file.read(bytes, length, bytes.length - length, length);
    check();
    if (!bytesRead) break;
    length += bytesRead;
  }
  const after = await verifySingleFileAuthorization(grant, check);
  if (
    after.size !== before.size ||
    BigInt(length) !== before.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.ctimeNs !== after.ctimeNs
  ) throw new DocumentPathError("FILE_CHANGED");
  return bytes.subarray(0, length);
}

export async function searchSnapshot(
  authorization: RootAuthorization,
  files: ReadonlyMap<string, ScanFile>,
  showHidden: boolean,
  query: string,
  current: () => boolean
) {
  const result = await searchSnapshotEvidence(authorization, files, showHidden, query, current);
  if (!result.ok) return result;
  return {
    ok: true as const,
    hits: result.coverage.flatMap(({ entry, hit }) => hit ? [{ entry, ...hit }] : []),
  };
}

export function searchSnapshotEvidence(
  authorization: RootAuthorization,
  files: ReadonlyMap<string, ScanFile>,
  showHidden: boolean,
  query: string,
  current: () => boolean
): Promise<EvidenceResult> {
  return searchSnapshotEvidenceAcrossRoots([{ authorization, files, showHidden }], query, current);
}

export async function searchSnapshotEvidenceAcrossRoots(
  roots: readonly SearchSnapshotRoot[],
  query: string,
  current: () => boolean
): Promise<EvidenceResult> {
  if (!scalar(query, INDEX_LIMITS.query)) return fail("INPUT");
  if (quarantined) return fail("UNAVAILABLE");
  if (busy) return fail("BUSY");
  if (!roots.length) return fail("INPUT");
  if (roots.length > SEARCH_SNAPSHOT_ROOT_LIMIT) return fail("LIMIT");
  let candidates = 0;
  const entries = new Set<string>();
  const paths = new Set<string>();
  for (const { files } of roots) {
    candidates += files.size;
    if (candidates > INDEX_LIMITS.documents) return fail("LIMIT");
    for (const [entry, file] of files) {
      if (entries.has(entry) || paths.has(file.path)) return fail("INPUT");
      entries.add(entry);
      paths.add(file.path);
    }
  }
  busy = true;
  let directory: string | undefined;
  let session: ReturnType<typeof createIndexSession> | undefined;
  let result: EvidenceResult = fail("UNAVAILABLE");
  const check = () => {
    if (!current()) throw Error("CANCELLED");
  };
  async function verifyRoots() {
    for (const { authorization } of roots) {
      check();
      await verifyRoot(authorization, check);
    }
    check();
  }
  try {
    result = await run();
  } catch {
    result = fail(current() ? "UNAVAILABLE" : "CANCELLED");
  } finally {
    try {
      const closed = await session?.close();
      if (closed && !closed.ok && closed.error !== "UNAVAILABLE") {
        quarantined = true;
        result = fail("UNKNOWN", true);
      } else if (directory) {
        await rm(directory, { recursive: true, force: true });
      }
    } catch {
      quarantined = true;
      result = fail("UNKNOWN", true);
    } finally {
      try {
        // Every root remains required through cleanup, including empty roots.
        if (result.ok && roots.length > 1) await verifyRoots();
      } catch {
        result = fail(current() ? "UNAVAILABLE" : "CANCELLED");
      } finally {
        busy = false;
      }
    }
  }
  return !current() && result.ok ? fail("CANCELLED") : result;

  async function run(): Promise<EvidenceResult> {
    await verifyRoots();
    const changes: IndexChange[] = [];
    const indexed = new Map<string, { evidence: SearchCoverage; length: number }>();
    let remaining: number = INDEX_LIMITS.bytes;
    for (const { authorization, files, showHidden } of roots) {
      for (const [entry, file] of files) {
        check();
        const grant = await authorizeEntry(
          authorization,
          file.path,
          file.fingerprint,
          file.chain,
          showHidden,
          check
        );
        try {
          const contents = await readStableSearchBytes(grant, remaining, check);
          if (!contents) return fail("LIMIT");
          const raw = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(contents);
          const id = randomUUID().replaceAll("-", "");
          const evidence = { entry, bytes: contents.length, hash: createHash("sha256").update(contents).digest("hex") };
          indexed.set(id, { evidence, length: raw.length });
          changes.push({ kind: "put", id, path: id, raw });
          remaining -= contents.length;
        } finally {
          await grant.file.close();
        }
      }
    }
    check();
    if (!changes.length) return { ok: true, coverage: [] };
    try {
      encodeChanges(changes);
    } catch {
      return fail("LIMIT");
    }
    const slot = join(tmpdir(), "agentic-markdown-workspace-index-v1");
    await mkdir(slot, { mode: 0o700 });
    directory = slot;
    check();
    session = createIndexSession();
    const opened = await session.open(join(directory, "index"), "create-new");
    if (!opened.ok) return opened;
    await verifyRoots();
    const applied = await session.applyAndCommit(changes);
    if (!applied.ok) return applied;
    check();
    const queried = await session.query(query);
    if (!queried.ok) return queried;
    check();
    if (roots.length === 1) await verifyRoots();
    for (const { id, from, to } of queried.hits ?? []) {
      const row = indexed.get(id);
      if (!row || row.evidence.hit || to > row.length || to - from !== query.length)
        return fail("UNKNOWN", true);
      row.evidence.hit = { from, to };
    }
    return { ok: true, coverage: [...indexed.values()].map(({ evidence }) => evidence) };
  }
}
