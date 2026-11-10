import { expect, test } from "bun:test";

import type { WorkspaceRoot, WorkspaceNode, WorkspaceRequest, WorkspaceResponse } from "../shared/workspace";

import { createFolderWorkspace } from "./workspace";

test("asset epochs are metadata only and malformed epochs cannot enter state", async () => {
  const handle = crypto.randomUUID();
  let epoch: string = crypto.randomUUID();
  const client = createFolderWorkspace((request) =>
    Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      roots: [],
      coveredHandles: [],
      cacheBytes: 0,
      assetEpochs: { [handle]: epoch },
    })
  );
  await client.refresh();
  expect(client.getSnapshot().assetEpochs?.[handle]).toBe(epoch);
  const next = crypto.randomUUID();
  epoch = next;
  await client.refresh();
  expect(client.getSnapshot().assetEpochs?.[handle]).toBe(next);
  epoch = "not-an-epoch";
  await client.refresh().catch(() => undefined);
  expect(client.getSnapshot().assetEpochs?.[handle]).toBe(next);
  client.dispose();
});

test("workspace refresh stages complete captured pages and generation changes replace derived nodes atomically", async () => {
  let root: WorkspaceRoot = {
    handle: "root",
    name: "目录",
    displayPath: "/example",
    generation: 1,
    status: "scanning",
    examined: 2,
    errors: 0,
    entries: 2,
  };
  let roots = [root];
  const node = (handle: string): WorkspaceNode => ({
    handle,
    parent: root.handle,
    name: handle,
    kind: "file",
    displayPath: `/example/${handle}.md`,
  });
  const cursors: number[] = [];
  const client = createFolderWorkspace((request) => {
    const reply = {
      protocolVersion: 1 as const,
      requestId: request.requestId,
      ok: true as const,
      roots,
      coveredHandles: ["existing"],
      cacheBytes: 1,
    };
    if (request.op !== "page") return Promise.resolve(reply);
    cursors.push(request.cursor!);
    return Promise.resolve({
      ...reply,
      root: root.handle,
      generation: root.generation,
      nodes: [node(`${root.generation}-${request.cursor}`)],
      nextCursor: request.cursor! + 1,
    });
  });
  await client.refresh();
  await client.refresh();
  expect(cursors).toEqual([0, 1]);
  expect(client.getSnapshot().nodes.root).toHaveLength(2);
  root = { ...root, generation: 2, status: "paused", entries: 1 };
  roots = [root];
  await client.refresh();
  expect(client.getSnapshot().nodes.root.map((node) => node.handle)).toEqual([
    "2-0",
  ]);
  expect(client.getSnapshot().roots[0].status).toBe("paused");
  roots = [];
  await client.refresh();
  expect(client.getSnapshot().nodes).toEqual({});
});

test("workspace failure preserves data and rejects clear; dispose drops late result", async () => {
  let fail = false;
  const client = createFolderWorkspace((request) => {
    if (fail) return Promise.reject(new Error("private-path"));
    return Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      roots: [],
      coveredHandles: [],
      cacheBytes: 0,
    });
  });
  await client.refresh();
  fail = true;
  expect(await client.clear().catch((error) => error instanceof Error)).toBe(
    true
  );
  await Promise.resolve();
  expect(client.getSnapshot().error).not.toContain("private-path");
  const previous = client.getSnapshot();
  client.dispose();
  await client.refresh();
  expect(client.getSnapshot()).toBe(previous);
});

test("refresh calls coalesce and clear fences a late state response", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  let cleared = false;
  const client = createFolderWorkspace(async (request) => {
    calls++;
    if (request.op === "clear") cleared = true;
    if (request.op === "state") await gate;
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      roots: [],
      coveredHandles: cleared ? [] : ["stale"],
      cacheBytes: 0,
    };
  });
  const first = client.refresh();
  expect(client.refresh()).toBe(first);
  await Promise.resolve();
  const clearing = client.clear();
  release();
  await first;
  await clearing;
  expect(calls).toBe(3);
  expect(client.getSnapshot().coveredHandles).toEqual([]);
});

test("invalid page metadata is rejected without caching supplied nodes", async () => {
  const root: WorkspaceRoot = {
    handle: "root",
    name: "目录",
    displayPath: "/example",
    generation: 1,
    status: "complete",
    examined: 1,
    errors: 0,
    entries: 1,
  };
  const client = createFolderWorkspace((request) =>
    Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      roots: [root],
      coveredHandles: [],
      cacheBytes: 1,
      ...(request.op === "page"
        ? { root: "root", generation: 1, nodes: [], nextCursor: 55 }
        : {}),
    })
  );
  expect(await client.refresh().catch((error) => error instanceof Error)).toBe(
    true
  );
  expect(client.getSnapshot().nodes.root).toBeUndefined();
});

const selectedFixture = (): WorkspaceRoot => ({
  handle: crypto.randomUUID(), name: "测试目录", displayPath: "/test-directory", generation: 1,
  status: "scanning", examined: 0, errors: 0, entries: 0,
});
const workspaceReply = (request: WorkspaceRequest, roots: WorkspaceRoot[]): Extract<WorkspaceResponse, { ok: true }> =>
  ({ protocolVersion: 1, requestId: request.requestId, ok: true, roots, coveredHandles: [], cacheBytes: 0 });

test("selection receipt is tied to the reported new root and survives same-generation scanning", async () => {
  let root = selectedFixture();
  let selecting = true;
  const client = createFolderWorkspace((request) => {
    const reply = workspaceReply(request, [root]);
    return Promise.resolve(request.op === "select" && selecting
      ? { ...reply, selectedRoot: { handle: root.handle, generation: root.generation } }
      : reply);
  });
  const selected = await client.selectWithReceipt();
  expect(selected).toMatchObject({ handle: root.handle, generation: 1 });
  expect(Object.keys(selected ?? {}).sort()).toEqual(["current", "generation", "handle"]);
  expect(selected?.current()).toBe(true);
  root = { ...root, status: "complete", examined: 2 };
  await client.refresh();
  expect(selected?.current()).toBe(true);
  root = { ...root, generation: 2 };
  await client.refresh();
  expect(selected?.current()).toBe(false);
  selecting = false;
  expect(await client.select()).toBeUndefined();
  client.dispose();
});

test("selection never infers a receipt from roots and rejects an existing root reported as new", async () => {
  const root = selectedFixture();
  let claimsNew = false;
  const client = createFolderWorkspace((request) => {
    const reply = workspaceReply(request, [root]);
    return Promise.resolve(request.op === "select" && claimsNew
      ? { ...reply, selectedRoot: { handle: root.handle, generation: root.generation } }
      : reply);
  });
  expect(await client.selectWithReceipt()).toBeUndefined();
  expect(client.getSnapshot().roots.map(item => item.handle)).toEqual([root.handle]);
  claimsNew = true;
  expect(await client.selectWithReceipt()).toBeUndefined();
  client.dispose();
});

test("malformed, wrong-request and non-selection receipt fields never publish", async () => {
  const root = selectedFixture();
  const claimed = { handle: root.handle, generation: root.generation };
  for (const change of [
    { selectedRoot: { ...claimed, generation: 2 } },
    { selectedRoot: { ...claimed, handle: crypto.randomUUID() } },
    { selectedRoot: { ...claimed, extra: true } },
    { selectedRoot: claimed, requestId: "not-this-request" },
  ]) {
    const client = createFolderWorkspace((request) => Promise.resolve({ ...workspaceReply(request, [root]), ...change }));
    expect(await client.selectWithReceipt()).toBeUndefined();
    expect(client.getSnapshot().roots).toEqual([]);
    expect(client.getSnapshot().error).not.toBeNull();
    client.dispose();
  }
  const client = createFolderWorkspace((request) => Promise.resolve({ ...workspaceReply(request, [root]), selectedRoot: claimed }));
  expect(await client.refresh().catch((error: unknown) => error)).toEqual(Error("workspace-request"));
  expect(client.getSnapshot().roots).toEqual([]);
  client.dispose();
});

test.each(["select", "hidden", "rescan"] as const)("a newer %s intent invalidates the prior receipt before RPC settlement", async (operation) => {
  const root = selectedFixture();
  let selected = false;
  const mutation = Promise.withResolvers<void>();
  const client = createFolderWorkspace(async (request) => {
    if (selected && request.op === operation) await mutation.promise;
    const reply = workspaceReply(request, [root]);
    if (request.op !== "select" || selected) return reply;
    selected = true;
    return { ...reply, selectedRoot: { handle: root.handle, generation: root.generation } };
  });
  const receipt = await client.selectWithReceipt();
  expect(receipt?.current()).toBe(true);
  const next = operation === "select" ? client.select() : operation === "hidden" ? client.setHidden(root.handle, true) : client.rescan(root.handle);
  expect(receipt?.current()).toBe(false);
  mutation.resolve();
  await next;
  expect(receipt?.current()).toBe(false);
  client.dispose();
});

test("selection receipt is withheld when the first refreshed root is already a newer generation", async () => {
  const root = selectedFixture();
  const client = createFolderWorkspace((request) => Promise.resolve(request.op === "select"
    ? { ...workspaceReply(request, [root]), selectedRoot: { handle: root.handle, generation: 1 } }
    : workspaceReply(request, [{ ...root, generation: 2 }])));
  expect(await client.selectWithReceipt()).toBeUndefined();
  expect(client.getSnapshot().roots[0].generation).toBe(2);
  client.dispose();
});

test.each(["clear", "dispose"] as const)("%s fences a native selection that is still pending", async (operation) => {
  const root = selectedFixture();
  const started = Promise.withResolvers<void>();
  const selected = Promise.withResolvers<void>();
  const client = createFolderWorkspace(async (request) => {
    if (request.op !== "select") return workspaceReply(request, []);
    started.resolve();
    await selected.promise;
    return { ...workspaceReply(request, [root]), selectedRoot: { handle: root.handle, generation: root.generation } };
  });
  const selection = client.selectWithReceipt();
  await started.promise;
  const invalidating = operation === "clear" ? client.clear() : Promise.resolve(client.dispose());
  selected.resolve();
  expect(await selection).toBeUndefined();
  await invalidating;
  expect(client.getSnapshot().roots).toEqual([]);
  client.dispose();
});
