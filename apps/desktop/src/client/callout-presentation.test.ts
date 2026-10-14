import { afterEach, expect, test } from "bun:test";

import type { TransactionSpec } from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import {
  CalloutPresentation,
  registerCalloutView,
  setCalloutWorkerFactory,
} from "./callout-presentation";
import type { CalloutSummaryWorker } from "./callout-summary-owner";
import {
  CALLOUT_SUMMARY_CONFIG,
  type CalloutSummaryRequest,
} from "./callout-summary-protocol";
import { createRawEditorState, rawText } from "./raw-buffer";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300 && !predicate(); i++) await sleep(5);
  expect(predicate()).toBe(true);
}
afterEach(() => setCalloutWorkerFactory(undefined));
function fixture() {
  let accepted = createRawEditorState("> [!NOTE]\n> body\n\nordinary"),
    state = accepted,
    blocked = false,
    composing = false;
  const identity = {},
    listeners = new Set<() => void>();
  let starts = 0,
    stops = 0,
    effects = 0;
  setCalloutWorkerFactory(() => {
    const worker: CalloutSummaryWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      terminate() {
        stops++;
      },
      postMessage(request: CalloutSummaryRequest) {
        starts++;
        queueMicrotask(() =>
          worker.onmessage?.({
            data: {
              requestId: request.requestId,
              documentId: request.documentId,
              revision: request.revision,
              config: request.config,
              definitions: [],
            },
          } as MessageEvent)
        );
      },
    };
    return worker;
  });
  let ranges = [{ from: 0, to: 16 }];
  // Public plugin class with a minimal view scheduling seam, NOT a DOM EditorView.
  const seam = {
    get state() {
      return state;
    },
    get visibleRanges() {
      return ranges;
    },
    get compositionStarted() {
      return composing;
    },
    get composing() {
      return composing;
    },
    plugin() {
      return plugin;
    },
    dispatch(spec: TransactionSpec) {
      effects++;
      const transaction = state.update(spec);
      accepted = transaction.state;
      for (const listener of listeners) listener();
      state = accepted;
      plugin.update({
        view,
        transactions: [transaction],
      } as unknown as ViewUpdate);
    },
  };
  const view = seam as unknown as EditorView;
  const plugin = new CalloutPresentation(view);
  const release = registerCalloutView(
    view,
    () =>
      blocked || composing || accepted !== state
        ? null
        : {
            documentId: "test",
            revision: 1,
            doc: state.doc,
            rawText: state.field(rawText),
            identity,
            config: CALLOUT_SUMMARY_CONFIG,
          },
    () => {
      /* Failure callback is outside this scheduling seam. */
    },
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  );
  return {
    plugin,
    get starts() {
      return starts;
    },
    get effects() {
      return effects;
    },
    get stops() {
      return stops;
    },
    update(spec: TransactionSpec) {
      seam.dispatch(spec);
    },
    scroll(from: number, to: number) {
      ranges = [{ from, to }];
      plugin.update({ view, transactions: [] } as unknown as ViewUpdate);
    },
    composition(on: boolean) {
      composing = on;
      plugin.observe();
    },
    block(on: boolean) {
      blocked = on;
      for (const listener of listeners) listener();
    },
    dispose() {
      release();
      plugin.destroy();
    },
  };
}
test("presentation class observes controller-accepted updates and reuses summary on selection", async () => {
  const f = fixture();
  try {
    await until(() => f.plugin.decorations.size > 0);
    expect(f.starts).toBe(1);
    f.update({ selection: { anchor: 12 } });
    await sleep(20);
    expect(f.starts).toBe(1);
    f.scroll(10, 15);
    await sleep(20);
    expect(f.starts).toBe(1);
    expect(f.plugin.decorations.size).toBeGreaterThan(0);
  } finally {
    f.dispose();
  }
});
test("presentation composition suppresses reply dispatch then resumes and offscreen clears eligibility", async () => {
  const f = fixture();
  try {
    f.composition(true);
    await sleep(150);
    expect(f.starts).toBe(0);
    expect(f.effects).toBe(0);
    f.composition(false);
    await until(() => f.plugin.decorations.size > 0);
    f.scroll(19, 25);
    await sleep(30);
    expect(f.plugin.decorations.size).toBe(0);
    f.scroll(0, 15);
    await until(() => f.plugin.decorations.size > 0);
    f.block(true);
    await sleep(10);
    f.block(false);
    await until(() => f.starts >= 3);
  } finally {
    f.dispose();
  }
});
