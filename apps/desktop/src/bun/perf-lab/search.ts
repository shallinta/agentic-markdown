import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { perfRecord, perfUuid } from "../../shared/perf-lab";
import {
  validSearchLabRequest,
  validSearchLabResponse,
  type SearchLabResponse,
} from "../../shared/search-lab";
import { createDocumentService } from "../documents";
import { createWorkspaceService } from "../workspace";

interface Fixture {
  directory: string;
  documents: ReturnType<typeof createDocumentService>;
  workspace: ReturnType<typeof createWorkspaceService>;
  root?: { handle: string; generation: number };
  cleanup: "ready" | "disposed" | "failed";
}
type Failure = Extract<SearchLabResponse, { ok: false }>;
const protocolVersion = 1 as const;
const request = (op: "select" | "state") => ({
  protocolVersion,
  requestId: crypto.randomUUID(),
  op,
});

/** This instance owns a disposable root and accepts only its opaque handle. */
export function createSearchLab() {
  let fixture: Fixture | undefined;
  let active: { id: string; cancel: AbortController } | undefined;
  let pending: Promise<SearchLabResponse> | undefined;
  let stopping: Promise<void> | undefined;
  let disposed = false;

  async function release(target: Fixture) {
    if (target.cleanup === "failed")
      throw Error("Fixture disposal unconfirmed");
    if (target.cleanup === "ready") {
      target.cleanup = "failed";
      try {
        await target.workspace.dispose();
      } finally {
        await target.documents.dispose();
      }
      target.cleanup = "disposed";
    }
    await rm(target.directory, { recursive: true, force: true });
    fixture = undefined;
  }

  function stop() {
    active?.cancel.abort();
    stopping ??= (async () => {
      try {
        await pending;
      } finally {
        if (fixture) await release(fixture);
      }
    })().finally(() => {
      stopping = undefined;
    });
    return stopping;
  }

  async function prepare(signal: AbortSignal) {
    const directory = await mkdtemp(join(tmpdir(), "agentic-search-lab-"));
    const documents = createDocumentService({
      pickFile: () => Promise.resolve(null),
    });
    const workspace = createWorkspaceService({
      documents,
      pickDirectory: () => Promise.resolve(directory),
    });
    const target: Fixture = {
      directory,
      documents,
      workspace,
      cleanup: "ready",
    };
    fixture = target;
    try {
      await writeFile(join(directory, "sample.md"), "\uFEFF😀可检索", {
        flag: "wx",
        mode: 0o600,
      });
      if (signal.aborted) return;
      const selected = await workspace.request(request("select"));
      if (!selected.ok) throw Error("Synthetic root unavailable");
      const deadline = performance.now() + 5_000;
      while (!signal.aborted && performance.now() < deadline) {
        const state = await workspace.request(request("state"));
        if (!state.ok) throw Error("Synthetic scan unavailable");
        const root = state.roots[0];
        if (root?.status === "complete") {
          target.root = { handle: root.handle, generation: root.generation };
          return target.root;
        }
        if (root?.status !== "scanning") break;
        await Bun.sleep(10);
      }
    } finally {
      if (!target.root) {
        await release(target);
      }
    }
  }

  async function run(value: unknown): Promise<SearchLabResponse> {
    const requestId =
      perfRecord(value) && perfUuid(value.requestId) ? value.requestId : null;
    const fail = (error: Failure["error"]): Failure => ({
      protocolVersion,
      requestId,
      ok: false,
      error,
    });
    if (disposed) return fail("DISABLED");
    if (!validSearchLabRequest(value)) return fail("INVALID");
    const envelope = {
      protocolVersion,
      requestId: value.requestId,
      ok: true as const,
    };
    if (value.op === "stop") {
      try {
        await stop();
        return { ...envelope, op: "stop" };
      } catch {
        return fail("UNAVAILABLE");
      }
    }
    if (value.op === "cancel") {
      if (active?.id !== value.targetRequestId) return fail("STALE");
      active.cancel.abort();
      return { ...envelope, op: "cancel" };
    }
    if (pending || stopping) return fail("BUSY");
    if (fixture && fixture.cleanup !== "ready") return fail("UNAVAILABLE");
    const cancel = new AbortController();
    active = { id: value.requestId, cancel };
    pending = (async (): Promise<SearchLabResponse> => {
      try {
        if (value.op === "prepare") {
          const root = fixture?.root ?? (await prepare(cancel.signal));
          if (cancel.signal.aborted) return fail("CANCELLED");
          return root
            ? {
                ...envelope,
                op: "prepare",
                root: root.handle,
                generation: root.generation,
              }
            : fail("NOT_READY");
        }
        if (value.op !== "query") return fail("INVALID");
        const current = fixture;
        if (!current?.root) return fail("NOT_READY");
        if (
          current.root.handle !== value.root ||
          current.root.generation !== value.generation
        )
          return fail("STALE");
        const result = await current.workspace.searchSnapshot(
          value.root,
          value.generation,
          value.query,
          cancel.signal
        );
        if (!result.ok && result.error === "UNKNOWN") return fail("UNKNOWN");
        if (cancel.signal.aborted) return fail("CANCELLED");
        if (!result.ok) {
          switch (result.error) {
            case "BUSY":
            case "CANCELLED":
            case "LIMIT":
              return fail(result.error);
            default:
              return fail("UNAVAILABLE");
          }
        }
        const response = {
          ...envelope,
          op: "query" as const,
          root: value.root,
          generation: value.generation,
          hits: result.hits,
        };
        return validSearchLabResponse(response, value)
          ? response
          : fail("UNKNOWN");
      } catch {
        return fail(cancel.signal.aborted ? "CANCELLED" : "UNAVAILABLE");
      }
    })();
    try {
      return await pending;
    } finally {
      pending = undefined;
      active = undefined;
    }
  }

  return {
    run,
    close: stop,
    dispose() {
      disposed = true;
      return stop();
    },
  };
}
