import { randomUUID } from "node:crypto";
import { dirname, extname, join, relative } from "node:path";

import type { WorkspaceNode } from "../../shared/workspace";

import {
  verifyRoot,
  visiblePath,
  type RootAuthorization,
} from "./authorization";
import type { ScanFile } from "./scan";
import { validScanBatch } from "./scan-protocol";
import type { createScanWorker } from "./worker";

export interface ReconciliationRoot {
  lifetime: object;
  handle: string;
  generation: number;
  showHidden: boolean;
  authorization: RootAuthorization;
  nodes: readonly WorkspaceNode[];
  files: ReadonlyMap<string, ScanFile>;
}
export interface ReconciliationSummary {
  token: string;
  root: string;
  generation: number;
  added: number;
  removed: number;
  replaced: number;
  retainedHandles: string[];
}
export type ReconciliationResult =
  | { ok: true; summary: ReconciliationSummary }
  | {
      ok: false;
      reason: "NOT_READY" | "BUSY" | "INVALIDATED" | "FAILED" | "BUDGET";
    };
interface Proof {
  kind: "directory" | "file";
  identity: string;
  handle?: string;
}
type RootBinding = Omit<ReconciliationRoot, "nodes" | "files">;
interface Job {
  root: RootBinding;
  token: string;
  key: string;
  baseline: Map<string, Proof>;
  candidate: Map<string, Proof>;
  bytes: number;
  started: boolean;
  close: boolean;
  result?: ReconciliationResult;
  promise: Promise<ReconciliationResult>;
  resolve: (result: ReconciliationResult) => void;
}
const copy = (result: ReconciliationResult): ReconciliationResult =>
  result.ok
    ? {
        ok: true,
        summary: {
          ...result.summary,
          retainedHandles: [...result.summary.retainedHandles],
        },
      }
    : { ...result };

/** Full contiguous chains, including conflicting directory proofs, are mandatory. */
function addProofs(
  map: Map<string, Proof>,
  root: RootBinding,
  file: ScanFile,
  reserve: (bytes: number) => void
) {
  if (
    !visiblePath(root.authorization.path, file.path, root.showHidden) ||
    ![".md", ".markdown"].includes(extname(file.path).toLowerCase()) ||
    file.path === root.authorization.path
  )
    throw Error("invalid candidate path");
  const parts = relative(root.authorization.path, dirname(file.path))
    .split("/")
    .filter(Boolean);
  if (parts.length !== file.chain.length) throw Error("incomplete chain");
  let path = root.authorization.path;
  const chain = root.authorization.directories.map((item) => [
    item.path,
    item.fingerprint,
  ]);
  const add = (path: string, proof: Proof) => {
    const previous = map.get(path);
    if (previous) {
      if (previous.kind !== proof.kind || previous.identity !== proof.identity)
        throw Error("conflicting identity");
      return;
    }
    // Conservative owned metadata charge, not an RSS measurement.
    reserve(2 * Buffer.byteLength(JSON.stringify([path, proof])) + 256);
    map.set(path, proof);
  };
  for (let i = 0; i < parts.length; i++) {
    path = join(path, parts[i]);
    const entry = file.chain[i];
    if (entry.path !== path) throw Error("discontinuous chain");
    chain.push([entry.path, entry.fingerprint]);
    add(path, { kind: "directory", identity: JSON.stringify(chain) });
  }
  add(file.path, {
    kind: "file",
    identity: JSON.stringify([...chain, [file.path, file.fingerprint]]),
  });
}

/** Trusted internal candidates only. All Worker calls are made by the owner's drain. */
export function createReconciliation({
  getRoot,
  usedBytes,
  limit,
  worker,
  wake,
}: {
  getRoot: (handle: string) => ReconciliationRoot | undefined;
  usedBytes: () => number;
  limit: number;
  worker: ReturnType<typeof createScanWorker>;
  wake: () => void;
}) {
  let job: Job | undefined;
  let disposed = false;
  const binding = (value: Job) => {
    const root = getRoot(value.root.handle);
    return (
      !disposed &&
      root?.lifetime === value.root.lifetime &&
      root.generation === value.root.generation &&
      root.showHidden === value.root.showHidden &&
      usedBytes() + value.bytes <= limit
    );
  };
  const fail = (
    value: Job,
    reason: Extract<ReconciliationResult, { ok: false }>["reason"]
  ) => {
    value.result = { ok: false, reason };
    value.baseline.clear();
    value.candidate.clear();
    value.bytes = 0;
    value.close = true;
  };
  const reserve = (value: Job, bytes: number) => {
    if (usedBytes() + value.bytes + bytes > limit) throw Error("budget");
    value.bytes += bytes;
  };
  return {
    prepare(handle: string): Promise<ReconciliationResult> {
      if (disposed)
        return Promise.resolve({ ok: false, reason: "INVALIDATED" });
      if (job && !binding(job)) {
        fail(job, "INVALIDATED");
        wake();
      }
      if (job)
        return job.root.handle === handle && !job.close
          ? job.promise.then(copy)
          : Promise.resolve({ ok: false, reason: "BUSY" });
      const root = getRoot(handle);
      if (!root) return Promise.resolve({ ok: false, reason: "NOT_READY" });
      const deferred = Promise.withResolvers<ReconciliationResult>();
      const value: Job = {
        root: {
          lifetime: root.lifetime,
          handle: root.handle,
          generation: root.generation,
          showHidden: root.showHidden,
          authorization: root.authorization,
        },
        token: randomUUID(),
        key: `${randomUUID()}:1`,
        baseline: new Map(),
        candidate: new Map(),
        bytes: 0,
        started: false,
        close: false,
        promise: deferred.promise,
        resolve: deferred.resolve,
      };
      try {
        reserve(
          value,
          512 + Buffer.byteLength(JSON.stringify(root.authorization))
        );
        for (const file of root.files.values())
          addProofs(value.baseline, root, file, (bytes) =>
            reserve(value, bytes)
          );
        if (root.nodes.length !== value.baseline.size)
          throw Error("incomplete baseline");
        for (const node of root.nodes) {
          const proof = value.baseline.get(node.displayPath);
          if (proof?.kind !== node.kind) throw Error("invalid baseline");
          reserve(value, node.handle.length * 2 + 32);
          proof.handle = node.handle;
        }
      } catch (error) {
        return Promise.resolve({
          ok: false,
          reason:
            error instanceof Error && error.message === "budget"
              ? "BUDGET"
              : "FAILED",
        });
      }
      job = value;
      wake();
      return value.promise.then(copy);
    },
    get(token: string): ReconciliationResult | undefined {
      if (job?.token !== token) return undefined;
      if (!binding(job)) {
        fail(job, "INVALIDATED");
        wake();
        return undefined;
      }
      return job.result?.ok ? copy(job.result) : undefined;
    },
    release(token: string) {
      if (job?.token === token) {
        fail(job, "INVALIDATED");
        wake();
      }
    },
    invalidate(handle?: string) {
      if (job && (!handle || job.root.handle === handle)) {
        fail(job, "INVALIDATED");
        wake();
      }
    },
    bytes: () => job?.bytes ?? 0,
    hasWork: () => !!job && (!job.result || job.close),
    async step() {
      const value = job;
      if (!value) return;
      if (!binding(value)) fail(value, "INVALIDATED");
      if (value.close) {
        if (value.started)
          await worker
            .call({ op: "close", key: value.key })
            .catch(() => undefined);
        value.resolve(
          copy(value.result ?? { ok: false, reason: "INVALIDATED" })
        );
        if (job === value) job = undefined;
        return;
      }
      if (value.result) return;
      try {
        if (!value.started) {
          value.started = true;
          await worker.call({
            op: "start",
            key: value.key,
            root: value.root.authorization,
            showHidden: value.root.showHidden,
          });
          return;
        }
        const batch = await worker.call({ op: "next", key: value.key });
        if (!binding(value) || value.close) {
          fail(value, "INVALIDATED");
          return;
        }
        if (!validScanBatch(batch) || batch.errors || batch.paused) {
          fail(value, "FAILED");
          return;
        }
        for (const file of batch.files)
          addProofs(value.candidate, value.root, file, (bytes) =>
            reserve(value, bytes)
          );
        if (!batch.done) return;
        await verifyRoot(value.root.authorization);
        if (!binding(value) || value.close) {
          fail(value, "INVALIDATED");
          return;
        }
        const summary: ReconciliationSummary = {
          token: value.token,
          root: value.root.handle,
          generation: value.root.generation,
          added: 0,
          removed: 0,
          replaced: 0,
          retainedHandles: [],
        };
        for (const [path, proof] of value.candidate) {
          const previous = value.baseline.get(path);
          if (!previous) summary.added++;
          else if (
            previous.kind === proof.kind &&
            previous.identity === proof.identity
          )
            summary.retainedHandles.push(previous.handle!);
          else summary.replaced++;
        }
        for (const path of value.baseline.keys())
          if (!value.candidate.has(path)) summary.removed++;
        reserve(value, 2 * Buffer.byteLength(JSON.stringify(summary)) + 256);
        await worker.call({ op: "close", key: value.key });
        value.started = false;
        if (!binding(value) || value.close) {
          fail(value, "INVALIDATED");
          return;
        }
        value.result = { ok: true, summary };
        value.resolve(copy(value.result));
      } catch (error) {
        fail(
          value,
          error instanceof Error && error.message === "budget"
            ? "BUDGET"
            : "FAILED"
        );
      }
    },
    dispose() {
      disposed = true;
      if (job) {
        fail(job, "INVALIDATED");
        wake();
      }
    },
  };
}
