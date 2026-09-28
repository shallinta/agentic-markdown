import { ParseContext } from "@codemirror/language";
import { StateField, type Text } from "@codemirror/state";
import { ViewPlugin } from "@codemirror/view";
import {
  Parser,
  type Input,
  type Tree,
  type TreeFragment,
} from "@lezer/common";

import { needsBackgroundParsing } from "./background-parsing";
import {
  editorFaultSession,
  reportEditorFault,
  type EditorFaultSession,
} from "./editor-fault";
import {
  estimateMarkdownTreeCost,
  MARKDOWN_ACTIVE_TREE_BUDGET,
  MARKDOWN_DERIVED_TOTAL_BUDGET,
  type MarkdownTreeCost,
} from "./markdown-cache-cost";
import {
  decodeMarkdownTree,
  type MarkdownParseRequest,
  type MarkdownParseResponse,
} from "./markdown-tree-wire";

export interface MarkdownWorker {
  postMessage(message: MarkdownParseRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<MarkdownParseResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
}
type WorkerFactory = () => MarkdownWorker;
let workerFactory: WorkerFactory | undefined;
export type MarkdownWorkPolicy = "wait" | "quiet-restart";
let workPolicy: MarkdownWorkPolicy = "wait";
/** Captured per session, allowing isolated same-build diagnostic comparisons. */
export function setMarkdownWorkPolicy(policy: MarkdownWorkPolicy) {
  const previous = workPolicy;
  workPolicy = policy;
  return previous;
}
/** Browser entry installs the bundled worker. Existing non-browser consumers stay synchronous. */
export function setMarkdownWorkerFactory(factory: WorkerFactory | undefined) {
  const previous = workerFactory;
  workerFactory = factory;
  return previous;
}
interface Request {
  id: number;
  doc: Text;
  promise: Promise<void>;
  resolve: () => void;
  tree?: Tree;
  cost?: MarkdownTreeCost;
}

/** Derived, disposable parser work only. Text/history/save state never lives here. */
export class MarkdownParseSession {
  readonly factory = workerFactory;
  readonly policy = workPolicy;
  private worker?: MarkdownWorker;
  private active = false;
  private serial = 0;
  private latest?: Request;
  private running?: Request;
  private timer?: ReturnType<typeof setTimeout>;
  private quietTimer?: ReturnType<typeof setTimeout>;
  private restartedSinceCompletion = false;
  private counts = {
    started: 0,
    completed: 0,
    terminated: 0,
    staleDiscarded: 0,
    restarts: 0,
  };
  constructor(private readonly fault: EditorFaultSession) {}
  request(doc: Text): Request {
    if (this.latest?.doc === doc) return this.latest;
    this.latest?.resolve();
    let resolve = () => {
      /* Assigned by the synchronous Promise executor below. */
    };
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.latest = { id: ++this.serial, doc, promise, resolve };
    if (this.quietTimer) clearTimeout(this.quietTimer);
    if (
      this.policy === "quiet-restart" &&
      this.running &&
      !this.restartedSinceCompletion
    ) {
      // Experimental coalescing interval, not an input latency target.
      this.quietTimer = setTimeout(() => {
        this.quietTimer = undefined;
        if (
          !this.active ||
          !this.running ||
          this.running === this.latest ||
          this.restartedSinceCompletion
        )
          return;
        this.restartedSinceCompletion = true;
        this.counts.restarts++;
        this.running.resolve();
        this.running = undefined;
        this.releaseWorker();
        this.pump();
      }, 32);
    }
    // Avoid flattening/posting the document inside synchronous state.update.
    queueMicrotask(() => this.pump());
    return this.latest;
  }
  activate() {
    this.active = true;
    this.pump();
  }
  snapshot() {
    const cost = this.latest?.cost;
    const accountedBytes = cost?.accountedBytes ?? 0;
    return {
      ...this.counts,
      runningCount: this.running ? 1 : 0,
      pendingCount:
        this.latest && this.latest !== this.running && !this.latest.tree
          ? 1
          : 0,
      treeBufferBytes: cost?.bufferBytes ?? 0,
      treeEstimatedObjectBytes: cost?.estimatedObjectBytes ?? 0,
      treeAccountedBytes: accountedBytes,
      activeTreeBudgetBytes: MARKDOWN_ACTIVE_TREE_BUDGET,
      totalBudgetBytes: MARKDOWN_DERIVED_TOTAL_BUDGET,
      pinnedExcessBytes: Math.max(
        0,
        accountedBytes - MARKDOWN_DERIVED_TOTAL_BUDGET
      ),
      textReferenceCount:
        (this.latest ? 1 : 0) +
        (this.running && this.running !== this.latest ? 1 : 0),
      // Already absent in the baseline; these are ownership invariants, not savings.
      retainedWireBytes: 0,
      retiredTreeBytes: 0,
    };
  }
  private releaseWorker() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.worker) {
      this.worker.onmessage =
        this.worker.onerror =
        this.worker.onmessageerror =
          null;
      this.worker.terminate();
      this.counts.terminated++;
      this.worker = undefined;
    }
  }
  /** A short document keeps its live View but no longer owns background work. */
  cancelPending() {
    const active = this.active;
    const latest = this.latest;
    const running = this.running;
    this.destroy();
    this.active = active;
    // The language still exists. Release its old readiness wait without
    // publishing an obsolete tree; the next parse uses the short-text path.
    latest?.resolve();
    running?.resolve();
  }
  destroy() {
    this.active = false;
    // Do not wake CM's retired parse scheduler after its language field was removed.
    this.latest = this.running = undefined;
    if (this.quietTimer) clearTimeout(this.quietTimer);
    this.quietTimer = undefined;
    this.restartedSinceCompletion = false;
    this.releaseWorker();
  }
  private fail() {
    reportEditorFault(this.fault, "parser");
    this.destroy();
  }
  private pump() {
    if (
      !this.active ||
      !this.factory ||
      this.fault.fault ||
      this.running ||
      !this.latest ||
      this.latest.tree
    )
      return;
    try {
      if (!this.worker) {
        const worker = this.factory();
        this.worker = worker;
        worker.onerror = worker.onmessageerror = () => {
          if (this.active && this.worker === worker) this.fail();
        };
        worker.onmessage = (event) => {
          if (!this.active || this.worker !== worker) return;
          const running = this.running;
          if (
            !running ||
            !event.data ||
            typeof event.data !== "object" ||
            event.data.requestId !== running.id
          ) {
            this.fail();
            return;
          }
          if (this.timer) clearTimeout(this.timer);
          this.timer = undefined;
          this.running = undefined;
          this.counts.completed++;
          // A structured parse failure belongs to its text version, unlike a
          // worker-level error. Retired versions cannot fault newer input.
          if (running !== this.latest) {
            this.counts.staleDiscarded++;
            running.resolve();
            this.pump();
            return;
          }
          if ("error" in event.data) {
            this.fail();
            return;
          }
          try {
            if (running === this.latest) {
              running.tree = decodeMarkdownTree(event.data.tree);
              if (running.tree.length !== running.doc.length)
                throw new Error("Invalid parse length");
              // Once per accepted tree, never per key or snapshot call. The tree
              // shared with CM is counted once, not separately as latest.tree.
              running.cost = estimateMarkdownTreeCost(running.tree);
            }
          } catch {
            this.fail();
            return;
          }
          running.resolve();
          this.restartedSinceCompletion = false;
          this.pump();
        };
      }
      this.running = this.latest;
      this.counts.started++;
      // A hung worker is a parser fault, not a successful parse or synchronous fallback.
      this.timer = setTimeout(() => this.fail(), 30_000);
      this.worker.postMessage({
        requestId: this.running.id,
        text: this.running.doc.toString(),
      });
    } catch {
      this.fail();
    }
  }
}
export const asyncMarkdownSession = StateField.define<MarkdownParseSession>({
  create: (state) => new MarkdownParseSession(state.field(editorFaultSession)),
  update: (value, transaction) => {
    if (transaction.docChanged && !needsBackgroundParsing(transaction.state))
      value.cancelPending();
    return value;
  },
});
export const asyncMarkdownLifecycle = ViewPlugin.fromClass(
  class {
    private session: MarkdownParseSession;
    constructor(view: import("@codemirror/view").EditorView) {
      this.session = view.state.field(asyncMarkdownSession);
      if (this.session.factory && needsBackgroundParsing(view.state))
        this.session.request(view.state.doc);
      this.session.activate();
    }
    destroy() {
      this.session.destroy();
    }
  }
);

export class AsyncLongLineParser extends Parser {
  constructor(private readonly synchronous: Parser) {
    super();
  }
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ) {
    const state = ParseContext.get()?.state;
    const session = state?.field(asyncMarkdownSession, false);
    if (!state || !session?.factory || !needsBackgroundParsing(state))
      return this.synchronous.startParse(input, fragments, ranges);
    const request = session.request(state.doc);
    if (!request.tree)
      return ParseContext.getSkippingParser(request.promise).startParse(
        input,
        fragments,
        ranges
      );
    const tree = request.tree;
    let stopped: number | null = null;
    return {
      advance: () => tree,
      parsedPos: tree.length,
      get stoppedAt() {
        return stopped;
      },
      stopAt(position: number) {
        stopped = position;
      },
    };
  }
}
