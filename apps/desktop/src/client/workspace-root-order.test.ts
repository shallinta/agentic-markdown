import { expect, test } from "bun:test";

import {
  createWorkspaceRootOrder,
  moveRootOrder,
  reconcileRootOrder,
} from "./workspace-root-order";

const keys = ["root:a", "root:b", "file:c"];
test("mixed root order preserves members and identity for no-op", () => {
  const mixed = moveRootOrder(keys, "file:c", "root:b", "before");
  expect(mixed).toEqual(["root:a", "file:c", "root:b"]);
  expect(keys).toEqual(["root:a", "root:b", "file:c"]);
  expect(moveRootOrder(mixed, "file:c", "root:b", "before")).toBe(mixed);
  expect(moveRootOrder(mixed, "root:b", "root:b", "after")).toBe(mixed);
  expect(moveRootOrder(mixed, "node:child", "root:a", "before")).toBe(mixed);
  expect(moveRootOrder(mixed, "root:a", "node:child", "after")).toBe(mixed);
  expect(moveRootOrder(["a", "a", "b"], "a", "b", "after")).toEqual([
    "a",
    "a",
    "b",
  ]);
});
test("reconciliation prunes absorbed or removed roots and appends new visible roots", () => {
  const mixed = ["file:c", "root:b", "root:a"];
  expect(reconcileRootOrder(mixed, keys)).toBe(mixed);
  const absorbed = reconcileRootOrder(mixed, ["root:a", "root:b", "root:d"]);
  expect(absorbed).toEqual(["root:b", "root:a", "root:d"]);
  expect(
    reconcileRootOrder(absorbed, ["root:a", "root:b", "root:d", "file:c"])
  ).toEqual(["root:b", "root:a", "root:d", "file:c"]);
  expect(reconcileRootOrder(keys, [])).toEqual([]);
  expect(reconcileRootOrder([], ["a", "a", "b"])).toEqual(["a", "b"]);
});
test("keyboard uses identical movement and bounds with stable subscriptions", () => {
  const owner = createWorkspaceRootOrder();
  let changes = 0;
  const unsubscribe = owner.subscribe(() => {
    changes++;
  });
  expect(owner.reconcile(keys)).toBe(true);
  expect(owner.reconcile(keys)).toBe(false);
  expect(owner.canMoveBy("root:a", -1)).toBe(false);
  expect(owner.moveBy("root:a", -1)).toBe(false);
  expect(owner.canMoveBy("file:c", 1)).toBe(false);
  expect(owner.moveBy("file:c", -1)).toBe(true);
  expect(owner.getSnapshot()).toEqual(
    moveRootOrder(keys, "file:c", "root:b", "before")
  );
  expect(owner.moveBy("node:child", 1)).toBe(false);
  expect(changes).toBe(2);
  unsubscribe();
  owner.moveBy("file:c", -1);
  expect(changes).toBe(2);
});
test("drag token cannot be forged reused or carried across membership change", () => {
  const owner = createWorkspaceRootOrder(),
    other = createWorkspaceRootOrder();
  owner.reconcile(keys);
  other.reconcile(keys);
  const first = owner.beginDrag("file:c");
  expect(owner.isDragCurrent(first)).toBe(true);
  expect(other.drop(first, "root:a", "before")).toBe(false);
  expect(owner.drop({ source: "file:c" }, "root:a", "before")).toBe(false);
  expect(owner.drop(first, "root:a", "before")).toBe(false);
  const second = owner.beginDrag("file:c");
  expect(owner.drop(second, "root:a", "before")).toBe(true);
  expect(owner.drop(second, "root:b", "after")).toBe(false);
  const third = owner.beginDrag("file:c");
  owner.reconcile(["root:a", "root:b"]);
  expect(owner.isDragCurrent(third)).toBe(false);
  expect(owner.drop(third, "root:a", "before")).toBe(false);
  expect(owner.beginDrag("node:child")).toBeNull();
});
test("explicit cancellation and keyboard change invalidate drag without changing other state", () => {
  const owner = createWorkspaceRootOrder();
  owner.reconcile(keys);
  const first = owner.beginDrag("file:c");
  owner.cancelDrag();
  expect(owner.drop(first, "root:a", "before")).toBe(false);
  expect(owner.getSnapshot()).toEqual(keys);
  const second = owner.beginDrag("file:c");
  owner.moveBy("root:b", -1);
  expect(owner.isDragCurrent(second)).toBe(false);
  const snapshot = owner.getSnapshot();
  const third = owner.beginDrag("file:c");
  owner.reconcile(keys);
  expect(owner.isDragCurrent(third)).toBe(true);
  expect(owner.getSnapshot()).toBe(snapshot);
});
