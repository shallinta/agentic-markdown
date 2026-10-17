export type RootPlacement = "before" | "after";

/** Session-only display keys. Never paths, persisted identities, or authority. */
export function reconcileRootOrder(
  previous: readonly string[],
  current: readonly string[]
): readonly string[] {
  const members = new Set(current);
  const next: string[] = [];
  for (const key of previous) if (members.delete(key)) next.push(key);
  for (const key of current) if (members.delete(key)) next.push(key);
  return next.length === previous.length &&
    next.every((key, index) => key === previous[index])
    ? previous
    : Object.freeze(next);
}

export function moveRootOrder(
  order: readonly string[],
  source: string,
  target: string,
  placement: RootPlacement
): readonly string[] {
  if (
    source === target ||
    !order.includes(source) ||
    !order.includes(target) ||
    (placement !== "before" && placement !== "after") ||
    new Set(order).size !== order.length
  )
    return order;
  const next = order.filter((key) => key !== source);
  next.splice(
    next.indexOf(target) + (placement === "after" ? 1 : 0),
    0,
    source
  );
  return next.every((key, index) => key === order[index])
    ? order
    : Object.freeze(next);
}

export interface RootDragToken {
  readonly source: string;
}

/** Owned by the window workspace, not a tree DOM mount. */
export function createWorkspaceRootOrder() {
  let order: readonly string[] = Object.freeze([] as string[]);
  let members = new Set<string>();
  let drag: RootDragToken | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: readonly string[]) => {
    if (next === order) return false;
    order = next;
    for (const listener of listeners) listener();
    return true;
  };
  const canMoveBy = (source: string, direction: -1 | 1) => {
    const index = order.indexOf(source);
    return (
      (direction === -1 || direction === 1) &&
      index >= 0 &&
      index + direction >= 0 &&
      index + direction < order.length
    );
  };
  const move = (source: string, target: string, placement: RootPlacement) => {
    drag = null;
    return publish(moveRootOrder(order, source, target, placement));
  };
  return {
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => order,
    reconcile(current: readonly string[]) {
      const nextMembers = new Set(current);
      if (
        nextMembers.size !== members.size ||
        [...nextMembers].some((key) => !members.has(key))
      )
        drag = null;
      members = nextMembers;
      return publish(reconcileRootOrder(order, current));
    },
    move,
    canMoveBy,
    moveBy(source: string, direction: -1 | 1) {
      if (!canMoveBy(source, direction)) return false;
      return move(
        source,
        order[order.indexOf(source) + direction],
        direction === -1 ? "before" : "after"
      );
    },
    beginDrag(source: string): RootDragToken | null {
      drag = members.has(source) ? Object.freeze({ source }) : null;
      return drag;
    },
    isDragCurrent(token: unknown): token is RootDragToken {
      return !!drag && token === drag && members.has(drag.source);
    },
    drop(token: unknown, target: string, placement: RootPlacement) {
      const source = drag && token === drag ? drag.source : null;
      drag = null;
      return source !== null && members.has(source) && members.has(target)
        ? move(source, target, placement)
        : false;
    },
    cancelDrag() {
      drag = null;
    },
  };
}
