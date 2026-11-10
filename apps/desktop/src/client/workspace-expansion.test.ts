import { expect, test } from "bun:test";

import type { WorkspaceNode, WorkspaceRoot } from "../shared/workspace";
import type { WorkspaceExpansionRequest } from "../shared/workspace-expansion";

import type { FolderState } from "./workspace";
import { createWorkspaceExpansion } from "./workspace-expansion";

const id = (n: number) =>
  `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const a = id(1),
  b = id(2),
  d = id(3),
  later = id(4),
  file = id(5);
const root = (
  handle: string,
  entries: number,
  generation = 1
): WorkspaceRoot => ({
  handle,
  entries,
  generation,
  name: "同名",
  displayPath: "/同名",
  status: "scanning",
  examined: entries,
  errors: 0,
});
const node = (
  handle: string,
  parent: string,
  kind: WorkspaceNode["kind"] = "directory"
): WorkspaceNode => ({
  handle,
  parent,
  kind,
  name: "节点",
  displayPath: "/同名/节点",
});
const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function setup() {
  const listeners = new Set<() => void>();
  let state: FolderState = {
    roots: [],
    nodes: {},
    coveredHandles: [],
    busy: false,
    error: null,
  };
  const folders = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  function publish(next: Partial<FolderState>) {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  }
  let warnings = 0;
  const calls: {
    input: WorkspaceExpansionRequest;
    resolve: (reply: unknown) => void;
  }[] = [];
  const controller = createWorkspaceExpansion(
    folders,
    (input) =>
      new Promise((resolve) => {
        calls.push({ input, resolve });
      }),
    () => {
      warnings++;
    }
  );
  function reply(index: number, overrides: Record<string, unknown> = {}) {
    const { input, resolve } = calls[index];
    const { protocolVersion, op, root, generation } = input;
    resolve({
      protocolVersion,
      ok: true,
      op,
      root,
      generation,
      ...(op === "read" ? { collapsed: false, expanded: [] } : {}),
      ...overrides,
    });
  }
  return { controller, calls, reply, publish, warnings: () => warnings };
}

test("serial reads coalesce pages, expose only current published directory handles, and keep stable snapshots", async () => {
  const { controller, calls, reply, publish } = setup();
  const detach = controller.attach();
  let notifications = 0;
  const stop = controller.subscribe(() => {
    notifications++;
  });
  publish({
    roots: [root(a, 2), root(b, 0)],
    nodes: { [a]: [node(d, a), node(file, a, "file")] },
  });
  expect(calls.map(({ input }) => input.root)).toEqual([a]);
  const initial = controller.getSnapshot();
  publish({ busy: true });
  publish({ busy: false });
  expect(controller.getSnapshot()).toBe(initial);
  const extraFile = node(id(6), a, "file");
  publish({
    roots: [root(a, 3), root(b, 0)],
    nodes: { [a]: [node(d, a), node(file, a, "file"), extraFile] },
  });
  expect(controller.getSnapshot()).toBe(initial);
  reply(0, { expanded: [d, file, later, id(99)] });
  await tick();
  expect(controller.getSnapshot().get(a)?.expanded).toEqual(new Set([d]));
  expect(calls.map(({ input }) => input.root)).toEqual([a, b]);
  publish({
    roots: [root(a, 4), root(b, 0)],
    nodes: {
      [a]: [node(d, a), node(file, a, "file"), extraFile, node(later, d)],
    },
  });
  expect(controller.getSnapshot().get(a)?.expanded).toEqual(
    new Set([d, later])
  );
  publish({
    roots: [root(a, 5), root(b, 0)],
    nodes: {
      [a]: [
        node(d, a),
        node(file, a, "file"),
        extraFile,
        node(later, d),
        node(id(7), a),
      ],
    },
  });
  const withLater = controller.getSnapshot();
  expect(calls).toHaveLength(2);
  reply(1);
  await tick();
  expect(calls.map(({ input }) => input.root)).toEqual([a, b, a]);
  reply(2, { expanded: [later, d] });
  await tick();
  expect(controller.getSnapshot()).toBe(withLater);
  expect(notifications).toBe(3);
  stop();
  detach();
});

test("manual collapses win over a late restore and writes dispatch in order without waiting for a read", async () => {
  const { controller, calls, reply, publish } = setup();
  publish({ roots: [root(a, 1)], nodes: { [a]: [node(d, a)] } });
  const detach = controller.attach();
  expect(controller.setManual(a, 1, true, d)).toBe(true);
  expect(controller.getSnapshot().get(a)?.expanded.has(d)).toBe(true);
  expect(controller.setManual(a, 1, false, d)).toBe(true);
  expect(controller.setManual(a, 1, true)).toBe(true);
  expect(controller.setManual(a, 1, true, id(99))).toBe(false);
  expect(controller.setManual(a, 2, false)).toBe(false);
  expect(calls.map(({ input }) => input)).toEqual([
    { protocolVersion: 1, op: "read", root: a, generation: 1 },
    {
      protocolVersion: 1,
      op: "set",
      root: a,
      generation: 1,
      directory: d,
      expanded: true,
    },
    {
      protocolVersion: 1,
      op: "set",
      root: a,
      generation: 1,
      directory: d,
      expanded: false,
    },
    { protocolVersion: 1, op: "set", root: a, generation: 1, expanded: true },
  ]);
  reply(3);
  reply(2);
  reply(1);
  reply(0, { collapsed: true, expanded: [d] });
  await tick();
  expect(controller.getSnapshot().get(a)).toEqual({
    generation: 1,
    collapsed: false,
    expanded: new Set(),
  });
  expect(calls).toHaveLength(4);
  detach();
});

test("retry waits for new published nodes or roster notification, and stale generations and attachments do not project", async () => {
  const { controller, calls, reply, publish } = setup();
  publish({ roots: [root(a, 0)] });
  const detach = controller.attach();
  const unavailable = { protocolVersion: 1, ok: false, error: "unavailable" };
  calls[0].resolve(unavailable);
  await tick();
  publish({ roots: [root(a, 0)] });
  expect(calls).toHaveLength(1);
  controller.refresh();
  expect(calls).toHaveLength(2);
  controller.refresh();
  calls[1].resolve(unavailable);
  await tick();
  expect(calls).toHaveLength(3);
  publish({ roots: [root(a, 1, 2)], nodes: { [a]: [node(later, a)] } });
  reply(2, { collapsed: true, expanded: [later] });
  await tick();
  expect(calls[3].input.generation).toBe(2);
  expect(controller.getSnapshot().get(a)).toEqual({
    generation: 2,
    collapsed: false,
    expanded: new Set(),
  });
  detach();
  const detachAgain = controller.attach();
  expect(calls).toHaveLength(4);
  reply(3, { collapsed: true, expanded: [later] });
  await tick();
  expect(calls).toHaveLength(5);
  expect(controller.getSnapshot().get(a)?.collapsed).toBe(false);
  reply(4, { collapsed: true, expanded: [later] });
  await tick();
  expect(controller.getSnapshot().get(a)?.expanded).toEqual(new Set([later]));
  expect(controller.getSnapshot().get(a)?.collapsed).toBe(true);
  detachAgain();
});

test("manual changes remain local on write failure, and removed roots have no late warning", async () => {
  const { controller, calls, reply, publish, warnings } = setup();
  const detach = controller.attach();
  publish({ roots: [root(a, 1)], nodes: { [a]: [node(d, a)] } });
  reply(0);
  await tick();
  expect(controller.setManual(a, 1, false)).toBe(true);
  calls[1].resolve({ protocolVersion: 1, ok: false, error: "unavailable" });
  await tick();
  expect(warnings()).toBe(1);
  expect(controller.getSnapshot().get(a)?.collapsed).toBe(true);
  expect(controller.setManual(a, 1, true)).toBe(true);
  expect(controller.setManual(a, 1, true, d)).toBe(true);
  publish({ roots: [], nodes: {} });
  expect(controller.getSnapshot().has(a)).toBe(false);
  calls[2].resolve({ protocolVersion: 1, ok: false, error: "stale" });
  calls[3].resolve({ protocolVersion: 1, ok: false, error: "stale" });
  await tick();
  expect(warnings()).toBe(1);
  expect(calls).toHaveLength(4);
  detach();
});

test("in-flight writes are bounded and excess changes still apply locally", async () => {
  const { controller, calls, reply, publish, warnings } = setup();
  const dirs = Array.from({ length: 65 }, (_, index) => id(100 + index));
  const detach = controller.attach();
  publish({
    roots: [root(a, dirs.length)],
    nodes: { [a]: dirs.map((dir) => node(dir, a)) },
  });
  for (const dir of dirs)
    expect(controller.setManual(a, 1, true, dir)).toBe(true);
  expect(controller.getSnapshot().get(a)?.expanded.has(dirs[64])).toBe(true);
  expect(warnings()).toBe(1);
  expect(calls).toHaveLength(65);
  reply(1);
  await tick();
  expect(controller.setManual(a, 1, false, dirs[0])).toBe(true);
  expect(calls[65].input).toMatchObject({
    op: "set",
    directory: dirs[0],
    expanded: false,
  });
  detach();
  for (const index of [
    0,
    ...Array.from({ length: 64 }, (_, index) => index + 2),
  ])
    reply(index);
  await tick();
  expect(calls).toHaveLength(66);
});
