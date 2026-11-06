import { expect, test } from "bun:test";

import type { RasterPasteRequest } from "../shared/raster-paste";
import type { WorkspaceRoot } from "../shared/workspace";

import { captureRasterWorkspaceAuthority, createRasterPasteTransport } from "./raster-paste-workspace";
import type { FolderState } from "./workspace";

const source = { handle: "opaque-handle", documentId: "opaque-doc", expectedRevision: 3, expectedHash: "hash" };
const path = "./assets/image-a1234567-a123-4123-8123-0123456789ab.jpg";
const bytes = new Uint8Array([255, 0, 19, 4]);

function root(handle: string, displayPath: string): WorkspaceRoot {
  return { handle, displayPath, name: handle, generation: 4, status: "complete", examined: 1, errors: 0, entries: 1 };
}

test("captures only an exactly covered handle with a known asset epoch and containing root generations", () => {
  const roots = [root("a", "/root/a"), root("b", "/root/b")];
  let state: FolderState = { roots, nodes: {}, busy: false, error: null,
    coveredHandles: [source.handle], assetEpochs: { [source.handle]: "epoch" } };
  const listeners = new Set<() => void>();
  const workspace = {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
  const put = (next: FolderState) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  const target = "/root/a/文档.md";
  expect(captureRasterWorkspaceAuthority(workspace, source.handle, "/root/aa/文档.md")).toBeUndefined();
  expect(captureRasterWorkspaceAuthority(workspace, "other", target)).toBeUndefined();
  const ticket = captureRasterWorkspaceAuthority(workspace, source.handle, target)!;
  const observed: boolean[] = [];
  const off = ticket.subscribe(() => { observed.push(ticket.current()); });
  put({ ...state, roots: [{ ...roots[1], generation: 5 }, roots[0]] });
  put({ ...state, roots: [{ ...roots[0], generation: 5 }, roots[1]] });
  put({ ...state, roots });
  put({ ...state, assetEpochs: { [source.handle]: "new" } });
  expect(observed).toEqual([true, false, true, false]);
  off();
  put({ ...state, coveredHandles: [] });
  expect(listeners.size).toBe(0);
  expect(captureRasterWorkspaceAuthority(workspace, source.handle, target)).toBeUndefined();
});

test("allocates a current window sequence and only rereads floor after an explicit stale reply", async () => {
  let floorCalls = 0;
  const requests: RasterPasteRequest[] = [];
  const transport = createRasterPasteTransport({
    getFloor: () => Promise.resolve({ ok: true, sequence: ++floorCalls === 1 ? 40 : 80 }),
    publish: request => {
      requests.push(request);
      return Promise.resolve(request.sequence === 42
        ? { ok: false, requestId: request.requestId, error: "STALE" }
        : { ok: true, requestId: request.requestId, relativePath: path });
    },
  });
  expect(await transport(source, bytes, () => true)).toMatchObject({ ok: true, relativePath: path });
  expect(await transport(source, bytes, () => true)).toMatchObject({ ok: false, error: "STALE" });
  expect(floorCalls).toBe(1);
  expect(requests.map(request => request.sequence)).toEqual([41, 42]);
  expect(await transport(source, bytes, () => true)).toMatchObject({ ok: true, relativePath: path });
  expect(floorCalls).toBe(2);
  expect(requests.map(request => request.sequence)).toEqual([41, 42, 81]);
  expect(requests[0]).toEqual({ ...source, protocolVersion: 1, requestId: requests[0].requestId, sequence: 41, data: "/wATBA==" });
});

test("does not send a write if the initial floor wait loses the captured intent", async () => {
  let current = true;
  let send = 0;
  const transport = createRasterPasteTransport({
    getFloor: () => { current = false; return Promise.resolve({ ok: true, sequence: 10 }); },
    publish: () => { send++; return Promise.resolve(undefined); },
  });
  expect(await transport(source, bytes, () => current)).toEqual({ ok: false, error: "CANCELLED" });
  expect(send).toBe(0);
});

test("does not accept a stale-ID success or convert an uncertain write to a business rejection", async () => {
  let reply = 0;
  const transport = createRasterPasteTransport({
    getFloor: () => Promise.resolve({ ok: true, sequence: 0 }),
    publish: () => {
      if (++reply === 1) return Promise.resolve({ ok: true, requestId: crypto.randomUUID(), relativePath: path });
      return Promise.reject(Error("synthetic timeout"));
    },
  });
  expect(await transport(source, bytes, () => true)).toBeUndefined();
  const timeout = await transport(source, bytes, () => true).catch((error: unknown) => error);
  expect(timeout).toBeInstanceOf(Error);
  expect((timeout as Error).message).toBe("synthetic timeout");
  const blocked = createRasterPasteTransport({
    getFloor: () => Promise.resolve({ ok: true, sequence: Number.MAX_SAFE_INTEGER }),
    publish: () => { throw Error("must not send"); },
  });
  expect(await blocked(source, bytes, () => true)).toEqual({ ok: false, error: "UNAVAILABLE" });
});
