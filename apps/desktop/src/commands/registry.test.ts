import { expect, mock, test } from "bun:test";

import { createDocumentController } from "../client/documents";
import {
  isCommandAvailabilityMessage,
  PRODUCT_COMMANDS,
} from "../shared/commands";
import type { DocumentRequest, DocumentResponse } from "../shared/documents";

import { createCommandRegistry } from "./registry";

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
      clearDocument: controller.clear,
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
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.getSnapshot().snapshot).toBeNull();
  expect(controller.getSnapshot().busy).toBe(false);
  expect(release).toHaveBeenCalledTimes(1);
  expect(changed).toHaveBeenCalledTimes(2);
});

test("availability protocol is bounded to the three boolean document states", () => {
  const availability = {
    selectDocument: true,
    reloadDocument: false,
    clearDocument: false,
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
  expect(PRODUCT_COMMANDS.clearDocument?.accelerator).toBeUndefined();
});
