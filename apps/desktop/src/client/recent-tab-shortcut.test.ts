import { expect, mock, test } from "bun:test";

import { COMMAND_META, PRODUCT_COMMANDS, isCommand } from "../shared/commands";

import { routeRecentTabKey } from "./recent-tab-shortcut";

type Key = Parameters<typeof routeRecentTabKey>[0];

function input(key: string, flags: Partial<Key> = {}) {
  return {
    key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false,
    isComposing: false, keyCode: 0,
    preventDefault: mock(() => undefined), stopPropagation: mock(() => undefined),
    ...flags,
  };
}

test("only exact Control+Tab advances through the internal command, and Control release finishes", () => {
  const command = { type: "cycleRecentTabs", args: {} } as const;
  expect(isCommand(command)).toBe(true);
  expect(isCommand({ ...command, args: { documentId: "extra" } })).toBe(false);
  expect(COMMAND_META[command.type]).toEqual({ target: "webview", palette: false });
  expect(PRODUCT_COMMANDS[command.type]).toBeUndefined();
  const actions = {
    hasCandidate: () => true, canCycle: () => true,
    advance: mock(() => undefined), finish: mock(() => undefined), cancel: mock(() => undefined),
  };
  for (const flags of [{}, { ctrlKey: true, altKey: true }, { ctrlKey: true, metaKey: true }, { ctrlKey: true, shiftKey: true }]) {
    const event = input("Tab", flags);
    expect(routeRecentTabKey(event, "keydown", actions)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  const pulse = input("Tab", { ctrlKey: true });
  expect(routeRecentTabKey(pulse, "keydown", actions)).toBe(true);
  expect(routeRecentTabKey(pulse, "keydown", actions)).toBe(true);
  expect(actions.advance).toHaveBeenCalledTimes(2);
  expect(pulse.preventDefault).toHaveBeenCalledTimes(2);
  expect(pulse.stopPropagation).toHaveBeenCalledTimes(2);
  routeRecentTabKey(pulse, "keyup", actions);
  routeRecentTabKey(input("Control", { ctrlKey: true }), "keyup", actions);
  expect(actions.finish).not.toHaveBeenCalled();
  routeRecentTabKey(input("Control"), "keyup", actions);
  expect(actions.finish).toHaveBeenCalledTimes(1);
  expect(actions.cancel).not.toHaveBeenCalled();
  for (const flags of [{ altKey: true }, { metaKey: true }, { shiftKey: true }])
    routeRecentTabKey(input("Control", flags), "keyup", actions);
  expect(actions.finish).toHaveBeenCalledTimes(1);
  expect(actions.cancel).toHaveBeenCalledTimes(3);
});

test("a blocked or composing context cancels without taking the editor's keys", () => {
  const actions = {
    hasCandidate: () => true, canCycle: mock(() => true),
    advance: mock(() => undefined), finish: mock(() => undefined), cancel: mock(() => undefined),
  };
  const escape = input("Escape");
  expect(routeRecentTabKey(escape, "keydown", actions)).toBe(true);
  expect(escape.preventDefault).toHaveBeenCalledTimes(1);
  for (const flags of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = input("Tab", { ...flags, ctrlKey: true });
    expect(routeRecentTabKey(event, "keydown", actions)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
  }
  actions.canCycle.mockImplementation(() => false);
  const modalEscape = input("Escape");
  expect(routeRecentTabKey(modalEscape, "keydown", actions)).toBe(false);
  expect(modalEscape.preventDefault).not.toHaveBeenCalled();
  routeRecentTabKey(input("Control"), "keyup", actions);
  expect(actions.advance).not.toHaveBeenCalled();
  expect(actions.finish).not.toHaveBeenCalled();
  expect(actions.cancel).toHaveBeenCalledTimes(5);
});
