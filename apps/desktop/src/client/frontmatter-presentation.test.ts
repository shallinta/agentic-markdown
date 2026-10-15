import { expect, test } from "bun:test";

import type { TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import { switchEditorMode } from "./editor-mode";
import { diagnoseFrontmatter } from "./frontmatter-diagnostic";
import type { FrontmatterDiagnosticWorker } from "./frontmatter-diagnostic-owner";
import {
  FRONTMATTER_DIAGNOSTIC_CONFIG,
  type FrontmatterDiagnosticRequest,
} from "./frontmatter-diagnostic-protocol";
import {
  FrontmatterPresentation,
  setFrontmatterDiagnosticFactory,
} from "./frontmatter-presentation";
import { createRawEditorState } from "./raw-buffer";

test("actual plugin class invalidates IME in-flight result, defers restart, reuses body-external changes and retires", async () => {
  const workers: {
    worker: FrontmatterDiagnosticWorker;
    sent: FrontmatterDiagnosticRequest[];
    retired: number;
  }[] = [];
  const previous = setFrontmatterDiagnosticFactory(() => {
    const record = {
      worker: null as unknown as FrontmatterDiagnosticWorker,
      sent: [] as FrontmatterDiagnosticRequest[],
      retired: 0,
    };
    record.worker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage: (r) => {
        record.sent.push(r);
      },
      terminate: () => {
        record.retired++;
      },
    };
    workers.push(record);
    return record.worker;
  });
  let dispatches = 0;
  const view = {
    state: createRawEditorState("---\na: 1\n---\nbody"),
    composing: false,
    compositionStarted: false,
    dispatch(spec: TransactionSpec) {
      dispatches++;
      this.state = this.state.update(spec).state;
    },
  };
  const plugin = new FrontmatterPresentation(view as unknown as EditorView);
  try {
    plugin.observe();
    expect(workers).toHaveLength(1);
    const old = workers[0],
      late = old.worker.onmessage!;
    view.composing = true;
    view.compositionStarted = true;
    plugin.compositionStart();
    const before = dispatches;
    late({
      data: {
        config: FRONTMATTER_DIAGNOSTIC_CONFIG,
        requestId: old.sent[0].requestId,
        result: diagnoseFrontmatter("a: 1\n"),
      },
    } as MessageEvent);
    await Promise.resolve();
    expect(dispatches).toBe(before);
    expect(old.retired).toBe(1);
    plugin.compositionEnd();
    expect(workers).toHaveLength(1);
    view.composing = false;
    view.compositionStarted = false;
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(workers).toHaveLength(2);
    const current = workers[1];
    current.worker.onmessage!({
      data: {
        config: FRONTMATTER_DIAGNOSTIC_CONFIG,
        requestId: current.sent[0].requestId,
        result: diagnoseFrontmatter("a: 1\n"),
      },
    } as MessageEvent);
    await Promise.resolve();
    const startState = view.state,
      tr = startState.update({
        changes: { from: startState.doc.length, insert: "!" },
      });
    view.state = tr.state;
    plugin.update({
      docChanged: true,
      changes: tr.changes,
      startState,
      state: tr.state,
    } as ViewUpdate);
    plugin.observe();
    expect(workers).toHaveLength(2);
    expect(plugin.decorations.size).toBeGreaterThan(0);
  } finally {
    plugin.destroy();
    setFrontmatterDiagnosticFactory(previous);
  }
  expect(workers.every((w) => w.retired === 1)).toBe(true);
});

test("actual plugin source transition cancels in-flight diagnosis", async () => {
  let created = 0,
    retired = 0;
  const previous = setFrontmatterDiagnosticFactory(() => {
    created++;
    return {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage: () => undefined,
      terminate: () => {
        retired++;
      },
    };
  });
  const view = {
    state: createRawEditorState("---\na: 1\n---\nbody"),
    composing: false,
    compositionStarted: false,
    dispatch(spec: TransactionSpec) {
      this.state = this.state.update(spec).state;
    },
  };
  const plugin = new FrontmatterPresentation(view as unknown as EditorView);
  try {
    plugin.observe();
    expect(created).toBe(1);
    const startState = view.state,
      tr = startState.update({ effects: switchEditorMode("source") });
    view.state = tr.state;
    plugin.update({
      docChanged: false,
      changes: tr.changes,
      startState,
      state: tr.state,
    } as ViewUpdate);
    plugin.observe();
    expect(retired).toBe(1);
    expect(plugin.decorations.size).toBe(0);
    await Promise.resolve();
    expect(created).toBe(1);
  } finally {
    plugin.destroy();
    setFrontmatterDiagnosticFactory(previous);
  }
});
