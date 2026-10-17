import { expect, test } from "bun:test";

import { isCommand, PRODUCT_COMMANDS } from "../shared/commands";
import type { WorkspaceRevealRequest } from "../shared/workspace";

import { createWorkspaceReveal, workspaceRevealTarget } from "./workspace-reveal";
import type { TreeItem } from "./workspace-tree-model";

const target = { type: "workspace" as const, root: "root", generation: 1, entry: "entry" };
function fixture() {
  let allowed = true;
  const calls: WorkspaceRevealRequest[] = [], cancellations: string[] = [];
  const replies: ((value: unknown) => void)[] = [];
  const owner = createWorkspaceReveal({
    available: () => allowed,
    nextId: () => `request-${calls.length}`,
    reveal: (request) => { calls.push(request); return new Promise((resolve) => replies.push(resolve)); },
    cancel: (request) => { cancellations.push(request.requestId); return Promise.resolve(); },
  });
  return { owner, calls, cancellations, replies, block: () => { allowed = false; owner.checkAvailability(); } };
}
test("selection-only target projection never forwards path and no selection remains null", () => {
  expect(workspaceRevealTarget(undefined)).toBeNull();
  const root = { handle: "root", name: "name", displayPath: "/display-only", generation: 2, status: "complete" as const, examined: 1, errors: 0, entries: 1 };
  const item: TreeItem = { key: "root:root", parent: null, rootKey: "root:root", level: 1, name: "name", path: "/untrusted", directory: true, kind: "root", root };
  expect(workspaceRevealTarget(item)).toEqual({ type: "workspace", root: "root", generation: 2 });
  expect(workspaceRevealTarget({ ...item, kind: "node", node: { handle: "node", parent: "root", name: "child", displayPath: "/untrusted/child", kind: "directory" } })).toEqual({ type: "workspace", root: "root", generation: 2, entry: "node" });
});
test("single flight dispatch does not need any document activation or save capability", async () => {
  const f = fixture();
  await f.owner.run(); expect(f.calls).toHaveLength(0);
  f.owner.setTarget(target);
  const done = f.owner.run(); await f.owner.run();
  expect(f.calls).toHaveLength(1); expect(f.owner.canRun()).toBe(false);
  expect(f.calls[0].target).toEqual(target);
  f.replies[0]({ protocolVersion: 1, requestId: f.calls[0].requestId, ok: true, snapshot: null }); await done;
  expect(f.owner.getSnapshot()).toEqual({ busy: false, error: "" });
});
test("changed generation cancels old request and rejects its late error", async () => {
  const f = fixture(); f.owner.setTarget(target); const done = f.owner.run();
  f.owner.setTarget({ ...target, generation: 2 });
  expect(f.cancellations).toEqual(["request-0"]);
  f.replies[0]({ protocolVersion: 1, requestId: "request-0", ok: false, error: "READ_FAILED" }); await done;
  expect(f.owner.getSnapshot().error).toBe(""); expect(f.owner.canRun()).toBe(true);
});
test("IME/save/frozen availability cancellation, target loss and disposal cannot dispatch late", async () => {
  const f = fixture(); f.owner.setTarget(target); const done = f.owner.run(); f.block();
  expect(f.cancellations).toEqual(["request-0"]); expect(f.owner.canRun()).toBe(false);
  f.replies[0](null); await done; expect(f.owner.getSnapshot().error).toBe("");
  f.owner.setTarget(null); f.owner.dispose(); await f.owner.run(); expect(f.calls).toHaveLength(1);
});
test("invalid replies produce fixed local errors, successful void dispatch has no success claim", async () => {
  const f = fixture(); f.owner.setTarget({ type: "document", handle: "file" }); const done = f.owner.run();
  f.replies[0]({ protocolVersion: 1, requestId: "other", ok: true, snapshot: null }); await done;
  expect(f.owner.getSnapshot().error).toContain("无法发起 Finder");
  f.owner.setTarget(null); expect(f.owner.getSnapshot().error).toBe("");
});
test("unmount cancels pending; effect reattach uses fresh selected target without accepting old response", async () => {
  const f = fixture(); f.owner.setTarget(target); const done = f.owner.run(); f.owner.dispose();
  f.owner.attach(); f.owner.setTarget({ type: "document", handle: "next" });
  f.replies[0](null); await done; expect(f.owner.getSnapshot().error).toBe(""); expect(f.cancellations).toHaveLength(1);
});
test("uniform selected-item command uses no arguments or implicit path", () => {
  expect(isCommand({ type: "revealWorkspaceItem", args: {} })).toBe(true);
  expect(isCommand({ type: "revealWorkspaceItem", args: { path: "/tmp" } })).toBe(false);
  expect(PRODUCT_COMMANDS.revealWorkspaceItem?.label).toBe("在 Finder 中显示选中项");
});

test("default open is file-only and shares the Finder in-flight slot", async () => {
  const calls: string[] = [];
  let resolve: (value: unknown) => void = () => undefined;
  const owner = createWorkspaceReveal({
    available: () => true,
    reveal: () => { calls.push("reveal"); return new Promise((r) => { resolve = r; }); },
    openDefault: (request) => { calls.push("default"); expect(Object.keys(request.target).sort()).toEqual(["entry", "generation", "root", "type"]); return new Promise((r) => { resolve = r; }); },
    cancel: () => Promise.resolve(), nextId: () => "action",
  });
  owner.setTarget(target); await owner.runDefault(); expect(calls).toEqual([]);
  owner.setTarget(target, true);
  const opened = owner.runDefault(); await owner.run(); await owner.runDefault();
  expect(calls).toEqual(["default"]); expect(owner.canRun()).toBe(false);
  resolve({ protocolVersion: 1, requestId: "action", ok: true, snapshot: null }); await opened;
  expect(owner.getSnapshot()).toEqual({ busy: false, error: "" });
  const revealed = owner.run(); await owner.runDefault(); expect(calls).toEqual(["default", "reveal"]);
  resolve({ protocolVersion: 1, requestId: "action", ok: true, snapshot: null }); await revealed;
});

test("file eligibility loss with identical opaque target cancels default open and suppresses stale feedback", async () => {
  const cancelled: string[] = [];
  let resolve: (value: unknown) => void = () => undefined;
  const owner = createWorkspaceReveal({
    available: () => true, nextId: () => "default-request",
    reveal: () => Promise.resolve(),
    openDefault: () => new Promise((r) => { resolve = r; }),
    cancel: (r) => { cancelled.push(r.requestId); return Promise.resolve(); },
  });
  owner.setTarget(target, true); const done = owner.runDefault();
  owner.setTarget(target, false);
  expect(cancelled).toEqual(["default-request"]); expect(owner.canRunDefault()).toBe(false); expect(owner.canRun()).toBe(true);
  resolve({ protocolVersion: 1, requestId: "default-request", ok: false, error: "READ_FAILED" }); await done;
  expect(owner.getSnapshot().error).toBe("");
});

test("default action errors remain specific and retry can be accepted without success claims", async () => {
  let attempt = 0;
  const owner = createWorkspaceReveal({
    available: () => true,
    reveal: () => Promise.resolve(), cancel: () => Promise.resolve(),
    openDefault: (r) => {
      attempt++;
      if (attempt === 1) return Promise.reject(new Error("private system path"));
      return Promise.resolve({ protocolVersion: 1, requestId: r.requestId, ok: attempt > 2, ...(attempt > 2 ? { snapshot: null } : { error: "READ_FAILED" }) });
    },
  });
  owner.setTarget({ type: "document", handle: "standalone" }, true);
  await owner.runDefault(); expect(owner.getSnapshot().error).toBe("默认应用打开请求失败，请重试。");
  await owner.runDefault(); expect(owner.getSnapshot().error).toContain("无法用默认应用");
  await owner.runDefault(); expect(owner.getSnapshot().error).toBe("");
  expect(isCommand({ type: "openDefaultWorkspaceItem", args: {} })).toBe(true);
  expect(isCommand({ type: "openDefaultWorkspaceItem", args: { action: "reveal" } })).toBe(false);
});
