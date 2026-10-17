import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  validFolderRemovalResponse,
  type FolderRemovalRequest,
} from "../../shared/folder-removal";
import type { WorkspaceRoot } from "../../shared/workspace";
import { createDocumentService } from "../documents";

import { createHiddenPreferences, type HiddenPreferences } from "./preferences";
import { createScanWorker } from "./worker";

import { createWorkspaceService } from ".";

const envelope = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});

test("park finishes an already consumed real scan batch and cancel resumes without losing entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "folder-park-"));
  await Promise.all(Array.from({ length: 160 }, (_, i) => writeFile(join(directory, `${i}.md`), "A")));
  const entered = Promise.withResolvers<void>(), resume = Promise.withResolvers<void>();
  const worker = createScanWorker();
  let paused = false;
  const docs = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const workspace = createWorkspaceService({ documents: docs, pickDirectory: () => Promise.resolve(directory), worker: {
    dispose: () => worker.dispose(),
    call: async request => { const result = await worker.call(request); if (request.op === "next" && !paused) { paused = true; entered.resolve(); await resume.promise; } return result; },
  } });
  try {
    const selected = await workspace.request({ ...envelope(), op: "select" });
    if (!selected.ok) throw Error();
    const root = selected.roots[0];
    await entered.promise;
    const state = await workspace.removeFolderRoot({ ...envelope(), op: "state" });
    if (state.status !== "state") throw Error();
    const operation = { session: state.session, sequence: state.sequence, root: root.handle };
    let settled = false;
    const preparing = workspace.removeFolderRoot({ ...envelope(), ...operation, op: "prepare", generation: root.generation, documents: [] }).then(value => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resume.resolve();
    expect((await preparing).status).toBe("issued");
    const parked = await workspace.request({ ...envelope(), op: "state" });
    expect(parked.ok && parked.roots[0].entries).toBeGreaterThan(0);
    expect(parked.ok && parked.roots[0].entries).toBeLessThan(160);
    expect((await workspace.removeFolderRoot({ ...envelope(), ...operation, op: "cancel" })).status).toBe("rejected");
    let count = -1;
    for (let i = 0; i < 1000; i++) {
      const next = await workspace.request({ ...envelope(), op: "state" });
      if (next.ok && next.roots[0]?.status === "complete") { count = next.roots[0].entries; break; }
      await Bun.sleep(2);
    }
    expect(count).toBe(160);
  } finally { resume.resolve(); await workspace.dispose(); await docs.dispose(); await rm(directory, { recursive: true, force: true }); }
});
async function fixture(preferences?: HiddenPreferences, explicit = false) {
  const directory = await mkdtemp(join(tmpdir(), "folder-remove-"));
  const rootPath = join(directory, "root");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(rootPath);
  const file = join(rootPath, "a.md");
  await writeFile(file, "A");
  const prefs =
    preferences ?? createHiddenPreferences(join(directory, "settings"));
  let picked = file;
  let pickedDirectory = rootPath;
  const docs = createDocumentService({ pickFile: () => Promise.resolve(picked) });
  if (explicit) await docs.select(envelope());
  const workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(pickedDirectory),
    documents: docs,
    preferences: prefs,
  });
  await workspace.request({ ...envelope(), op: "select" });
  let root: WorkspaceRoot | undefined;
  for (let i = 0; i < 1000; i++) {
    const result = await workspace.request({ ...envelope(), op: "state" });
    if (result.ok && result.roots[0]?.status === "complete") {
      root = result.roots[0];
      break;
    }
    await Bun.sleep(2);
  }
  if (!root) throw Error("scan not complete");
  const rootGeneration = root.generation;
  const page = await workspace.request({
    ...envelope(),
    op: "page",
    root: root.handle,
    generation: root.generation,
    cursor: 0,
  });
  if (!page.ok) throw Error();
  const node = page.nodes!.find((item) => item.kind === "file")!;
  const opened = await workspace.open({
    ...envelope(),
    root: root.handle,
    entry: node.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error();
  const snapshot = opened.snapshot;
  const state = await workspace.removeFolderRoot({
    ...envelope(),
    op: "state",
  });
  if (state.status !== "state") throw Error();
  const operation = {
    session: state.session,
    sequence: state.sequence,
    root: root.handle,
  };
  const request = async (
    value: Omit<FolderRemovalRequest, "protocolVersion" | "requestId">
  ) => {
    const params = { ...envelope(), ...value } as FolderRemovalRequest;
    const response = await workspace.removeFolderRoot(params);
    expect(validFolderRemovalResponse(response, params)).toBe(true);
    return response;
  };
  const prepare = () =>
    request({
      ...operation,
      op: "prepare",
      generation: rootGeneration,
      documents: [{ handle: snapshot.handle, documentId: snapshot.documentId }],
    } as FolderRemovalRequest);
  const cleanup = async () => {
    await workspace.dispose();
    await docs.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  return {
    directory,
    file,
    rootPath: root.displayPath,
    prefs,
    workspace,
    docs,
    snapshot,
    operation,
    request,
    prepare,
    cleanup,
    selectOutside: async () => {
      picked = join(directory, "outside.md");
      await writeFile(picked, "outside");
      return docs.select(envelope());
    },
    addParent: async () => {
      pickedDirectory = directory;
      return workspace.request({ ...envelope(), op: "select" });
    },
  };
}

test("an unacknowledged standalone removal excludes folder prepare, and a folder lease excludes standalone begin", async () => {
  const f = await fixture();
  try {
    const outside = await f.selectOutside();
    if (!outside.ok || !outside.snapshot) throw Error();
    const state = f.workspace.removeStandalone({ ...envelope(), op: "state" });
    if (state.status !== "state") throw Error();
    const operation = { session: state.session, sequence: state.sequence, handle: outside.snapshot.handle };
    expect(f.workspace.removeStandalone({ ...envelope(), ...operation, op: "begin" }).status).toBe("issued");
    expect((await f.prepare()).status).toBe("rejected");
    expect(f.docs.locations()).toHaveLength(2);
    expect(f.workspace.removeStandalone({ ...envelope(), ...operation, op: "commit" }).status).toBe("committed");
    await f.request({ ...f.operation, op: "ack" });
    f.operation.sequence++;
    expect((await f.prepare()).status).toBe("rejected"); // terminal receipt still owns slot
    f.workspace.removeStandalone({ ...envelope(), ...operation, op: "ack" });
    await f.request({ ...f.operation, op: "ack" });
    f.operation.sequence++;
    const fresh = await f.selectOutside();
    if (!fresh.ok || !fresh.snapshot) throw Error();
    expect((await f.prepare()).status).toBe("issued");
    expect(f.workspace.removeStandalone({ ...envelope(), ...operation, sequence: operation.sequence + 1, handle: fresh.snapshot.handle, op: "begin" }).status).toBe("rejected");
    expect((await f.request({ ...f.operation, op: "cancel" })).status).toBe("rejected");
  } finally { await f.cleanup(); }
});

test("parent absorption invalidates an old root target without revoking the inherited grant", async () => {
  const f = await fixture();
  try {
    const added = await f.addParent();
    if (!added.ok) throw Error();
    expect(added.roots).toHaveLength(1);
    expect(added.roots[0].handle).not.toBe(f.operation.root);
    expect((await f.prepare()).status).toBe("rejected");
    expect(await f.docs.read({ ...envelope(), handle: f.snapshot.handle })).toMatchObject({ ok: true, snapshot: { handle: f.snapshot.handle, documentId: f.snapshot.documentId, text: "A" } });
  } finally { await f.cleanup(); }
});

test("close choice closes an explicit standalone tab but preserves its independent grant", async () => {
  const f = await fixture(undefined, true);
  try {
    const prepared = await f.prepare();
    expect(prepared).toMatchObject({ status: "issued", documents: [{ explicitStandalone: true }] });
    const result = await f.request({ ...f.operation, op: "commit", decision: "close" } as FolderRemovalRequest);
    if (result.status !== "committed") throw Error();
    expect(result.publication.closed).toEqual([f.snapshot.handle]);
    expect(result.publication.revoked).toEqual([]);
    expect(await f.docs.read({ ...envelope(), handle: f.snapshot.handle })).toMatchObject({ ok: true, snapshot: { documentId: f.snapshot.documentId, explicitStandalone: true } });
  } finally { await f.cleanup(); }
});

test("omitted registered open document rejects; delivered unsubscribe permits a fresh operation", async () => {
  const f = await fixture();
  try {
    const a = f.snapshot;
    const binding = { ...envelope(), handle: a.handle, documentId: a.documentId, hash: a.hash, revision: a.revision, watchToken: crypto.randomUUID(), watchEpoch: 1 };
    await f.docs.observe({ ...binding, active: true });
    const empty = () => f.request({ ...envelope(), ...f.operation, op: "prepare", generation: 1, documents: [] } as FolderRemovalRequest);
    expect((await empty()).status).toBe("rejected");
    expect(f.docs.locations()).toHaveLength(1);
    await f.request({ ...f.operation, op: "ack" });
    f.operation.sequence++;
    await f.docs.observe({ ...binding, requestId: crypto.randomUUID(), active: false });
    expect((await empty()).status).toBe("issued");
    expect((await f.request({ ...f.operation, op: "cancel" })).status).toBe("rejected");
  } finally { await f.cleanup(); }
});

test("disposal releases an issued or settings-unknown lease without reviving the root", async () => {
  for (const commit of [false, true]) {
    const f = await fixture({ get: () => Promise.resolve(false), set: () => Promise.resolve(), remove: () => Promise.resolve({ status: "unknown", query: () => Promise.resolve("unknown") }) });
    try {
      await f.prepare();
      if (commit) await f.request({ ...f.operation, op: "commit", decision: "keep" } as FolderRemovalRequest);
      await f.workspace.dispose();
      expect(f.docs.locations()).toHaveLength(0);
    } finally { await f.cleanup(); }
  }
});

test("real directory removal keeps an opened grant in place and deletes only root preference", async () => {
  const f = await fixture();
  try {
    await f.prefs.set(f.rootPath, true);
    await f.prefs.set("/other", true);
    expect((await f.prepare()).status).toBe("issued");
    const result = await f.request({
      ...f.operation,
      op: "commit",
      decision: "keep",
    } as FolderRemovalRequest);
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw Error();
    expect(result.publication.standalone).toEqual([f.snapshot.handle]);
    expect(result.publication.roots).toHaveLength(0);
    expect(
      await f.docs.read({ ...envelope(), handle: f.snapshot.handle })
    ).toMatchObject({
      ok: true,
      snapshot: {
        documentId: f.snapshot.documentId,
        handle: f.snapshot.handle,
        explicitStandalone: true,
        text: "A",
      },
    });
    expect(await f.prefs.get(f.rootPath)).toBe(false);
    expect(await f.prefs.get("/other")).toBe(true);
    expect(await readFile(f.file, "utf8")).toBe("A");
    expect(
      (await f.request({ ...f.operation, op: "query" }))
        .status
    ).toBe("committed");
  } finally {
    await f.cleanup();
  }
});

test("cancel preserves root and grant; closing a missing root-only file needs no disk authorization", async () => {
  const f = await fixture();
  try {
    await f.prepare();
    expect(
      (
        await f.request({
          ...f.operation,
          op: "cancel",
        })
      ).status
    ).toBe("rejected");
    await f.request({ ...f.operation, op: "ack" });
    expect(f.docs.locations()).toHaveLength(1);
    await unlink(f.file);
    f.operation.sequence++;
    await f.prepare();
    const result = await f.request({
      ...f.operation,
      op: "commit",
      decision: "close",
    } as FolderRemovalRequest);
    expect(result.status).toBe("committed");
    if (result.status !== "committed") throw Error();
    expect(result.publication.closed).toEqual([f.snapshot.handle]);
    expect(result.publication.revoked).toEqual([f.snapshot.handle]);
    expect(f.docs.locations()).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

test("unknown settings outcome keeps service lease across RPC and permits only terminal query to release", async () => {
  let confirmed = false;
  const f = await fixture({
    get: () => Promise.resolve(false),
    set: () => Promise.resolve(),
    remove: () =>
      Promise.resolve({
        status: "unknown",
        query: () => Promise.resolve(confirmed ? "committed" : "unknown"),
      }),
  });
  try {
    await f.prepare();
    expect(
      (
        await f.request({
          ...f.operation,
          op: "commit",
          decision: "keep",
        } as FolderRemovalRequest)
      ).status
    ).toBe("pending");
    expect(await f.docs.select(envelope())).toMatchObject({
      ok: false,
      error: "BUSY",
    });
    expect(
      await f.workspace.request({ ...envelope(), op: "clear" })
    ).toMatchObject({ ok: false, error: "BUSY" });
    const a = await f.workspace.request({ ...envelope(), op: "state" });
    const b = await f.workspace.request({ ...envelope(), op: "state" });
    expect(a.ok && b.ok && a.assetEpochs).toEqual(b.ok && b.assetEpochs);
    expect(
      (await f.request({ ...f.operation, op: "query" }))
        .status
    ).toBe("pending");
    confirmed = true;
    expect(
      (await f.request({ ...f.operation, op: "query" }))
        .status
    ).toBe("committed");
    expect(
      (await f.docs.read({ ...envelope(), handle: f.snapshot.handle })).ok
    ).toBe(true);
  } finally {
    await f.cleanup();
  }
});
