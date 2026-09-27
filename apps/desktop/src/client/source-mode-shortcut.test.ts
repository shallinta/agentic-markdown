import { expect, test } from "bun:test";

import type { Command } from "../shared/commands";

import { routeSourceModeShortcut } from "./source-mode-shortcut";

test("source shortcut routes only exact command in an available nonmodal context", () => {
  const calls: Command[] = [];
  let prevented = 0;
  const key = {
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: true,
    key: "M",
    isComposing: false,
    repeat: false,
    preventDefault: () => {
      prevented++;
    },
    stopPropagation: () => undefined,
  };
  for (const override of [
    { isComposing: true },
    { repeat: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: false },
    { shiftKey: false },
    { key: "x" },
  ])
    expect(
      routeSourceModeShortcut(
        { ...key, ...override },
        null,
        false,
        true,
        (command) => calls.push(command)
      )
    ).toBe(false);
  expect(
    routeSourceModeShortcut(key, null, true, true, (command) =>
      calls.push(command)
    )
  ).toBe(false);
  expect(
    routeSourceModeShortcut(key, null, false, false, (command) =>
      calls.push(command)
    )
  ).toBe(false);
  expect(calls).toEqual([]);
  expect(
    routeSourceModeShortcut(key, null, false, true, (command) =>
      calls.push(command)
    )
  ).toBe(true);
  expect(calls).toEqual([{ type: "toggleSourceMode", args: {} }]);
  expect(prevented).toBe(1);
});

test("ordinary inputs and editable fields never route the document shortcut", () => {
  for (const selector of [
    "input, textarea, select",
    '[contenteditable="true"]',
  ]) {
    const target = {
      closest: (query: string) => (query === selector ? {} : null),
    } as Element;
    const key = {
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: true,
      key: "m",
      isComposing: false,
      repeat: false,
      preventDefault: () => {
        throw new Error("must not consume field shortcut");
      },
      stopPropagation: () => undefined,
    };
    expect(
      routeSourceModeShortcut(key, target, false, true, () => {
        throw new Error("must not route");
      })
    ).toBe(false);
  }
});
