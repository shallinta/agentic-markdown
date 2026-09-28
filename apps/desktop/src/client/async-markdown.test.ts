import { afterEach, expect, spyOn, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { NodeProp, Tree } from "@lezer/common";

import {
  asyncMarkdownSession,
  setMarkdownWorkerFactory,
  setMarkdownWorkPolicy,
  type MarkdownWorker,
} from "./async-markdown";
import {
  BACKGROUND_ENTER_UNITS,
  BACKGROUND_EXIT_UNITS,
  largeDocumentParsing,
  needsBackgroundParsing,
} from "./background-parsing";
import { BomAwareParser } from "./bom-aware-parser";
import { editorFaultSession } from "./editor-fault";
import { longLineProtection } from "./long-line-protection";
import {
  encodeMarkdownTree,
  decodeMarkdownTree,
  type MarkdownParseRequest,
  type MarkdownParseResponse,
} from "./markdown-tree-wire";
import { createRawEditorState, rawText } from "./raw-buffer";

class ControlledWorker implements MarkdownWorker {
  onmessage: MarkdownWorker["onmessage"] = null;
  onerror: MarkdownWorker["onerror"] = null;
  onmessageerror: MarkdownWorker["onmessageerror"] = null;
  requests: MarkdownParseRequest[] = [];
  terminated = false;
  postMessage(request: MarkdownParseRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  complete(index = this.requests.length - 1) {
    const request = this.requests[index];
    if (!request) throw new Error("Missing request");
    this.onmessage?.(
      new MessageEvent<MarkdownParseResponse>("message", {
        data: {
          requestId: request.requestId,
          tree: encodeMarkdownTree(new BomAwareParser().parse(request.text)),
        },
      })
    );
  }
}
afterEach(() => {
  setMarkdownWorkerFactory(undefined);
  setMarkdownWorkPolicy("wait");
});
const dense = "**bold** [link](x) &amp; ".repeat(9000);

test("multiline routing decides before the first synchronous parse and preserves independent presentation", () => {
  const parser = spyOn(BomAwareParser.prototype, "createParse");
  const worker = new ControlledWorker();
  setMarkdownWorkerFactory(() => worker);
  try {
    const state = createRawEditorState(
      "x\n".repeat(BACKGROUND_ENTER_UNITS / 2)
    );
    expect(parser).not.toHaveBeenCalled();
    expect(state.field(longLineProtection)).toEqual([]);
    expect(state.field(largeDocumentParsing)).toBe(true);
    expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
    const session = state.field(asyncMarkdownSession);
    expect(worker.requests).toHaveLength(0);
    session.activate();
    expect(worker.requests).toHaveLength(1);
    worker.complete();
    expect(ensureSyntaxTree(state, state.doc.length, 100)?.length).toBe(
      state.doc.length
    );
    session.destroy();
  } finally {
    parser.mockRestore();
  }
});

test("total-size hysteresis survives boundary edits/undo and cancels only below exit with no long line", async () => {
  const workers: ControlledWorker[] = [];
  setMarkdownWorkerFactory(() => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  });
  let state = createRawEditorState(
    "x\n".repeat(BACKGROUND_ENTER_UNITS / 2 - 1)
  );
  const session = state.field(asyncMarkdownSession);
  session.activate();
  expect(needsBackgroundParsing(state)).toBe(false);
  const edit = (from: number, to: number, insert: string) => {
    state = state.update({ changes: { from, to, insert } }).state;
  };
  edit(state.doc.length, state.doc.length, "x\n");
  await Promise.resolve();
  expect(workers).toHaveLength(1);
  expect(needsBackgroundParsing(state)).toBe(true);
  for (let i = 0; i < 3; i++) {
    edit(state.doc.length - 2, state.doc.length, "");
    edit(state.doc.length, state.doc.length, "x\n");
  }
  await Promise.resolve();
  expect(workers).toHaveLength(1);
  expect(workers[0].terminated).toBe(false);
  const late = workers[0].onerror;
  edit(BACKGROUND_EXIT_UNITS - 2, state.doc.length, "");
  expect(needsBackgroundParsing(state)).toBe(false);
  expect(workers[0].terminated).toBe(true);
  late?.(new ErrorEvent("error"));
  expect(state.field(editorFaultSession).fault).toBeNull();
  const dispatch = (transaction: import("@codemirror/state").Transaction) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  // Ungrouped synthetic transactions may undo the whole edit group; redo must
  // nevertheless preserve raw history and the appropriate routing decision.
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.doc.length).toBe(BACKGROUND_EXIT_UNITS - 2);
  expect(needsBackgroundParsing(state)).toBe(false);
  edit(0, state.doc.length, "z".repeat(10_000));
  await Promise.resolve();
  expect(state.field(largeDocumentParsing)).toBe(false);
  expect(needsBackgroundParsing(state)).toBe(true);
  expect(workers).toHaveLength(2);
  session.destroy();
});

test("accepted over-budget active tree stays ready and fault-free until explicit disposal", () => {
  const raw = "**bold** [link](local.md) &amp; \\* ".repeat(16_000);
  expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(1024 * 1024);
  const worker = new ControlledWorker();
  setMarkdownWorkerFactory(() => worker);
  const state = createRawEditorState(raw);
  const session = state.field(asyncMarkdownSession);
  session.activate();
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
  worker.complete();
  const tree = ensureSyntaxTree(state, state.doc.length, 100);
  expect(tree?.length).toBe(raw.length);
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  expect(tree && encodeMarkdownTree(tree)).toEqual(
    encodeMarkdownTree(new BomAwareParser().parse(raw))
  );
  const held = session.snapshot();
  expect(held.treeAccountedBytes).toBeGreaterThan(held.activeTreeBudgetBytes);
  expect(held.pinnedExcessBytes).toBe(
    held.treeAccountedBytes - held.totalBudgetBytes
  );
  expect(held.runningCount).toBe(0);
  expect(held.pendingCount).toBe(0);
  expect(state.field(editorFaultSession).fault).toBeNull();
  expect(state.field(rawText)).toBe(raw);
  expect(worker.terminated).toBe(false);
  expect(ensureSyntaxTree(state, state.doc.length, 100)).toBe(tree);
  expect(worker.requests.length).toBe(1);
  session.destroy();
  expect(worker.terminated).toBe(true);
  expect(session.snapshot().treeAccountedBytes).toBe(0);
  expect(session.snapshot().pinnedExcessBytes).toBe(0);
  expect(session.snapshot().textReferenceCount).toBe(0);
  // Releasing our reference is not a claim that CM or the OS freed this tree.
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  expect(state.field(rawText)).toBe(raw);
});

test("quiet restart coalesces latest and permits at most one cancellation before completion", async () => {
  setMarkdownWorkPolicy("quiet-restart");
  const workers: ControlledWorker[] = [];
  setMarkdownWorkerFactory(() => {
    const worker = new ControlledWorker();
    workers.push(worker);
    return worker;
  });
  let state = createRawEditorState("x".repeat(10_000));
  const session = state.field(asyncMarkdownSession);
  session.activate();
  for (let i = 0; i < 3; i++)
    state = state.update({ changes: { from: 0, insert: "z" } }).state;
  await Bun.sleep(45);
  expect(workers.length).toBe(2);
  expect(workers[0]?.terminated).toBe(true);
  expect(workers[1]?.requests[0]?.text).toBe(state.doc.toString());
  state = state.update({ changes: { from: 0, insert: "Q" } }).state;
  await Bun.sleep(45);
  expect(workers.length).toBe(2);
  workers[1]?.complete(0);
  expect(workers[1]?.requests.length).toBe(2);
  workers[1]?.complete(1);
  expect(ensureSyntaxTree(state, state.doc.length, 100)).not.toBeNull();
  expect(session.snapshot().restarts).toBe(1);
  session.destroy();
  expect(session.snapshot().runningCount).toBe(0);
  expect(session.snapshot().pendingCount).toBe(0);
});

test("destroy before quiet interval never creates a replacement worker", async () => {
  setMarkdownWorkPolicy("quiet-restart");
  let created = 0;
  setMarkdownWorkerFactory(() => {
    created++;
    return new ControlledWorker();
  });
  let state = createRawEditorState("x".repeat(10_000));
  const session = state.field(asyncMarkdownSession);
  session.activate();
  state = state.update({ changes: { from: 0, insert: "z" } }).state;
  session.destroy();
  await Bun.sleep(45);
  expect(created).toBe(1);
  expect(state.doc.length).toBe(10_001);
  expect(session.snapshot().restarts).toBe(0);
});

test("public skipping parser is unavailable until worker tree; full ready beyond viewport", async () => {
  const worker = new ControlledWorker();
  setMarkdownWorkerFactory(() => worker);
  const state = createRawEditorState(dense);
  expect(worker.requests.length).toBe(0);
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
  const session = state.field(asyncMarkdownSession);
  session.activate();
  expect(worker.requests.length).toBe(1);
  worker.complete();
  await Promise.resolve();
  const tree = ensureSyntaxTree(state, state.doc.length, 100);
  expect(tree && encodeMarkdownTree(tree)).toEqual(
    encodeMarkdownTree(new BomAwareParser().parse(dense))
  );
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  const beforeRelease = session.snapshot();
  expect(beforeRelease.treeAccountedBytes).toBeGreaterThan(0);
  expect(beforeRelease.treeAccountedBytes).toBe(
    beforeRelease.treeBufferBytes + beforeRelease.treeEstimatedObjectBytes
  );
  expect(beforeRelease.retainedWireBytes).toBe(0);
  expect(beforeRelease.retiredTreeBytes).toBe(0);
  session.destroy();
  expect(worker.terminated).toBe(true);
  expect(session.snapshot().treeAccountedBytes).toBe(0);
  expect(session.snapshot().textReferenceCount).toBe(0);
});

test("running plus latest only; stale completion does not become current tree", async () => {
  const worker = new ControlledWorker();
  setMarkdownWorkerFactory(() => worker);
  let state = createRawEditorState(dense);
  const session = state.field(asyncMarkdownSession);
  session.activate();
  state = state.update({ changes: { from: 0, insert: "A" } }).state;
  state = state.update({ changes: { from: 0, insert: "B" } }).state;
  await Promise.resolve();
  expect(worker.requests.length).toBe(1);
  worker.complete(0);
  expect(worker.requests.length).toBe(2);
  expect(worker.requests[1]?.text).toBe("BA" + dense);
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
  worker.complete(1);
  expect(ensureSyntaxTree(state, state.doc.length, 100)?.length).toBe(
    state.doc.length
  );
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  session.destroy();
});

test("ordinary text and absent factory preserve synchronous parser", () => {
  const worker = new ControlledWorker();
  setMarkdownWorkerFactory(() => worker);
  const state = createRawEditorState("# normal\n**bold**");
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  state.field(asyncMarkdownSession).activate();
  expect(worker.requests.length).toBe(0);
  state.field(asyncMarkdownSession).destroy();
  setMarkdownWorkerFactory(undefined);
  const sync = createRawEditorState(dense);
  expect(ensureSyntaxTree(sync, sync.doc.length, 100)).not.toBeNull();
});

test("obsolete structured parse error is ignored and latest text becomes ready", async () => {
  const worker = new ControlledWorker();
  setMarkdownWorkerFactory(() => worker);
  let state = createRawEditorState(dense);
  const session = state.field(asyncMarkdownSession);
  session.activate();
  const oldId = worker.requests[0].requestId;
  state = state.update({ changes: { from: 0, insert: "latest " } }).state;
  await Promise.resolve();
  worker.onmessage?.(
    new MessageEvent("message", {
      data: { requestId: oldId, error: true },
    })
  );
  expect(state.field(editorFaultSession).fault).toBeNull();
  expect(worker.terminated).toBe(false);
  expect(worker.requests).toHaveLength(2);
  expect(worker.requests[1].text).toBe("latest " + dense);
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
  worker.complete();
  expect(ensureSyntaxTree(state, state.doc.length, 100)?.length).toBe(
    state.doc.length
  );
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  session.destroy();
});

test("long to short retires old callbacks; long again starts a fresh worker without reactivation", async () => {
  const first = new ControlledWorker(),
    second = new ControlledWorker();
  let calls = 0;
  setMarkdownWorkerFactory(() => (calls++ === 0 ? first : second));
  let state = createRawEditorState(dense);
  const session = state.field(asyncMarkdownSession);
  session.activate();
  const message = first.onmessage,
    error = first.onerror,
    messageError = first.onmessageerror;
  const request = first.requests[0];
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: "# short" },
  }).state;
  expect(first.terminated).toBe(true);
  expect(ensureSyntaxTree(state, state.doc.length, 100)?.length).toBe(
    state.doc.length
  );
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  message?.(
    new MessageEvent("message", {
      data: { requestId: request.requestId, error: true },
    })
  );
  expect(state.field(editorFaultSession).fault).toBeNull();
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: dense + " again" },
  }).state;
  await Promise.resolve();
  expect(second.requests).toHaveLength(1);
  message?.(
    new MessageEvent("message", {
      data: {
        requestId: request.requestId,
        tree: encodeMarkdownTree(new BomAwareParser().parse(request.text)),
      },
    })
  );
  error?.(new ErrorEvent("error"));
  messageError?.(new MessageEvent("messageerror"));
  expect(state.field(editorFaultSession).fault).toBeNull();
  expect(second.terminated).toBe(false);
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
  second.complete();
  expect(ensureSyntaxTree(state, state.doc.length, 100)?.length).toBe(
    state.doc.length
  );
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(true);
  session.destroy();
});

test("worker failure reports parser fault without synchronous retry", () => {
  setMarkdownWorkerFactory(() => {
    throw new Error("worker denied");
  });
  const state = createRawEditorState(dense);
  state.field(asyncMarkdownSession).activate();
  expect(state.field(editorFaultSession).fault).toBe("parser");
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
});

test("destroyed worker late errors cannot fault or terminate a resumed session", () => {
  const first = new ControlledWorker(),
    second = new ControlledWorker();
  let calls = 0;
  setMarkdownWorkerFactory(() => (calls++ === 0 ? first : second));
  const state = createRawEditorState(dense);
  const session = state.field(asyncMarkdownSession);
  session.activate();
  const staleError = first.onerror,
    staleDecodeError = first.onmessageerror;
  session.destroy();
  session.request(state.doc);
  session.activate();
  staleError?.(new ErrorEvent("error"));
  staleDecodeError?.(new MessageEvent("messageerror"));
  expect(state.field(editorFaultSession).fault).toBeNull();
  expect(second.terminated).toBe(false);
  second.complete();
  expect(ensureSyntaxTree(state, state.doc.length, 100)?.length).toBe(
    state.doc.length
  );
  session.destroy();
});

test("wire round trip preserves node positions, type props, BOM and contextHash", () => {
  const parser = new BomAwareParser();
  const tree = parser.parse(
    "\uFEFF# heading\n\n> quote **bold**\n\n- item\n\n```js\na\n```\n".repeat(
      100
    )
  );
  const restored = decodeMarkdownTree(
    structuredClone(encodeMarkdownTree(tree))
  );
  expect(encodeMarkdownTree(restored)).toEqual(encodeMarkdownTree(tree));
  const compare = (a: Tree, b: Tree) => {
    expect(b.type).toBe(a.type);
    expect(b.positions).toEqual(a.positions);
    expect(b.length).toBe(a.length);
    expect(b.prop(NodeProp.contextHash)).toBe(a.prop(NodeProp.contextHash));
    for (let i = 0; i < a.children.length; i++) {
      const left = a.children[i],
        right = b.children[i];
      if (left instanceof Tree && right instanceof Tree) compare(left, right);
      else expect(right).toEqual(left);
    }
  };
  compare(tree, restored);
  const alien = new NodeProp<number>({ perNode: true });
  expect(() =>
    encodeMarkdownTree(new Tree(tree.type, [], [], 0, [[alien, 1]]))
  ).toThrow();
});
