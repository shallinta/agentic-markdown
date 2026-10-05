import { randomUUID } from "node:crypto";

import type { WorkspaceRoot, DirectoryOperation } from "../../shared/workspace";

import type { RootAuthorization } from "./authorization";
import type { createReconciliation } from "./reconciliation";
import { validWatchBatch } from "./scan-protocol";

interface ObservedRoot {
  meta: WorkspaceRoot;
  authorization: RootAuthorization;
}
interface Binding {
  root: ObservedRoot;
  key: string;
  hidden: boolean;
  dirty: boolean;
  started: boolean;
  failed: boolean;
  unknown?: { operation: DirectoryOperation; queries: number };
}
/** Owner scheduling adapter. Worker calls happen only in step, from drain. */
export function createAutomaticObservation({
  list,
  call,
  reconciliation,
  wake,
  budget,
  canStart = () => true,
  terminate = () => undefined,
  interval = 350,
}: {
  list: () => ObservedRoot[];
  call: (request: Record<string, unknown>) => Promise<unknown>;
  reconciliation: ReturnType<typeof createReconciliation>;
  wake: () => void;
  budget: () => number;
  canStart?: () => boolean;
  terminate?: () => void;
  interval?: number;
}) {
  const bindings = new Map<string, Binding>();
  const cleanup = new Map<string, { attempts: number; retryAt: number }>();
  const queueCleanup = (key: string) => {
    if (!cleanup.has(key)) cleanup.set(key, { attempts: 0, retryAt: 0 });
  };
  const readyCleanup = () =>
    [...cleanup].find(
      ([, retry]) => retry.attempts < 3 && Date.now() >= retry.retryAt
    );
  const pollKey = `${randomUUID()}:1`;
  let sequence = 0,
    due = false,
    disposed = false,
    bytes = 0;
  let halt = false,
    fatal = false,
    shutdown = false;
  let reserved = 0;
  let activity: Promise<void> | undefined;
  async function accountedCall(
    request: Record<string, unknown>,
    reservation: number
  ) {
    const deferred = Promise.withResolvers<void>();
    activity = deferred.promise;
    reserved = reservation;
    try {
      const result = await call(request);
      if (
        result &&
        typeof result === "object" &&
        "bytes" in result &&
        Number.isSafeInteger(result.bytes) &&
        Number(result.bytes) >= 0 &&
        Number(result.bytes) <= 2 * 1024 * 1024
      )
        bytes = Number(result.bytes);
      else bytes += reserved;
      return result;
    } catch (error) {
      bytes += reserved;
      throw error;
    } finally {
      reserved = 0;
      activity = undefined;
      deferred.resolve();
    }
  }
  let automatic:
    | {
        binding: Binding;
        cancelled: boolean;
        token?: string;
        done: Promise<void>;
      }
    | undefined;
  const timer = setInterval(() => {
    if (!disposed) {
      due = true;
      wake();
    }
  }, interval);
  timer.unref();
  function drop(binding: Binding) {
    if (automatic?.binding === binding) {
      automatic.cancelled = true;
      reconciliation.invalidate(binding.root.meta.handle);
    }
    bindings.delete(binding.root.meta.handle);
    if (binding.started) queueCleanup(binding.key);
  }
  function current(binding: Binding) {
    return (
      !disposed &&
      bindings.get(binding.root.meta.handle) === binding &&
      list().includes(binding.root)
    );
  }
  function startAutomatic() {
    if (disposed || automatic || !canStart()) return;
    const binding = [...bindings.values()].find(
      (item) =>
        item.dirty && !item.failed && item.root.meta.status === "complete"
    );
    if (!binding) return;
    binding.dirty = false;
    const completion = Promise.withResolvers<void>();
    const operation = {
      binding,
      cancelled: false,
      token: undefined as string | undefined,
      done: completion.promise,
    };
    automatic = operation;
    // Intentionally outside drain: prepare/accept are advanced by that drain.
    void (async () => {
      try {
        const candidate = await reconciliation.prepare(
          binding.root.meta.handle
        );
        if (!candidate.ok) {
          if (current(binding) && !operation.cancelled) {
            if (candidate.reason === "BUSY") binding.dirty = true;
            else {
              binding.failed = true;
              binding.root.meta.observation = "limited";
            }
          }
          return;
        }
        operation.token = candidate.summary.token;
        if (!current(binding) || operation.cancelled) return;
        if (
          !candidate.summary.added &&
          !candidate.summary.removed &&
          !candidate.summary.replaced
        )
          return;
        const issued = reconciliation.issue(candidate.summary.token);
        if (!issued) {
          binding.dirty = true;
          return;
        }
        binding.unknown = { operation: issued, queries: 0 };
        const receipt = await reconciliation.accept(issued);
        if (!current(binding) || operation.cancelled) return;
        if (receipt.status === "committed" || receipt.status === "rejected")
          binding.unknown = undefined;
        if (receipt.status === "rejected" && receipt.reason === "BUSY")
          binding.dirty = true;
        else if (receipt.status !== "committed") {
          // No second accept or new operation after an unknown result.
          binding.failed = true;
          if (
            receipt.status === "unknown" ||
            receipt.status === "pending" ||
            receipt.status === "issued"
          )
            binding.unknown = { operation: issued, queries: 0 };
          binding.root.meta.observation = "limited";
        }
      } catch {
        if (current(binding) && !operation.cancelled) {
          binding.failed = true;
          binding.root.meta.observation = "limited";
        }
      } finally {
        if (operation.token) reconciliation.release(operation.token);
        if (automatic === operation) automatic = undefined;
        completion.resolve();
      }
    })();
  }
  return {
    bytes: () => bytes + reserved,
    settle: async () => {
      await activity;
      if (automatic?.cancelled) await automatic.done;
    },
    preempt() {
      if (!automatic) return false;
      automatic.cancelled = true;
      automatic.binding.dirty = true;
      reconciliation.invalidate(automatic.binding.root.meta.handle);
      return true;
    },
    hasWork: () => shutdown || !!readyCleanup() || due,
    hasCleanup: () => shutdown || !!readyCleanup(),
    cancel(handle: string, reset = false) {
      if (!fatal) halt = false;
      // Do not reset in-flight retry counters: one user action can invalidate twice.
      const binding = bindings.get(handle);
      if (binding) {
        if (automatic?.binding === binding) {
          automatic.cancelled = true;
          reconciliation.invalidate(handle);
        }
        if (
          reset ||
          binding.failed ||
          binding.root.meta.observation === "limited"
        )
          drop(binding);
      }
    },
    async step() {
      if (shutdown) {
        shutdown = false;
        halt = true;
        if (automatic) {
          automatic.cancelled = true;
          reconciliation.invalidate(automatic.binding.root.meta.handle);
        }
        for (const binding of bindings.values())
          binding.root.meta.observation = "limited";
        try {
          const result = await call({ op: "watchDispose", key: pollKey });
          if (
            !result ||
            typeof result !== "object" ||
            !("bytes" in result) ||
            result.bytes !== 0 ||
            Object.keys(result).length !== 1
          )
            throw Error();
          bytes = 0;
        } catch {
          fatal = true;
          clearInterval(timer);
          terminate();
        }
        cleanup.clear();
        bindings.clear();
        return;
      }
      const pending = readyCleanup();
      if (pending) {
        const [old, retry] = pending;
        try {
          const result = await call({ op: "watchClose", key: old });
          if (
            result &&
            typeof result === "object" &&
            "bytes" in result &&
            Number.isSafeInteger(result.bytes) &&
            Number(result.bytes) >= 0 &&
            Number(result.bytes) <= 2 * 1024 * 1024 &&
            Object.keys(result).length === 1
          )
            bytes = Number(result.bytes);
          else throw Error();
          cleanup.delete(old);
        } catch {
          retry.attempts++;
          if (retry.attempts >= 3) shutdown = true;
          retry.retryAt = Date.now() + interval;
          for (const binding of bindings.values())
            binding.root.meta.observation = "limited";
        }
        return;
      }
      due = false;
      if (disposed || halt || fatal) return;
      // Never lose unconfirmed close keys or rebind over retained resources.
      // Bounded close failures escalate to whole-instance disposal before any new work.
      if (cleanup.size) return;
      for (const binding of bindings.values()) {
        if (!binding.failed || !binding.unknown || binding.unknown.queries >= 3)
          continue;
        binding.unknown.queries++;
        const receipt = reconciliation.query(binding.unknown.operation);
        if (receipt.status === "committed") {
          binding.unknown = undefined;
          binding.failed = false;
          binding.dirty = true;
        } else if (receipt.status === "rejected") binding.unknown = undefined;
      }
      const roots = list();
      if (!roots.length && !bindings.size) return;
      for (const binding of bindings.values()) {
        if (
          !roots.includes(binding.root) ||
          binding.hidden !== (binding.root.meta.showHidden ?? false) ||
          binding.root.meta.status !== "complete"
        )
          drop(binding);
      }
      if (cleanup.size) {
        due = true;
        return;
      }
      for (const root of roots) {
        if (root.meta.status !== "complete") {
          root.meta.observation = "limited";
          continue;
        }
        if (!bindings.has(root.meta.handle)) {
          if (sequence === Number.MAX_SAFE_INTEGER) {
            halt = true;
            root.meta.observation = "limited";
            return;
          }
          const binding: Binding = {
            root,
            key: `${root.meta.handle}:${++sequence}`,
            hidden: root.meta.showHidden ?? false,
            dirty: false,
            started: false,
            failed: false,
          };
          bindings.set(root.meta.handle, binding);
          root.meta.observation = "establishing";
          binding.started = true;
          try {
            const estimate = Buffer.byteLength(
              JSON.stringify(root.authorization)
            );
            if (bytes + estimate > budget()) throw Error();
            const result = await accountedCall(
              {
                op: "watchStart",
                key: binding.key,
                root: root.authorization,
                showHidden: binding.hidden,
              },
              estimate
            );
            if (
              result &&
              typeof result === "object" &&
              "bytes" in result &&
              Number.isSafeInteger(result.bytes) &&
              Number(result.bytes) >= 0 &&
              Number(result.bytes) <= 2 * 1024 * 1024 &&
              Object.keys(result).length === 1
            )
              bytes = Number(result.bytes);
            else throw Error();
          } catch {
            binding.failed = true;
            root.meta.observation = "limited";
            queueCleanup(binding.key);
          }
          due = true;
          return;
        }
      }
      try {
        const limit = Math.min(2 * 1024 * 1024, Math.max(0, budget()));
        const response = await accountedCall(
          {
            op: "watchTick",
            key: pollKey,
            budget: limit,
          },
          Math.max(0, limit - bytes)
        );
        if (!validWatchBatch(response)) throw Error();
        bytes = Number(response.bytes);
        if (response.roots.some((row) => row.status === "establishing"))
          due = true;
        for (const row of response.roots) {
          const binding = [...bindings.values()].find(
            (item) => item.key === row.key
          );
          if (!binding || !current(binding)) continue;
          if (!binding.failed) binding.root.meta.observation = row.status;
          binding.dirty ||= row.dirty;
        }
        startAutomatic();
      } catch {
        for (const binding of bindings.values()) {
          binding.failed = true;
          binding.root.meta.observation = "limited";
          if (binding.started) queueCleanup(binding.key);
        }
      }
    },
    dispose() {
      disposed = true;
      clearInterval(timer);
      for (const binding of bindings.values()) drop(binding);
    },
  };
}
