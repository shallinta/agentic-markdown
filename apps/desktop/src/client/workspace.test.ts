import { expect, test } from "bun:test";

import type { WorkspaceRoot, WorkspaceNode } from "../shared/workspace";

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

test("workspace pages incrementally merge, generation and root removal discard derived nodes", async () => {
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
  const client = createFolderWorkspace(async (request) => {
    calls++;
    if (request.op === "state") await gate;
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      roots: [],
      coveredHandles: request.op === "state" ? ["stale"] : [],
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
  expect(calls).toBe(2);
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
  expect(client.getSnapshot().nodes.root).toEqual([]);
});
