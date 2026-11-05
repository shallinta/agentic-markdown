import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifySingleFileAuthorization } from "../documents/path-authorization";
import { encodeChanges, INDEX_LIMITS, scalar } from "../index/protocol";
import type { IndexChange, IndexResult } from "../index/protocol";
import { createIndexSession } from "../index/session";

import { authorizeEntry, verifyRoot } from "./authorization";
import type { RootAuthorization } from "./authorization";
import type { ScanFile } from "./scan";

type Failure = Extract<IndexResult, { ok: false }>;
type Result =
  | Failure
  | {
      ok: true;
      hits: { entry: string; from: number; to: number }[];
    };
const fail = (error: Failure["error"], accepted = false): Failure => ({
  ok: false,
  error,
  accepted,
});

// Bound the number of open snapshots and any cache left by an uncertain close.
let busy = false;
let quarantined = false;

export async function searchSnapshot(
  authorization: RootAuthorization,
  files: ReadonlyMap<string, ScanFile>,
  showHidden: boolean,
  query: string,
  current: () => boolean
): Promise<Result> {
  if (!scalar(query, INDEX_LIMITS.query)) return fail("INPUT");
  if (quarantined) return fail("UNAVAILABLE");
  if (busy) return fail("BUSY");
  if (files.size > INDEX_LIMITS.documents) return fail("LIMIT");
  busy = true;
  let directory: string | undefined;
  let session: ReturnType<typeof createIndexSession> | undefined;
  let result: Result;
  const check = () => {
    if (!current()) throw Error("CANCELLED");
  };
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
      busy = false;
    }
  }
  return !current() && result.ok ? fail("CANCELLED") : result;

  async function run(): Promise<Result> {
    check();
    await verifyRoot(authorization, check);
    const changes: IndexChange[] = [];
    const handles = new Map<string, string>();
    let remaining: number = INDEX_LIMITS.bytes;
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
        const before = await verifySingleFileAuthorization(grant, check);
        if (before.size > BigInt(remaining)) return fail("LIMIT");
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let length = 0;
        while (length < bytes.length) {
          check();
          const { bytesRead } = await grant.file.read(
            bytes,
            length,
            bytes.length - length,
            length
          );
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
        )
          return fail("UNAVAILABLE");
        const raw = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes.subarray(0, length));
        const id = randomUUID().replaceAll("-", "");
        handles.set(id, entry);
        changes.push({ kind: "put", id, path: id, raw });
        remaining -= length;
      } finally {
        await grant.file.close();
      }
    }
    check();
    if (!changes.length) return { ok: true, hits: [] };
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
    check();
    await verifyRoot(authorization, check);
    const applied = await session.applyAndCommit(changes);
    if (!applied.ok) return applied;
    check();
    const queried = await session.query(query);
    if (!queried.ok) return queried;
    check();
    await verifyRoot(authorization, check);
    const hits = [];
    for (const { id, from, to } of queried.hits ?? []) {
      const entry = handles.get(id);
      if (!entry) return fail("UNKNOWN", true);
      hits.push({ entry, from, to });
    }
    return { ok: true, hits };
  }
}
