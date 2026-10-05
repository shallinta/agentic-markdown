import { randomUUID } from "node:crypto";
import { basename, dirname, extname, join, relative } from "node:path";

import type { WorkspaceNode } from "../../shared/workspace";

import {
  verifyRoot,
  visiblePath,
  type RootAuthorization,
} from "./authorization";
import {
  createDirectoryAcceptanceLedger,
  type DirectoryOperation,
  type DirectoryAcceptanceResult,
} from "./directory-acceptance";
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
export type RootBinding = Omit<ReconciliationRoot, "nodes" | "files">;
export interface DirectoryPublication {
  nodes: WorkspaceNode[];
  byPath: Map<string, WorkspaceNode>;
  files: Map<string, ScanFile>;
  bytes: number;
  generation: number;
  examined: number;
}
interface Acceptance {
  proofs: Map<string, Proof>;
  files: Map<string, ScanFile>;
  examined: number;
  resolve: (result: DirectoryAcceptanceResult) => void;
}
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
  acceptance?: Acceptance;
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
  publish,
}: {
  getRoot: (handle: string) => ReconciliationRoot | undefined;
  usedBytes: () => number;
  limit: number;
  worker: ReturnType<typeof createScanWorker>;
  wake: () => void;
  publish?: (
    binding: RootBinding,
    publication: DirectoryPublication
  ) => boolean | "busy";
}) {
  let job: Job | undefined;
  let disposed = false;
  const ledger = createDirectoryAcceptanceLedger();
  const binding = (value: Job) => {
    const root = getRoot(value.root.handle);
    return (
      !disposed &&
      root?.lifetime === value.root.lifetime &&
      root.generation === value.root.generation &&
      root.showHidden === value.root.showHidden &&
      usedBytes() + value.bytes + ledger.bytes() <= limit
    );
  };
  const fail = (
    value: Job,
    reason: Extract<ReconciliationResult, { ok: false }>["reason"]
  ) => {
    value.result = { ok: false, reason };
    if (value.acceptance) {
      value.acceptance.resolve({ status: "rejected", reason });
      value.acceptance.proofs.clear();
      value.acceptance.files.clear();
      value.acceptance = undefined;
    }
    value.baseline.clear();
    value.candidate.clear();
    value.bytes = 0;
    value.close = true;
  };
  const reserve = (value: Job, bytes: number) => {
    if (usedBytes() + value.bytes + ledger.bytes() + bytes > limit)
      throw Error("budget");
    value.bytes += bytes;
  };
  return {
    issue(token: string): DirectoryOperation | undefined {
      if (
        !publish ||
        !job?.result?.ok ||
        job.token !== token ||
        job.acceptance ||
        !binding(job)
      )
        return undefined;
      return ledger.issue(token, limit - usedBytes() - job.bytes);
    },
    accept(operation: DirectoryOperation): Promise<DirectoryAcceptanceResult> {
      const identity = operation && {
        session: operation.session,
        sequence: operation.sequence,
      };
      return ledger.run(operation, (token) => {
        if (
          !publish ||
          !job?.result?.ok ||
          job.token !== token ||
          job.close ||
          !binding(job)
        )
          return Promise.resolve({ status: "rejected", reason: "INVALIDATED" });
        const deferred = Promise.withResolvers<DirectoryAcceptanceResult>();
        job.acceptance = {
          proofs: new Map(),
          files: new Map(),
          examined: 0,
          resolve: (result) => {
            ledger.recordResult(identity, result);
            deferred.resolve(result);
          },
        };
        job.key = `${randomUUID()}:1`;
        wake();
        return deferred.promise;
      });
    },
    query: (operation: DirectoryOperation) => ledger.query(operation),
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
    invalidate(handle?: string, trimReceipts = false) {
      if (job && (!handle || job.root.handle === handle)) {
        fail(job, "INVALIDATED");
        wake();
      }
      if (trimReceipts) ledger.clear();
    },
    bytes: () => (job?.bytes ?? 0) + ledger.bytes(),
    hasWork: () => !!job && (!job.result || job.close || !!job.acceptance),
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
      if (value.result && !value.acceptance) return;
      let committing = false;
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
        const accepting = value.acceptance;
        for (const file of batch.files) {
          addProofs(
            accepting?.proofs ?? value.candidate,
            value.root,
            file,
            (bytes) => reserve(value, bytes)
          );
          if (accepting && !accepting.files.has(file.path)) {
            reserve(value, 2 * Buffer.byteLength(JSON.stringify(file)) + 128);
            accepting.files.set(file.path, structuredClone(file));
          }
        }
        if (accepting) accepting.examined += batch.examined;
        if (!batch.done) return;
        if (accepting) {
          if (
            accepting.proofs.size !== value.candidate.size ||
            [...value.candidate].some(([path, proof]) => {
              const current = accepting.proofs.get(path);
              return (
                current?.kind !== proof.kind ||
                current.identity !== proof.identity
              );
            })
          ) {
            fail(value, "INVALIDATED");
            return;
          }
          const publication: DirectoryPublication = {
            nodes: [],
            byPath: new Map(),
            files: new Map(),
            bytes: 0,
            generation: value.root.generation + 1,
            examined: accepting.examined,
          };
          if (!Number.isSafeInteger(publication.generation))
            throw Error("generation");
          for (const [path, proof] of value.candidate) {
            const previous = value.baseline.get(path);
            const retained =
              previous?.kind === proof.kind &&
              previous.identity === proof.identity;
            const parentPath = dirname(path);
            const parent =
              parentPath === value.root.authorization.path
                ? value.root.handle
                : publication.byPath.get(parentPath)?.handle;
            if (!parent) throw Error("missing parent");
            const node: WorkspaceNode = {
              handle: retained ? previous.handle! : randomUUID(),
              parent,
              kind: proof.kind,
              name: basename(path),
              displayPath: path,
            };
            const metadata =
              proof.kind === "file" ? accepting.files.get(path) : undefined;
            if (proof.kind === "file" && !metadata) throw Error("missing file");
            const bytes =
              2 * Buffer.byteLength(JSON.stringify([node, metadata])) + 256;
            reserve(value, bytes);
            publication.bytes += bytes;
            publication.nodes.push(node);
            publication.byPath.set(path, node);
            if (metadata) publication.files.set(node.handle, metadata);
          }
          const receipt: DirectoryAcceptanceResult = {
            status: "committed",
            root: value.root.handle,
            generation: publication.generation,
          };
          await worker.call({ op: "close", key: value.key });
          value.started = false;
          if (
            !binding(value) ||
            value.close ||
            value.acceptance !== accepting
          ) {
            fail(value, "INVALIDATED");
            return;
          }
          await verifyRoot(value.root.authorization);
          if (
            !binding(value) ||
            value.close ||
            value.acceptance !== accepting
          ) {
            fail(value, "INVALIDATED");
            return;
          }
          // No asynchronous boundary between the final binding check and CAS.
          committing = true;
          const committed = publish!(value.root, publication);
          accepting.resolve(
            committed === true
              ? receipt
              : {
                  status: "rejected",
                  reason: committed === "busy" ? "BUSY" : "INVALIDATED",
                }
          );
          value.acceptance = undefined;
          if (job === value) job = undefined;
          return;
        }
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
        if (committing) {
          value.acceptance?.resolve({ status: "unknown" });
          value.acceptance = undefined;
          if (job === value) job = undefined;
          return;
        }
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
      ledger.clear();
    },
  };
}
