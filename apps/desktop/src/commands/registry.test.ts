import { expect, mock, test } from "bun:test";

import { createDocumentController } from "../client/documents";
import {
  COMMAND_META,
  isCommand,
  isCommandAvailabilityMessage,
  PRODUCT_COMMANDS,
} from "../shared/commands";
import type { DocumentRequest, DocumentResponse } from "../shared/documents";

import { createCommandRegistry } from "./registry";

test("root ordering commands are webview actions with explicit labels and no default shortcut", () => {
  for (const type of ["moveWorkspaceRootUp", "moveWorkspaceRootDown"] as const) {
    expect(isCommand({ type, args: {} })).toBe(true);
    expect(COMMAND_META[type]).toEqual({ target: "webview" });
    expect(PRODUCT_COMMANDS[type]?.label).toBe(type === "moveWorkspaceRootUp" ? "上移选中根" : "下移选中根");
  }
});
test("root hidden command requires opaque root and boolean intent", () => {
  expect(
    isCommand({
      type: "setRootHidden",
      args: { root: crypto.randomUUID(), showHidden: true },
    })
  ).toBe(true);
  expect(
    isCommand({
      type: "setRootHidden",
      args: { root: "/path", showHidden: true },
    })
  ).toBe(false);
  expect(isCommand({ type: "setRootHidden", args: {} })).toBe(false);
  expect(COMMAND_META.setRootHidden.palette).toBe(false);
});

test("source mode is a guarded internal command, never a visible product action", () => {
  const registry = createCommandRegistry(
    () => {
      throw new Error("not native");
    },
    () => {
      throw new Error("unexpected failure");
    }
  );
  let enabled = false,
    count = 0;
  registry.registerCommandHandlers(
    {
      toggleSourceMode: () => {
        count++;
      },
    },
    { toggleSourceMode: () => enabled }
  );
  registry.executeCommand({ type: "toggleSourceMode", args: {} });
  expect(count).toBe(0);
  enabled = true;
  registry.executeCommand({ type: "toggleSourceMode", args: {} });
  expect(count).toBe(1);
  expect(COMMAND_META.toggleSourceMode.palette).toBe(false);
  expect(PRODUCT_COMMANDS.toggleSourceMode).toBeUndefined();
  expect(isCommand({ type: "toggleSourceMode", args: {} })).toBe(true);
  expect(isCommand({ type: "toggleSourceMode", args: { extra: true } })).toBe(
    false
  );
});

test("the saved reading window is a document-scoped webview command with no shortcut or supplied source", () => {
  const forward = mock(() => undefined);
  const open = mock(() => undefined);
  const registry = createCommandRegistry(forward, () => undefined);
  const command = { type: "openReadingSnapshot", args: {} } as const;
  expect(isCommand(command)).toBe(true);
  expect(isCommand({ ...command, args: { handle: crypto.randomUUID() } })).toBe(false);
  expect(COMMAND_META.openReadingSnapshot).toEqual({ target: "webview", palette: false });
  expect(PRODUCT_COMMANDS.openReadingSnapshot).toEqual({ label: "在阅读窗口打开已保存版本" });
  expect(registry.isCommandEnabled(command.type)).toBe(false);
  let current = false;
  const unregister = registry.registerCommandHandlers({ openReadingSnapshot: open }, { openReadingSnapshot: () => current });
  registry.executeCommand(command);
  expect(open).not.toHaveBeenCalled();
  current = true;
  registry.executeCommand(command);
  expect(open).toHaveBeenCalledTimes(1);
  unregister();
  expect(registry.isCommandEnabled(command.type)).toBe(false);
  expect(forward).not.toHaveBeenCalled();
});

test("tab pin commands use live state, require no supplied identity, and have no accelerator", () => {
  const forward = mock(() => undefined);
  const registry = createCommandRegistry(forward, () => undefined);
  const pin = { type: "pinCurrentTab", args: {} } as const;
  const unpin = { type: "unpinCurrentTab", args: {} } as const;
  for (const command of [pin, unpin]) {
    expect(isCommand(command)).toBe(true);
    expect(isCommand({ ...command, args: { documentId: crypto.randomUUID() } })).toBe(false);
    expect(COMMAND_META[command.type]).toEqual({ target: "webview" });
    expect(registry.isCommandEnabled(command.type)).toBe(false);
  }
  expect(PRODUCT_COMMANDS.pinCurrentTab).toEqual({ label: "固定当前标签" });
  expect(PRODUCT_COMMANDS.unpinCurrentTab).toEqual({ label: "取消固定当前标签" });
  let pinned = false;
  const setPinned = mock((value: boolean) => { pinned = value; });
  registry.registerCommandHandlers({
    pinCurrentTab: () => setPinned(true),
    unpinCurrentTab: () => setPinned(false),
  }, { pinCurrentTab: () => !pinned, unpinCurrentTab: () => pinned });
  registry.executeCommand(unpin);
  registry.executeCommand(pin);
  registry.executeCommand(pin);
  registry.executeCommand(unpin);
  expect(setPinned.mock.calls).toEqual([[true], [false]]);
  expect(forward).not.toHaveBeenCalled();
});

test("registration ownership, unavailable guard and native forwarding", () => {
  const forward = mock(() => undefined);
  const failed = mock(() => undefined);
  const registry = createCommandRegistry(forward, failed);
  const older = mock(() => undefined);
  const newer = mock(() => undefined);
  expect(registry.isCommandEnabled("selectDocument")).toBe(false);
  const removeOlder = registry.registerCommandHandlers({
    selectDocument: older,
  });
  let enabled = false;
  const removeNewer = registry.registerCommandHandlers(
    { selectDocument: newer },
    { selectDocument: () => enabled }
  );
  removeOlder();
  registry.executeCommand({ type: "selectDocument", args: {} });
  expect(newer).not.toHaveBeenCalled();
  enabled = true;
  registry.executeCommand({ type: "selectDocument", args: {} });
  expect(newer).toHaveBeenCalledTimes(1);
  removeNewer();
  expect(registry.isCommandEnabled("selectDocument")).toBe(false);
  registry.executeCommand({ type: "zoomIn", args: {} });
  expect(forward).toHaveBeenCalledWith({ type: "zoomIn", args: {} });
  expect(older).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});

test("sync and async handler failures use a sanitized error callback", async () => {
  const failed = mock(() => undefined);
  const registry = createCommandRegistry(() => undefined, failed);
  registry.registerCommandHandlers({
    selectDocument: () => {
      throw new Error("private-path");
    },
  });
  registry.executeCommand({ type: "selectDocument", args: {} });
  registry.registerCommandHandlers({
    selectDocument: () => Promise.reject(new Error("private-text")),
  });
  registry.executeCommand({ type: "selectDocument", args: {} });
  await Promise.resolve();
  expect(failed).toHaveBeenCalledTimes(2);
  expect(failed.mock.calls).toEqual([[], []]);
});

test("live controller guards reject same-tick duplicates and clear fences late selection", async () => {
  let finish!: (response: DocumentResponse) => void;
  let request!: DocumentRequest;
  const select = mock((input: DocumentRequest) => {
    request = input;
    return new Promise<DocumentResponse>((resolve) => {
      finish = resolve;
    });
  });
  const release = mock((input: DocumentRequest) =>
    Promise.resolve({
      ...input,
      ok: true,
      snapshot: null,
    })
  );
  const controller = createDocumentController({
    cancelDocument: () => Promise.resolve(null),
    selectDocument: select,
    readDocument: () => Promise.resolve(null),
    releaseDocument: release,
  });
  const registry = createCommandRegistry(
    () => undefined,
    () => undefined
  );
  registry.registerCommandHandlers(
    {
      selectDocument: controller.select,
      reloadDocument: controller.reload,
      clearDocument: () => controller.clear(),
    },
    {
      selectDocument: () => !controller.getSnapshot().busy,
      reloadDocument: () =>
        !controller.getSnapshot().busy && !!controller.getSnapshot().snapshot,
      clearDocument: () =>
        controller.getSnapshot().busy || !!controller.getSnapshot().snapshot,
    }
  );
  const changed = mock(() => undefined);
  registry.subscribe(changed);
  controller.subscribe(registry.notify);
  expect(registry.isCommandEnabled("reloadDocument")).toBe(false);
  expect(registry.isCommandEnabled("clearDocument")).toBe(false);
  registry.executeCommand({ type: "selectDocument", args: {} });
  registry.executeCommand({ type: "selectDocument", args: {} });
  expect(select).toHaveBeenCalledTimes(1);
  expect(registry.isCommandEnabled("clearDocument")).toBe(true);
  registry.executeCommand({ type: "clearDocument", args: {} });
  finish({
    ...request,
    ok: true,
    snapshot: {
      handle: crypto.randomUUID(),
      documentId: crypto.randomUUID(),
      fileName: "sample.md",
      revision: 1,
      hash: "a".repeat(64),
      byteLength: 1,
      text: "x",
      writeCapability: { writable: true, reason: "writable" },
      fidelity: {
        encoding: "utf-8",
        bom: false,
        lf: 0,
        crlf: 0,
        loneCr: 0,
        newlineStyle: "none",
        dominantNewline: "none",
        ending: "none",
      },
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.getSnapshot().snapshot).toBeNull();
  expect(controller.getSnapshot().busy).toBe(false);
  expect(release).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(2);
});

test("availability protocol is bounded to document command states", () => {
  const availability = {
    undoDocument: false,
    redoDocument: false,
    documentHistory: true,
    selectDocument: true,
    selectFolder: true,
    saveDocument: false,
    reloadDocument: false,
    clearDocument: false,
    closeDocument: false,
  };
  expect(
    isCommandAvailabilityMessage({ protocolVersion: 1, availability })
  ).toBe(true);
  for (const value of [
    null,
    {},
    { protocolVersion: 2, availability },
    { protocolVersion: 1, availability: { ...availability, unknown: true } },
    { protocolVersion: 1, availability: { ...availability, clearDocument: 1 } },
    { protocolVersion: 1, availability, text: "private" },
  ]) {
    expect(isCommandAvailabilityMessage(value)).toBe(false);
  }
  expect(PRODUCT_COMMANDS.selectDocument?.accelerator).toBe(
    "CommandOrControl+O"
  );
  expect(PRODUCT_COMMANDS.reloadDocument?.accelerator).toBeUndefined();
  expect(PRODUCT_COMMANDS.saveDocument?.accelerator).toBe("CommandOrControl+S");
  expect(PRODUCT_COMMANDS.clearDocument?.accelerator).toBeUndefined();
});
