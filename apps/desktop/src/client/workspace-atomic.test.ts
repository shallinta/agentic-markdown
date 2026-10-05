import { expect, test } from "bun:test";

import type {
  DirectoryReceipt,
  WorkspaceNode,
  WorkspaceRequest,
  WorkspaceRoot,
} from "../shared/workspace";

import { createFolderWorkspace } from "./workspace";

const root = (name: string, entries: number): WorkspaceRoot => ({
  handle: crypto.randomUUID(),
  name,
  displayPath: `/test/${name}`,
  generation: 1,
  entries,
  status: "complete",
  examined: entries,
  errors: 0,
  showHidden: false,
});
const node = (owner: WorkspaceRoot, index: number): WorkspaceNode => ({
  handle: `${owner.handle}-${owner.generation}-${index}`,
  parent: owner.handle,
  name: `${index}.md`,
  displayPath: `${owner.displayPath}/${index}.md`,
  kind: "file",
});

test("failed rescan preparation keeps its visible notice through ordinary polling until a successful retry", async () => {
  const a = root("a", 0);
  let failed = true;
  const operation = { session: crypto.randomUUID(), sequence: 1 };
  const client = createFolderWorkspace((request) => {
    const response = {
      protocolVersion: 1 as const,
      requestId: request.requestId,
      ok: true as const,
      roots: [{ ...a }],
      coveredHandles: [],
      cacheBytes: 0,
    };
    if (request.op === "prepareRescan")
      return Promise.resolve(
        failed
          ? {
              protocolVersion: 1,
              requestId: request.requestId,
              ok: false,
              error: "UNAVAILABLE",
            }
          : { ...response, operation }
      );
    if (request.op === "acceptRescan")
      return Promise.resolve({
        ...response,
        receipt: {
          status: "committed",
          root: a.handle,
          generation: a.generation,
        },
      });
    return Promise.resolve(response);
  });
  await client.refresh();
  const nodes = client.getSnapshot().nodes;
  await client.rescan(a.handle).catch(() => undefined);
  await Promise.resolve();
  const failure = client.getSnapshot().error;
  expect(failure).not.toBeNull();
  for (let i = 0; i < 3; i++) await client.refresh();
  expect(client.getSnapshot().error).toBe(failure);
  expect(client.getSnapshot().nodes).toBe(nodes);
  a.examined++;
  await client.refresh();
  expect(client.getSnapshot().error).toBe(failure);
  failed = false;
  await client.rescan(a.handle);
  expect(client.getSnapshot().error).toBeNull();
});

test("noncomplete restart clears a retained failure only after a successful response", async () => {
  const a = root("partial", 0);
  a.status = "partial";
  let failed = true;
  const client = createFolderWorkspace((request) => {
    if (request.op === "rescan" && failed)
      return Promise.resolve({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: false,
        error: "UNAVAILABLE",
      });
    return Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ok: true,
      roots: [{ ...a }],
      coveredHandles: [],
      cacheBytes: 0,
    });
  });
  await client.refresh();
  await client.rescan(a.handle).catch(() => undefined);
  await client.refresh();
  const failure = client.getSnapshot().error;
  expect(failure).not.toBeNull();
  await client.rescan(a.handle).catch(() => undefined);
  expect(client.getSnapshot().error).toBe(failure);
  failed = false;
  await client.rescan(a.handle);
  expect(client.getSnapshot().error).toBeNull();
});

test("captured immutable prefixes publish once despite another root growing; unchanged pages are reused", async () => {
  const a = root("a", 130),
    b = root("b", 1),
    empty = root("empty", 0);
  let growing = true,
    covered: string[] = [];
  const calls: string[] = [];
  const client = createFolderWorkspace((request) => {
    const roots = structuredClone([a, b, empty]);
    const response = {
      protocolVersion: 1 as const,
      requestId: request.requestId,
      ok: true as const,
      roots,
      coveredHandles: [...covered],
      cacheBytes: 100,
    };
    if (growing) {
      b.entries++;
      b.examined++;
      covered = ["later-covered"];
    }
    if (request.op !== "page") return Promise.resolve(response);
    const owner = [a, b, empty].find((item) => item.handle === request.root)!;
    const count = Math.min(
      128,
      roots.find((item) => item.handle === owner.handle)!.entries -
        request.cursor!
    );
    calls.push(`${owner.name}:${request.cursor}`);
    return Promise.resolve({
      ...response,
      root: owner.handle,
      generation: owner.generation,
      nodes: Array.from({ length: count }, (_, i) =>
        node(owner, request.cursor! + i)
      ),
      nextCursor: request.cursor! + count,
    });
  });
  const observations: number[] = [];
  client.subscribe(() =>
    observations.push(client.getSnapshot().nodes[a.handle]?.length ?? 0)
  );
  await client.refresh();
  expect(observations).toEqual([130]);
  expect(
    client.getSnapshot().roots.find((item) => item.handle === b.handle)!.entries
  ).toBe(1);
  expect(client.getSnapshot().nodes[b.handle]).toHaveLength(1);
  expect(client.getSnapshot().nodes[empty.handle]).toEqual([]);
  expect(client.getSnapshot().coveredHandles).toEqual([]);
  expect(calls).toEqual(["a:0", "a:128", "b:0"]);
  growing = false;
  const aNodes = client.getSnapshot().nodes[a.handle];
  calls.length = 0;
  await client.refresh();
  expect(calls).toEqual(["b:1"]);
  expect(client.getSnapshot().nodes[a.handle]).toBe(aNodes);
  calls.length = 0;
  await client.refresh();
  expect(calls).toEqual([]);
  a.generation++;
  await client.refresh();
  expect(calls).toEqual(["a:0", "a:128"]);
});

test("malformed parent, duplicate, nonadvancing and shortened snapshots retain the old tree", async () => {
  for (const defect of [
    "parent",
    "duplicate",
    "empty",
    "shorten",
    "generation",
    "budget",
  ] as const) {
    const a = root("a", 1);
    let broken = false;
    const client = createFolderWorkspace((request) => {
      const meta = { ...a };
      const response = {
        protocolVersion: 1 as const,
        requestId: request.requestId,
        ok: true as const,
        roots: [meta],
        coveredHandles: [],
        cacheBytes: 0,
      };
      if (request.op !== "page") return Promise.resolve(response);
      let nodes = Array.from({ length: a.entries - request.cursor! }, (_, i) =>
        node(a, request.cursor! + i)
      );
      if (broken) {
        if (defect === "parent") nodes[0].parent = nodes[0].handle;
        if (defect === "duplicate") nodes = [node(a, 0)];
        if (defect === "empty") nodes = [];
        if (defect === "shorten") meta.entries = 0;
        if (defect === "generation") meta.generation++;
        if (defect === "budget")
          nodes = Array.from({ length: 128 }, (_, i) => ({
            ...node(a, i),
            name: "x".repeat(4096),
            displayPath: "x".repeat(4096),
          }));
      }
      return Promise.resolve({
        ...response,
        root: a.handle,
        generation: a.generation,
        nodes,
        nextCursor: request.cursor! + nodes.length,
      });
    });
    await client.refresh();
    const previous = client.getSnapshot().nodes;
    broken = true;
    a.entries = defect === "budget" ? 400 : 2;
    expect(
      await client.refresh().catch((error) => error instanceof Error)
    ).toBe(true);
    expect(client.getSnapshot().nodes).toBe(previous);
  }
});

test("lost acceptance only queries its original operation; unknown does not freeze other roots and confirmed failures release pending", async () => {
  const a = root("a", 0),
    b = root("b", 0);
  let roots = [a],
    outcome: DirectoryReceipt = { status: "issued" };
  const operation = { session: crypto.randomUUID(), sequence: 1 };
  const calls: WorkspaceRequest[] = [];
  const client = createFolderWorkspace((request) => {
    calls.push(structuredClone(request));
    const response = {
      protocolVersion: 1 as const,
      requestId: request.requestId,
      ok: true as const,
      roots: structuredClone(roots),
      coveredHandles: [],
      cacheBytes: 0,
    };
    if (request.op === "prepareRescan")
      return Promise.resolve({ ...response, operation });
    if (request.op === "acceptRescan")
      return Promise.reject(Error("lost acknowledgement"));
    if (request.op === "queryRescan")
      return Promise.resolve({ ...response, receipt: outcome });
    if (request.op === "select") roots = [a, b];
    if (request.op === "hidden") {
      a.showHidden = request.showHidden;
      a.generation++;
    }
    return Promise.resolve(response);
  });
  await client.refresh();
  await client.rescan(a.handle).catch(() => undefined);
  for (const status of ["issued", "unknown", "pending"] as const) {
    outcome = { status };
    await client.rescan(a.handle).catch(() => undefined);
  }
  await client.select();
  expect(client.getSnapshot().roots).toHaveLength(2);
  expect(client.getSnapshot().error).toContain("未确认");
  expect(calls.filter((item) => item.op === "acceptRescan")).toHaveLength(1);
  expect(calls.filter((item) => item.op === "prepareRescan")).toHaveLength(1);
  expect(
    calls
      .filter((item) => item.op === "queryRescan")
      .every(
        (item) => JSON.stringify(item.operation) === JSON.stringify(operation)
      )
  ).toBe(true);
  outcome = { status: "rejected", reason: "INVALIDATED" };
  await client.refresh();
  await client.setHidden(a.handle, true);
  expect(client.getSnapshot().roots[0].showHidden).toBe(true);
  const queries = calls.filter((item) => item.op === "queryRescan").length;
  await client.refresh();
  expect(calls.filter((item) => item.op === "queryRescan")).toHaveLength(
    queries
  );
});

test("poll-confirmed commit followed by staging failure retains committed fact", async () => {
  const a = root("a", 0);
  const operation = { session: crypto.randomUUID(), sequence: 1 };
  const client = createFolderWorkspace((request) => {
    const response = {
      protocolVersion: 1 as const,
      requestId: request.requestId,
      ok: true as const,
      roots: [{ ...a }],
      coveredHandles: [],
      cacheBytes: 0,
    };
    if (request.op === "prepareRescan")
      return Promise.resolve({ ...response, operation });
    if (request.op === "acceptRescan") {
      a.generation++;
      a.entries = 1;
      return Promise.reject(Error("lost"));
    }
    if (request.op === "queryRescan")
      return Promise.resolve({
        ...response,
        receipt: {
          status: "committed" as const,
          root: a.handle,
          generation: a.generation,
        },
      });
    if (request.op === "page") return Promise.reject(Error("page failed"));
    return Promise.resolve(response);
  });
  await client.refresh();
  await client.rescan(a.handle).catch(() => undefined);
  await client.refresh().catch(() => undefined);
  await Promise.resolve();
  expect(client.getSnapshot().error).toContain("后台重扫已完成");
  expect(client.getSnapshot().roots[0].generation).toBe(1);
});
