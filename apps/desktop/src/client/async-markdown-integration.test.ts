import { expect, test } from "bun:test";

import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { Tree } from "@lezer/common";

import type {
  DocumentSnapshot,
  SaveDocumentRequest,
} from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import {
  asyncMarkdownSession,
  setMarkdownWorkerFactory,
  type MarkdownWorker,
} from "./async-markdown";
import { BACKGROUND_ENTER_UNITS } from "./background-parsing";
import { BomAwareParser } from "./bom-aware-parser";
import { createDocumentController, type DocumentTransport } from "./documents";
import { editorFaultSession, reportEditorFault } from "./editor-fault";
import {
  encodeMarkdownTree,
  type MarkdownParseRequest,
} from "./markdown-tree-wire";
import { rawText } from "./raw-buffer";
import { requestText, savedReply, waitCaptured } from "./save-test-helper";

function treeNodes(tree: Tree | null) {
  const nodes: { name: string; from: number; to: number }[] = [];
  tree?.iterate({
    enter: (node) => {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

class ControlledWorker implements MarkdownWorker {
  requests: MarkdownParseRequest[] = [];
  terminated = false;
  onmessage: MarkdownWorker["onmessage"] = null;
  onerror: MarkdownWorker["onerror"] = null;
  onmessageerror: MarkdownWorker["onmessageerror"] = null;
  postMessage(message: MarkdownParseRequest) {
    this.requests.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(request: MarkdownParseRequest) {
    this.onmessage?.(
      new MessageEvent("message", {
        data: {
          requestId: request.requestId,
          tree: encodeMarkdownTree(new BomAwareParser().parse(request.text)),
        },
      })
    );
  }
}

async function setup(multiline = false) {
  const worker = new ControlledWorker();
  const previous = setMarkdownWorkerFactory(() => worker);
  const text =
    "\uFEFF# 异步\r\n" +
    (multiline
      ? "ordinary short line\r\n".repeat(
          Math.ceil(BACKGROUND_ENTER_UNITS / 20)
        ) + "**bold**\n"
      : "**bold** ".repeat(1400)) +
    "\n尾";
  const snapshot: DocumentSnapshot = {
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "async.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
  let saved: SaveDocumentRequest | undefined;
  const transport: DocumentTransport = {
    selectDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
    readDocument: (req) => Promise.resolve({ ...req, ok: true, snapshot }),
    cancelDocument: () => Promise.resolve(null),
    releaseDocument: () => Promise.resolve(null),
    saveDocument: (req) => {
      saved = req;
      return Promise.resolve(savedReply(req, snapshot));
    },
  };
  const controller = createDocumentController(transport, () =>
    Promise.resolve(true)
  );
  await controller.select();
  const state = () => controller.getEditor(snapshot.documentId)!.state;
  const session = state().field(asyncMarkdownSession);
  session.activate();
  return {
    worker,
    snapshot,
    controller,
    state,
    session,
    saved: () => saved,
    cleanup() {
      session.destroy();
      controller.dispose();
      setMarkdownWorkerFactory(previous);
    },
  };
}

for (const multiline of [false, true])
  test(`pending ${multiline ? "multiline" : "long-line"} parsing never blocks current raw save or cross-mode selection; obsolete result cannot mark newer text ready`, async () => {
    const f = await setup(multiline);
    try {
      await waitCaptured(() => f.worker.requests.length === 1);
      expect(syntaxTreeAvailable(f.state(), f.state().doc.length)).toBe(false);
      const old = f.worker.requests[0];
      expect(
        f.controller.updateEditor(
          f.snapshot.documentId,
          f.state().update({
            changes: { from: f.state().doc.length, insert: "最新" },
            selection: { anchor: 2, head: 4 },
            userEvent: "input.type",
          })
        )
      ).toBe(true);
      expect(f.controller.toggleSourceMode()).toBe(true);
      expect(f.state().selection.main.anchor).toBe(2);
      expect(f.state().selection.main.head).toBe(4);
      await f.controller.save();
      expect(requestText(f.saved()!, f.snapshot)).toBe(
        f.snapshot.text + "最新"
      );
      expect(f.controller.getSaveStatus(f.snapshot.documentId).status).toBe(
        "saved"
      );
      expect(f.worker.requests).toHaveLength(1);
      f.worker.reply(old);
      expect(f.worker.requests).toHaveLength(2);
      expect(syntaxTreeAvailable(f.state(), f.state().doc.length)).toBe(false);
      f.worker.reply(f.worker.requests[1]);
      const parsed = ensureSyntaxTree(f.state(), f.state().doc.length, 100);
      expect(treeNodes(parsed)).toEqual(
        treeNodes(new BomAwareParser().parse(f.state().doc.toString()))
      );
      expect(syntaxTreeAvailable(f.state(), f.state().doc.length)).toBe(true);
      expect(f.state().field(rawText)).toBe(f.snapshot.text + "最新");
      expect(f.controller.getEditor(f.snapshot.documentId)!.revision).toBe(1);
      expect(f.controller.isDirty(f.snapshot.documentId)).toBe(false);
      expect(f.controller.runHistory("undo")).toBe(true);
      expect(f.state().field(rawText)).toBe(f.snapshot.text);
    } finally {
      f.cleanup();
    }
  });

test("pending session disposal plus controller safe-source and close refuse late callbacks", async () => {
  const f = await setup();
  try {
    await waitCaptured(() => f.worker.requests.length === 1);
    const callback = f.worker.onmessage;
    const request = f.worker.requests[0];
    const fault = f.state().field(editorFaultSession);
    reportEditorFault(fault, "presentation");
    expect(f.controller.enterSafeSource(f.snapshot.documentId, fault)).toBe(
      true
    );
    // Non-DOM test explicitly performs the production ViewPlugin cleanup hook.
    // Actual View destruction wiring is a separate browser verification obligation.
    f.session.destroy();
    expect(f.worker.terminated).toBe(true);
    callback?.(
      new MessageEvent("message", {
        data: {
          requestId: request.requestId,
          tree: encodeMarkdownTree(new BomAwareParser().parse(request.text)),
        },
      })
    );
    expect(f.controller.isSafeSource(f.snapshot.documentId)).toBe(true);
    expect(f.state().field(rawText)).toBe(f.snapshot.text);
    expect(syntaxTreeAvailable(f.state(), f.state().doc.length)).toBe(false);
    await f.controller.closeTab(f.snapshot.documentId);
    callback?.(
      new MessageEvent("message", {
        data: { requestId: request.requestId, error: true },
      })
    );
    expect(f.controller.getEditor(f.snapshot.documentId)).toBeUndefined();
    expect(f.worker.requests).toHaveLength(1);
  } finally {
    f.cleanup();
  }
});
