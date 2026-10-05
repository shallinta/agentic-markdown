import { expect, mock, test } from "bun:test";

import type { MouseEvent } from "react";

import { createFolderWorkspace } from "./workspace";
import { rootControlHandlers } from "./workspace-root-control";

function pointer(button = 0) {
  const focus = mock(() => undefined);
  const preventDefault = mock(() => undefined);
  const event = {
    button,
    preventDefault,
    currentTarget: { focus },
  } as unknown as MouseEvent<HTMLButtonElement>;
  return { event, focus, preventDefault };
}

test("primary down focuses only its button without scrolling; click alone runs the action", () => {
  const p = pointer();
  const action = mock(() => undefined);
  const handlers = rootControlHandlers(false, () => false, action);
  handlers.onMouseDown(p.event);
  expect(p.preventDefault).toHaveBeenCalledTimes(1);
  expect(p.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(action).not.toHaveBeenCalled();
  handlers.onClick(p.event);
  expect(action).toHaveBeenCalledTimes(1);
  expect(p.focus).toHaveBeenCalledTimes(1);
});

test("global disabled and non-primary input neither focus nor act; busy only guards actions", () => {
  for (const [disabled, button] of [
    [true, 0],
    [false, 1],
    [false, 2],
  ] as const) {
    const p = pointer(button);
    const action = mock(() => undefined);
    const handlers = rootControlHandlers(disabled, () => false, action);
    handlers.onMouseDown(p.event);
    handlers.onClick(p.event);
    expect(p.focus).not.toHaveBeenCalled();
    expect(p.preventDefault).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  }
  const p = pointer();
  const action = mock(() => undefined);
  const handlers = rootControlHandlers(false, () => true, action);
  handlers.onMouseDown(p.event);
  handlers.onClick(p.event);
  expect(p.focus).toHaveBeenCalledTimes(1);
  expect(action).not.toHaveBeenCalled();
});

test("live folder busy blocks same-render reentry for both root actions without async refocus", async () => {
  for (const operation of ["rescan", "hidden"] as const) {
    const gate = Promise.withResolvers<never>();
    const folders = createFolderWorkspace(() => gate.promise);
    const p = pointer();
    let pending: Promise<void> | undefined;
    const action = mock(() => {
      pending =
        operation === "rescan"
          ? folders.rescan("root")
          : folders.setHidden("root", true);
      void pending.catch(() => undefined);
    });
    const handlers = rootControlHandlers(
      false,
      () => folders.getSnapshot().busy,
      action
    );
    handlers.onMouseDown(p.event);
    handlers.onClick(p.event);
    expect(folders.getSnapshot().busy).toBe(true);
    handlers.onClick(p.event);
    expect(action).toHaveBeenCalledTimes(1);
    // After a user moves focus elsewhere, settlement must never call focus again.
    p.focus.mockClear();
    gate.reject(Error("controlled completion"));
    await pending?.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(p.focus).not.toHaveBeenCalled();
    folders.dispose();
  }
});
