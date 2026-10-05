import { expect, test } from "bun:test";

import { undo } from "@codemirror/commands";

import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { rawText } from "./raw-buffer";
import { savedReply, requestText, waitCaptured } from "./save-test-helper";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture(text = "\uFEFFa\r\nb\nc\rd"): DocumentSnapshot {
  return {
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "test.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
}
function saved(request: SaveDocumentRequest, baseline: DocumentSnapshot) {
  return savedReply(request, baseline);
}
async function setup(confirm = () => Promise.resolve(false)) {
  const baseline = fixture();
  const transport: DocumentTransport = {
    waitForDocumentSaves: (req) => Promise.resolve({ ...req, settled: true }),
    selectDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: baseline }),
    readDocument: (req) =>
      Promise.resolve({ ...req, ok: true, snapshot: baseline }),
    releaseDocument: () => Promise.resolve(),
    cancelDocument: () => Promise.resolve(),
    saveDocument: (req) => Promise.resolve(saved(req, baseline)),
  };
  const controller = createDocumentController(transport, confirm);
  await controller.select();
  const edit = (text: string) => {
    const state = controller.getEditor(baseline.documentId)!.state;
    controller.updateEditor(
      baseline.documentId,
      state.update({ changes: { from: state.doc.length, insert: text } })
    );
  };
  return { baseline, transport, controller, edit };
}
test("settings input guard blocks background text but preserves selection, save and close-state protections", async () => {
  const { controller, baseline, edit } = await setup();
  edit("before settings");
  const original = controller.getEditor(baseline.documentId)!;
  controller.setEditorInputBlocked(true);
  expect(controller.isEditorInputBlocked()).toBe(true);
  edit("\n");
  expect(controller.getEditor(baseline.documentId)).toBe(original);
  expect(
    controller.updateEditor(
      baseline.documentId,
      original.state.update({ selection: { anchor: 1 } })
    )
  ).toBe(true);
  expect(controller.canSave()).toBe(true);
  await controller.save();
  expect(controller.isDirty(baseline.documentId)).toBe(false);
  expect(controller.getSnapshot().snapshot!.text).toBe(
    original.state.field(rawText)
  );
  // Closing settings must not release an unrelated discard/save freeze.
  controller.beginDiscard();
  controller.setEditorInputBlocked(false);
  edit("still frozen");
  expect(controller.getEditor(baseline.documentId)!.state.field(rawText)).toBe(
    original.state.field(rawText)
  );
  controller.endDiscard();
  edit("after settings");
  expect(controller.isDirty(baseline.documentId)).toBe(true);
  expect(
    controller.getEditor(baseline.documentId)!.state.field(rawText)
  ).toEndWith("after settings");
  controller.setEditorInputBlocked(true);
  edit("blocked again");
  expect(
    controller.getEditor(baseline.documentId)!.state.field(rawText)
  ).toEndWith("after settings");
  controller.setEditorInputBlocked(false);
});
test("save exact raw snapshot updates only baseline; edits made during save remain dirty", async () => {
  const { baseline, controller, transport, edit } = await setup();
  const pending = deferred<unknown>();
  let request!: SaveDocumentRequest;
  transport.saveDocument = (value) => {
    request = value;
    return pending.promise;
  };
  edit("first");
  const sent = controller.getEditor(baseline.documentId)!.state;
  const saving = controller.save();
  await waitCaptured(() => !!request);
  expect(controller.getSaveStatus(baseline.documentId).status).toBe("saving");
  await waitCaptured(() => !!request);
  expect(requestText(request, baseline)).toBe(sent.field(rawText));
  edit("second");
  const newest = controller.getEditor(baseline.documentId)!.state;
  pending.resolve(saved(request, baseline));
  await saving;
  expect(controller.getEditor(baseline.documentId)!.state).toBe(newest);
  expect(controller.getSnapshot().snapshot!.text).toBe(sent.field(rawText));
  expect(controller.isDirty(baseline.documentId)).toBe(true);
});

test("metadata rescan settles saves then unfreezes before long scan and refuses failed preflight", async () => {
  const { controller, transport, edit } = await setup();
  edit("saved");
  await controller.save();
  const barrier = deferred<void>(),
    scan = deferred<void>();
  let settlements = 0,
    scans = 0;
  transport.waitForDocumentSaves = async (request) => {
    settlements++;
    await barrier.promise;
    return { ...request, settled: true };
  };
  const operation = controller.runMetadataRescan(async () => {
    scans++;
    await scan.promise;
  });
  await waitCaptured(() => settlements === 1);
  expect(controller.getSnapshot().frozen).toBe(true);
  expect(scans).toBe(0);
  barrier.resolve();
  await waitCaptured(() => scans === 1);
  expect(controller.getSnapshot().frozen).toBe(false);
  edit("typing while metadata pending");
  expect(
    controller.isDirty(controller.getSnapshot().snapshot!.documentId)
  ).toBe(true);
  await controller.save();
  expect(controller.getSnapshot().frozen).toBe(false);
  scan.resolve();
  await operation;
  transport.waitForDocumentSaves = () =>
    Promise.reject(Error("settlement unavailable"));
  await controller.runMetadataRescan(() => {
    scans++;
  });
  expect(scans).toBe(1);
  expect(controller.getSnapshot().frozen).toBe(false);
});

test("metadata preflight rechecks composition and disposal before long action", async () => {
  for (const dispose of [false, true]) {
    const { controller, transport, edit } = await setup();
    edit("saved");
    await controller.save();
    const gate = deferred<void>();
    let entered = false,
      scans = 0;
    transport.waitForDocumentSaves = async (request) => {
      entered = true;
      await gate.promise;
      return { ...request, settled: true };
    };
    const pending = controller.runMetadataRescan(() => {
      scans++;
    });
    await waitCaptured(() => entered);
    if (dispose) controller.dispose();
    else controller.setInteractionCheck(() => false);
    gate.resolve();
    await pending;
    expect(scans).toBe(0);
  }
});

test("completed save restores workspace availability but mutations still await backend settlement", async () => {
  const { controller, transport, edit } = await setup();
  edit("saved");
  await controller.save();
  expect(controller.hasSaves()).toBe(false);
  expect(controller.canSelectFolder()).toBe(true);
  const barrier = deferred<void>();
  let settlements = 0,
    mutations = 0;
  transport.waitForDocumentSaves = async (request) => {
    settlements++;
    await barrier.promise;
    return { ...request, settled: true };
  };
  const operation = controller.runWorkspaceAction(() => {
    mutations++;
  });
  await waitCaptured(() => settlements === 1);
  expect(mutations).toBe(0);
  expect(controller.canSelectFolder()).toBe(false);
  barrier.resolve();
  await operation;
  expect(mutations).toBe(1);
  expect(controller.canSelectFolder()).toBe(true);
  await controller.runWorkspaceAction(() => {
    mutations++;
  });
  expect(settlements).toBe(1);
  expect(mutations).toBe(2);
});

test("workspace actions reject inflight saves, composition and freeze; late save keeps newer edits", async () => {
  const { controller, transport, baseline, edit } = await setup();
  const pending = deferred<unknown>();
  let request!: SaveDocumentRequest;
  let mutations = 0,
    opens = 0;
  transport.saveDocument = (value) => {
    request = value;
    return pending.promise;
  };
  transport.openWorkspaceDocument = (value) => {
    opens++;
    return Promise.resolve({ ...value, ok: true, snapshot: baseline });
  };
  edit("captured");
  const saving = controller.save();
  await waitCaptured(() => !!request);
  expect(controller.canSelectFolder()).toBe(false);
  await controller.runWorkspaceAction(() => {
    mutations++;
  });
  await controller.openWorkspaceEntry("root", "node");
  edit("newer");
  const memory = controller.getEditor(baseline.documentId)!.state;
  pending.resolve(saved(request, baseline));
  await saving;
  expect(controller.canSelectFolder()).toBe(true);
  expect(controller.isDirty(baseline.documentId)).toBe(true);
  expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
  controller.setInteractionCheck(() => false);
  await controller.runWorkspaceAction(() => {
    mutations++;
  });
  await controller.openWorkspaceEntry("root", "node");
  controller.setInteractionCheck(() => true);
  controller.beginDiscard();
  await controller.runWorkspaceAction(() => {
    mutations++;
  });
  await controller.openWorkspaceEntry("root", "node");
  controller.endDiscard();
  expect(mutations).toBe(0);
  expect(opens).toBe(0);
  await controller.runWorkspaceAction(() => {
    mutations++;
  });
  expect(mutations).toBe(1);
  expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
});

test("failed workspace settlement preserves dirty memory and retries before root changes or opens", async () => {
  const { controller, transport, baseline, edit } = await setup();
  edit("unconfirmed");
  transport.saveDocument = () => Promise.reject(new Error("expired RPC"));
  await controller.save();
  const memory = controller.getEditor(baseline.documentId)!.state;
  let mutations = 0,
    opens = 0;
  transport.openWorkspaceDocument = (value) => {
    opens++;
    return Promise.resolve({ ...value, ok: true, snapshot: baseline });
  };
  transport.waitForDocumentSaves = () =>
    Promise.reject(new Error("unavailable"));
  await controller.runWorkspaceAction(() => {
    mutations++;
  });
  await controller.openWorkspaceEntry("root", "node");
  expect(mutations).toBe(0);
  expect(opens).toBe(0);
  expect(controller.isDirty(baseline.documentId)).toBe(true);
  expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
  expect(controller.getSnapshot().error).toContain("本次操作已取消");
  expect(controller.canSelectFolder()).toBe(true);
  transport.waitForDocumentSaves = (request) =>
    Promise.resolve({ ...request, settled: true });
  await controller.runWorkspaceAction(() => {
    mutations++;
  });
  expect(mutations).toBe(1);
  expect(controller.isDirty(baseline.documentId)).toBe(true);
  expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
});
test("invalid raw UTF-16 fails before dispatch without falsely declaring a disk-uncertain result", async () => {
  const { baseline, controller, transport, edit } = await setup();
  let calls = 0;
  transport.saveDocument = () => {
    calls++;
    return Promise.reject(new Error("must not dispatch"));
  };
  edit("\ud800");
  const memory = controller.getEditor(baseline.documentId)!.state;
  await controller.save();
  expect(calls).toBe(0);
  expect(controller.getSaveStatus(baseline.documentId).status).toBe("failed");
  expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
  expect(controller.canSave()).toBe(true);
});
test("close waits for save and rechecks clean state without discard confirmation", async () => {
  let prompts = 0;
  const { baseline, controller, transport, edit } = await setup(() => {
    prompts++;
    return Promise.resolve(false);
  });
  const pending = deferred<unknown>();
  let request!: SaveDocumentRequest;
  transport.saveDocument = (value) => {
    request = value;
    return pending.promise;
  };
  edit("saved");
  const saving = controller.save();
  await waitCaptured(() => !!request);
  const closing = controller.closeActive();
  expect(controller.getSnapshot().frozen).toBe(true);
  expect(controller.getSnapshot().tabs).toHaveLength(1);
  pending.resolve(saved(request, baseline));
  await saving;
  await closing;
  expect(controller.getSnapshot().tabs).toHaveLength(0);
  expect(prompts).toBe(0);
});
test("failures and malformed acknowledgments retain memory; uncertain result blocks unsafe retries", async () => {
  for (const error of [
    "CONFLICT",
    "SAVE_FAILED",
    "SAVE_UNCERTAIN",
    "malformed",
  ]) {
    const { baseline, controller, transport, edit } = await setup();
    edit("dirty");
    const memory = controller.getEditor(baseline.documentId)!.state;
    transport.saveDocument = (req) =>
      Promise.resolve(
        error === "malformed"
          ? { ...saved(req, baseline), savedBufferRevision: 999 }
          : { ...req, ok: false, error }
      );
    await controller.save();
    expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
    expect(controller.isDirty(baseline.documentId)).toBe(true);
    expect(controller.getSnapshot().snapshot).toBe(baseline);
    expect(controller.canSave()).toBe(
      error === "CONFLICT" || error === "SAVE_FAILED"
    );
  }
});
test("non-active save reply never changes active tab; repeat save is bounded", async () => {
  const { baseline, controller, transport, edit } = await setup();
  const second = fixture("second");
  transport.selectDocument = (req) =>
    Promise.resolve({ ...req, ok: true, snapshot: second });
  await controller.select();
  controller.activateTab(baseline.documentId);
  edit("dirty");
  const pending = deferred<unknown>();
  let request!: SaveDocumentRequest;
  let calls = 0;
  transport.saveDocument = (value) => {
    calls++;
    request = value;
    return pending.promise;
  };
  const saving = controller.save();
  await waitCaptured(() => !!request);
  void controller.save();
  controller.activateTab(second.documentId);
  pending.resolve(saved(request, baseline));
  await saving;
  expect(calls).toBe(1);
  expect(controller.getSnapshot().snapshot!.documentId).toBe(second.documentId);
  expect(controller.isDirty(baseline.documentId)).toBe(false);
});

test("uncertain result remains dirty even after undo to original; close still asks", async () => {
  let prompts = 0;
  const { baseline, controller, transport, edit } = await setup(() => {
    prompts++;
    return Promise.resolve(false);
  });
  edit("change");
  transport.saveDocument = () => Promise.reject(Error("transport lost"));
  await controller.save();
  undo({
    state: controller.getEditor(baseline.documentId)!.state,
    dispatch: (transaction) => {
      controller.updateEditor(baseline.documentId, transaction);
    },
  });
  expect(controller.getEditor(baseline.documentId)!.state.field(rawText)).toBe(
    baseline.text
  );
  expect(controller.isDirty(baseline.documentId)).toBe(true);
  await controller.closeActive();
  expect(prompts).toBe(1);
  expect(controller.getSnapshot().tabs).toHaveLength(1);
});

test("failed save completes before close confirmation and cancel retains full editor state", async () => {
  let prompted = false;
  const { baseline, controller, transport, edit } = await setup(() => {
    prompted = true;
    return Promise.resolve(false);
  });
  const pending = deferred<unknown>();
  let request!: SaveDocumentRequest;
  transport.saveDocument = (value) => {
    request = value;
    return pending.promise;
  };
  edit("kept");
  const memory = controller.getEditor(baseline.documentId)!.state;
  controller.setScrollPosition(baseline.documentId, 120);
  const saving = controller.save();
  await waitCaptured(() => !!request);
  const closing = controller.closeActive();
  expect(prompted).toBe(false);
  pending.resolve({
    protocolVersion: 1,
    requestId: request.requestId,
    ok: false,
    error: "CONFLICT",
  });
  await saving;
  await closing;
  expect(prompted).toBe(true);
  expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
  expect(controller.getScrollPosition(baseline.documentId)).toBe(120);
  expect(controller.getSnapshot().frozen).toBe(false);
});

test("save preserves selection/history/scroll and does not replace a dirty active buffer", async () => {
  const { baseline, controller, edit } = await setup();
  edit("changed");
  const before = controller.getEditor(baseline.documentId)!.state;
  const selection = before.update({ selection: { anchor: 1, head: 4 } });
  controller.updateEditor(baseline.documentId, selection);
  controller.setScrollPosition(baseline.documentId, 60);
  await controller.save();
  expect(controller.getEditor(baseline.documentId)!.state).toBe(
    selection.state
  );
  expect(controller.getScrollPosition(baseline.documentId)).toBe(60);
  expect(controller.isDirty(baseline.documentId)).toBe(false);
  undo({
    state: selection.state,
    dispatch: (transaction) => {
      controller.updateEditor(baseline.documentId, transaction);
    },
  });
  expect(controller.isDirty(baseline.documentId)).toBe(true);
  expect(controller.getEditor(baseline.documentId)!.state.field(rawText)).toBe(
    baseline.text
  );
});

test("expired save RPC cannot let close/clear/reread destroy buffers before backend settlement", async () => {
  for (const operationName of ["closeActive", "clear", "reload"] as const) {
    let prompts = 0,
      reads = 0;
    const { baseline, controller, transport, edit } = await setup(() => {
      prompts++;
      return Promise.resolve(false);
    });
    edit("pending write");
    const memory = controller.getEditor(baseline.documentId)!.state;
    transport.saveDocument = () =>
      Promise.reject(new Error("RPC timeout, worker still running"));
    await controller.save();
    expect(controller.hasSaves()).toBe(false);
    const worker = deferred<void>();
    transport.waitForDocumentSaves = async (req) => {
      await worker.promise;
      return { ...req, settled: true };
    };
    transport.readDocument = (req) => {
      reads++;
      return Promise.resolve({ ...req, ok: true, snapshot: baseline });
    };
    const closing = controller[operationName]();
    await Promise.resolve();
    expect(controller.getSnapshot().tabs).toHaveLength(1);
    expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
    expect(prompts).toBe(0);
    expect(reads).toBe(0);
    expect(controller.getSnapshot().frozen).toBe(true);
    worker.resolve();
    await closing;
    expect(prompts).toBe(1);
    expect(reads).toBe(0);
    expect(controller.getEditor(baseline.documentId)!.state).toBe(memory);
    expect(controller.getSnapshot().frozen).toBe(false);
  }
});

test("missing, failed or forged settlement refuses destruction and permits a later confirmed retry", async () => {
  for (const ack of [undefined, false, "throw", "wrong-id"]) {
    let prompts = 0;
    const { baseline, controller, transport, edit } = await setup(() => {
      prompts++;
      return Promise.resolve(true);
    });
    edit("pending");
    transport.saveDocument = () => Promise.reject(Error("unknown outcome"));
    await controller.save();
    transport.waitForDocumentSaves = (req) =>
      ack === "throw"
        ? Promise.reject(Error("settle timeout"))
        : Promise.resolve(
            ack === undefined
              ? undefined
              : {
                  ...req,
                  requestId:
                    ack === "wrong-id" ? crypto.randomUUID() : req.requestId,
                  settled: ack === false ? false : true,
                }
          );
    await controller.clear();
    expect(controller.getSnapshot().tabs).toHaveLength(1);
    expect(prompts).toBe(0);
    expect(controller.isDirty(baseline.documentId)).toBe(true);
    expect(controller.getSnapshot().frozen).toBe(false);
    transport.waitForDocumentSaves = (req) =>
      Promise.resolve({ ...req, settled: true });
    await controller.clear();
    expect(prompts).toBe(1);
    expect(controller.getSnapshot().tabs).toHaveLength(0);
  }
});
