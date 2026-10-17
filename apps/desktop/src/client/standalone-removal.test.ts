import { expect, test } from "bun:test";

import { createStandaloneRemoval } from "../bun/documents/standalone-removal";
import type { DocumentSnapshot } from "../shared/documents";
import type {
  RemovalRequest,
  RemovalResponse,
} from "../shared/standalone-removal";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDiscardGuard } from "./discard-guard";
import { createDocumentController, type DocumentTransport } from "./documents";
import { savedReply } from "./save-test-helper";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture() {
  const make = (text: string): DocumentSnapshot => ({
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: `${text}.md`,
    text,
    byteLength: text.length,
    revision: 1,
    hash: "a".repeat(64),
    fidelity: analyzeTextFidelity(text),
    explicitStandalone: true,
    writeCapability: { writable: true, reason: "writable" },
  });
  const a = make("a"),
    b = make("b");
  const grants = new Map([
    [a.handle, a],
    [b.handle, b],
  ]);
  const backend = createStandaloneRemoval(
    (h) => grants.get(h) ?? null,
    (h, identity, committed) => {
      if (grants.get(h) !== identity) return false;
      grants.delete(h);
      committed();
      return true;
    }
  );
  const calls: RemovalRequest[] = [];
  let selected = a;
  const guard = createDiscardGuard();
  const transport: DocumentTransport = {
    selectDocument: (r) =>
      Promise.resolve({ ...r, ok: true, snapshot: selected }),
    readDocument: (r) =>
      Promise.resolve({ ...r, ok: true, snapshot: selected }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () =>
      Promise.reject(Error("must not use swallowing release helper")),
    removeStandalone: (r) => {
      calls.push(r);
      return Promise.resolve(backend(r));
    },
  };
  const c = createDocumentController(transport, guard.ask);
  guard.register(c);
  c.setStandaloneRemovalEligibility((h) => grants.has(h));
  await c.select();
  selected = b;
  await c.select();
  const edit = (id: string) => {
    const editor = c.getEditor(id)!.state;
    c.updateEditor(id, editor.update({ changes: { from: 0, insert: "x" } }));
  };
  return { a, b, c, guard, transport, grants, backend, calls, edit };
}

test("clean pending removal freezes edits/close/switch/quit; committed publishes entry and tab together", async () => {
  const f = await fixture();
  const captured = deferred<RemovalRequest>(),
    response = deferred<RemovalResponse>();
  f.transport.removeStandalone = async (r) => {
    f.calls.push(r);
    if (r.op === "commit") {
      captured.resolve(r);
      return response.promise;
    }
    return f.backend(r);
  };
  const oldB = f.c.getEditor(f.b.documentId)!.state;
  const snapshots: [boolean, boolean][] = [];
  const unsub = f.c.subscribe(() => {
    const s = f.c.getSnapshot();
    snapshots.push([
      s.tabs.some((t) => t.handle === f.a.handle),
      s.entries.some((e) => e.handle === f.a.handle),
    ]);
  });
  const run = f.c.removeStandalone(f.a.handle);
  const commit = await captured.promise;
  expect(f.c.getSnapshot().frozen).toBe(true);
  f.edit(f.b.documentId);
  await f.c.closeTab(f.a.documentId);
  f.c.activateTab(f.a.documentId);
  await f.c.clear();
  expect(f.c.beginDiscard()).toBe(false);
  expect(
    await f.guard.request({
      protocolVersion: 1,
      requestId: crypto.randomUUID(),
      reason: "quit",
    })
  ).toMatchObject({ allow: false });
  expect(f.c.getEditor(f.b.documentId)!.state).toBe(oldB);
  expect(f.c.getSnapshot().tabs).toHaveLength(2);
  response.resolve(f.backend(commit));
  await run;
  expect(snapshots.every(([tab, entry]) => tab === entry)).toBe(true);
  expect(f.c.getSnapshot().entries.map((e) => e.handle)).toEqual([f.b.handle]);
  expect(f.c.getEditor(f.b.documentId)!.state).toBe(oldB);
  expect(f.c.getSnapshot().frozen).toBe(false);
  expect(f.c.getSnapshot().removalPending).toBeUndefined();
  unsub();
  f.c.dispose();
});

test("lost begin retries the same identity; unknown and stale query preserve memory and freeze", async () => {
  const f = await fixture();
  let dropBegin = true;
  let queryStatus: "unknown" | "stale-session" | null = null;
  f.transport.removeStandalone = (r) => {
    f.calls.push(r);
    if (r.op === "query" && queryStatus)
      return Promise.resolve({
        ...r,
        status: queryStatus,
        operation: {
          session: r.session,
          sequence: r.sequence,
          handle: r.handle,
        },
      });
    const result = f.backend(r);
    if (r.op === "begin" && dropBegin) {
      dropBegin = false;
      return Promise.reject(Error("lost begin"));
    }
    if (r.op === "commit") return Promise.reject(Error("commit not delivered"));
    return Promise.resolve(result);
  };
  const before = f.c.getEditor(f.a.documentId)!.state;
  await f.c.removeStandalone(f.a.handle);
  expect(f.c.getSnapshot().frozen).toBe(true);
  await f.c.retryStandaloneRemoval();
  const begins = f.calls.filter((r) => r.op === "begin");
  expect(begins).toHaveLength(2);
  if (begins[0].op === "state") throw Error("expected begin");
  expect(begins[1]).toMatchObject({
    session: begins[0].session,
    sequence: begins[0].sequence,
    handle: f.a.handle,
  });
  for (const status of ["unknown", "stale-session"] as const) {
    queryStatus = status;
    const count = f.calls.length;
    await f.c.retryStandaloneRemoval();
    expect(f.calls.slice(count).map((r) => r.op)).toEqual(["query"]);
    expect(f.c.getSnapshot().frozen).toBe(true);
    expect(f.c.getSnapshot().tabs).toHaveLength(2);
    expect(f.c.getEditor(f.a.documentId)!.state).toBe(before);
  }
  f.c.dispose();
});

test("dirty cancel has no begin; lost commit response remains frozen after protect finally then query settles", async () => {
  const f = await fixture();
  f.edit(f.a.documentId);
  f.edit(f.b.documentId);
  const aState = f.c.getEditor(f.a.documentId)!.state,
    bState = f.c.getEditor(f.b.documentId)!.state;
  const answer = (allow: boolean) =>
    new Promise<void>((resolve) => {
      const unsubscribe = f.guard.subscribe(() => {
        if (f.guard.getSnapshot()) {
          unsubscribe();
          f.guard.respond(allow);
          resolve();
        }
      });
    });
  let answered = answer(false);
  let run = f.c.removeStandalone(f.a.handle);
  await answered;
  await run;
  expect(f.calls).toHaveLength(0);
  expect(f.c.getEditor(f.a.documentId)!.state).toBe(aState);
  f.transport.removeStandalone = (r) => {
    f.calls.push(r);
    const result = f.backend(r);
    return r.op === "commit"
      ? Promise.reject(Error("lost response"))
      : Promise.resolve(result);
  };
  answered = answer(true);
  run = f.c.removeStandalone(f.a.handle);
  await answered;
  await run;
  expect(f.c.getSnapshot().frozen).toBe(true);
  expect(f.c.getSnapshot().tabs).toHaveLength(2);
  f.c.endDiscard();
  expect(f.c.getSnapshot().frozen).toBe(true);
  expect(f.c.beginDiscard()).toBe(false);
  await f.c.retryStandaloneRemoval();
  expect(f.c.getSnapshot().tabs.map((t) => t.handle)).toEqual([f.b.handle]);
  expect(f.c.getEditor(f.b.documentId)!.state).toBe(bState);
  expect(f.c.getSnapshot().frozen).toBe(false);
  f.c.dispose();
});

test("ack failure preserves known result and only blocks further removal; retry uses same operation", async () => {
  const f = await fixture();
  let fail = true;
  f.transport.removeStandalone = (r) => {
    f.calls.push(r);
    const result = f.backend(r);
    return r.op === "ack" && fail
      ? Promise.reject(Error("lost ack"))
      : Promise.resolve(result);
  };
  await f.c.removeStandalone(f.a.handle);
  expect(f.c.getSnapshot().removalPending).toBe("ack");
  expect(f.c.getSnapshot().frozen).toBe(false);
  expect(f.c.canRemoveStandalone(f.b.handle)).toBe(false);
  f.edit(f.b.documentId);
  expect(f.c.isDirty(f.b.documentId)).toBe(true);
  fail = false;
  await f.c.retryStandaloneRemoval();
  expect(f.c.canRemoveStandalone(f.b.handle)).toBe(true);
  const ack = f.calls.filter((r) => r.op === "ack");
  expect(ack).toHaveLength(2);
  expect(
    ack[0].op !== "state" &&
      ack[1].op !== "state" &&
      ack[0].sequence === ack[1].sequence
  ).toBe(true);
  f.c.dispose();
});

test("closed standalone removal, rejected begin, and no-longer-top-level selection", async () => {
  const f = await fixture();
  await f.c.closeTab(f.a.documentId);
  expect(f.c.getSnapshot().entries).toHaveLength(2);
  f.c.setStandaloneRemovalEligibility(() => false);
  await f.c.removeStandalone(f.a.handle);
  expect(f.calls).toHaveLength(0);
  f.c.setStandaloneRemovalEligibility(() => true);
  await f.c.removeStandalone(f.a.handle);
  expect(f.c.getSnapshot().entries).toHaveLength(1);
  expect(f.c.getSnapshot().tabs.map((t) => t.handle)).toEqual([f.b.handle]);
  f.grants.delete(f.b.handle);
  await f.c.removeStandalone(f.b.handle);
  expect(f.c.getSnapshot().entries).toHaveLength(1);
  expect(f.c.getSnapshot().frozen).toBe(false);
  expect(f.c.getSnapshot().removalPending).toBeUndefined();
  f.c.dispose();
});

test("removal waits for the actual pending save response before begin", async () => {
  const f = await fixture();
  const captured = deferred<Parameters<typeof savedReply>[0]>();
  const reply = deferred<ReturnType<typeof savedReply>>();
  const drain = deferred<void>(),
    drained = deferred<void>();
  f.transport.saveDocument = (r) => {
    captured.resolve(r);
    return reply.promise;
  };
  f.transport.waitForDocumentSaves = async (r) => {
    drain.resolve();
    await drained.promise;
    return { ...r, settled: true };
  };
  f.c.activateTab(f.a.documentId);
  f.edit(f.a.documentId);
  const saving = f.c.save();
  const request = await captured.promise;
  const removing = f.c.removeStandalone(f.a.handle);
  expect(f.c.getSnapshot().frozen).toBe(true);
  expect(f.calls).toHaveLength(0);
  reply.resolve(savedReply(request, f.a));
  await saving;
  await drain.promise;
  expect(f.calls).toHaveLength(0);
  drained.resolve();
  await removing;
  expect(f.calls.map((r) => r.op)).toEqual(["state", "begin", "commit", "ack"]);
  expect(f.c.getSnapshot().entries.map((e) => e.handle)).toEqual([f.b.handle]);
  expect(f.guard.getSnapshot()).toBeNull();
  f.c.dispose();
});
