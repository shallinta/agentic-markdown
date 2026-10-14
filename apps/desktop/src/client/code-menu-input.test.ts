import { expect, test } from "bun:test";

import { guardCodeMenuInput } from "./code-menu-input";

test("only this open/current menu blocks cancelable input to its background editor", () => {
  const target = new EventTarget(),
    active = {} as Element;
  let prevented = 0;
  const event = {
    target,
    cancelable: true,
    preventDefault: () => {
      prevented++;
    },
  };
  const context = {
    open: true,
    current: true,
    activeElement: active,
    menu: { contains: (node: Node | null) => node === active },
    editor: {
      contains: (node: Node | null) => node === (target as unknown as Node),
    },
  };
  expect(guardCodeMenuInput(event, context)).toBe(true);
  expect(prevented).toBe(1);
  for (const override of [
    { open: false },
    { current: false },
    { menu: null },
    { editor: null },
    { activeElement: null },
    { menu: { contains: () => false } },
    { editor: { contains: () => false } },
  ])
    expect(guardCodeMenuInput(event, { ...context, ...override })).toBe(false);
  expect(guardCodeMenuInput({ ...event, cancelable: false }, context)).toBe(
    false
  );
  expect(guardCodeMenuInput({ ...event, target: null }, context)).toBe(false);
  expect(prevented).toBe(1);
  // The same callback observes a synchronous close; no stale render boolean.
  context.open = false;
  expect(guardCodeMenuInput(event, context)).toBe(false);
  expect(prevented).toBe(1);
});
