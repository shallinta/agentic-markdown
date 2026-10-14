import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { StateEffect, type Range, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Tree } from "@lezer/common";

import { CALLOUT_PRESENTATION, type CalloutType } from "./callout-extension";
import {
  advanceCalloutWork,
  hasCalloutCandidate,
  queryEditingCallouts,
  type EditingCallout,
  type CalloutQueryCache,
  type CalloutRange,
} from "./callout-query";
import {
  createCalloutSummaryOwner,
  type CalloutSummarySource,
  type CalloutSummaryWorker,
} from "./callout-summary-owner";
import { touchesProtected, longLineProtection } from "./long-line-protection";

const readyEffect = StateEffect.define<null>();
let workerFactory: (() => CalloutSummaryWorker) | undefined;
export function setCalloutWorkerFactory(
  factory: (() => CalloutSummaryWorker) | undefined
) {
  workerFactory = factory;
}
interface Binding {
  current: () => CalloutSummarySource | null;
  failed: (retry: () => void) => void;
}
const bindings = new WeakMap<EditorView, Binding>();
export function registerCalloutView(
  view: EditorView,
  current: Binding["current"],
  failed: Binding["failed"],
  subscribe: (listener: () => void) => () => void
) {
  const binding = { current, failed };
  bindings.set(view, binding);
  // Controller publishes before view.update: observe in a microtask, plus plugin.update.
  const observe = () =>
    queueMicrotask(() => {
      if (bindings.get(view) === binding)
        view.plugin(calloutPresentation)?.observe();
    });
  const unsubscribe = subscribe(observe);
  observe();
  return () => {
    unsubscribe();
    if (bindings.get(view) === binding) {
      bindings.delete(view);
      view.plugin(calloutPresentation)?.observe();
    }
  };
}
class CalloutTitle extends WidgetType {
  constructor(readonly type: CalloutType) {
    super();
  }
  eq(other: CalloutTitle) {
    return other.type === this.type;
  }
  toDOM() {
    const span = document.createElement("span"),
      item = CALLOUT_PRESENTATION[this.type];
    span.className = "cm-callout-title";
    span.textContent = `${item.icon} ${item.title}`;
    span.setAttribute("aria-label", item.title);
    return span;
  }
  ignoreEvent() {
    return true;
  }
}
function decorations(
  view: EditorView,
  items: readonly EditingCallout[]
): DecorationSet {
  const result: Range<Decoration>[] = [],
    lines = new Set<number>();
  const protectedLines = view.state.field(longLineProtection, false) ?? [];
  for (const item of items) {
    const active = view.state.selection.ranges.some(
      (range) => range.from <= item.to && range.to >= item.from
    );
    if (
      !active &&
      view.visibleRanges.some(
        (range) => range.from <= item.markerTo && range.to >= item.markerFrom
      ) &&
      !touchesProtected(protectedLines, item.markerFrom, item.markerTo)
    )
      result.push(
        Decoration.replace({ widget: new CalloutTitle(item.type) }).range(
          item.markerFrom,
          item.markerTo
        )
      );
    for (const range of view.visibleRanges) {
      if (range.to < item.from || range.from > item.to) continue;
      let line = view.state.doc.lineAt(Math.max(range.from, item.from));
      while (line.from <= Math.min(range.to, item.to)) {
        if (!lines.has(line.from)) {
          lines.add(line.from);
          result.push(
            Decoration.line({
              class: `cm-callout cm-callout-${item.type.toLowerCase()}`,
            }).range(line.from)
          );
        }
        if (line.to >= item.to || line.to === view.state.doc.length) break;
        line = view.state.doc.lineAt(line.to + 1);
      }
    }
  }
  return Decoration.set(result, true);
}
export class CalloutPresentation {
    decorations: DecorationSet = Decoration.none;
    private owner: ReturnType<typeof createCalloutSummaryOwner> | undefined;
    private binding: Binding | undefined;
    private unsubscribe: (() => void) | undefined;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private dead = false;
    private doc: Text | undefined;
    private tree: Tree | undefined;
    private ranges = "";
    private candidate = false;
    private work: Generator<number, boolean | EditingCallout[]> | undefined;
    private phase: "candidate" | "body" = "candidate";
    private definitions: ReadonlySet<string> | undefined;
    private items: EditingCallout[] = [];
    private cache: CalloutQueryCache = new Map();
    private queryNeeded = false;
    private pendingTree = false;
    private workingQuote: CalloutRange | undefined;
    constructor(private view: EditorView) {
      queueMicrotask(() => this.observe());
    }
    private clearWork() {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.work = undefined;
      this.workingQuote = undefined;
    }
    private changed() {
      if (
        !this.dead &&
        !this.view.compositionStarted &&
        !this.view.composing &&
        this.binding?.current()
      )
        this.view.dispatch({ effects: readyEffect.of(null) });
    }
    observe() {
      if (this.dead) return;
      const binding = bindings.get(this.view);
      if (binding !== this.binding) {
        this.unsubscribe?.();
        this.owner?.dispose();
        this.owner = undefined;
        this.binding = binding;
        this.doc = undefined;
        if (binding && workerFactory) {
          this.owner = createCalloutSummaryOwner(
            binding.current,
            workerFactory
          );
          this.unsubscribe = this.owner.subscribe(() => {
            const snapshot = this.owner!.getSnapshot();
            if (snapshot.status === "failed")
              binding.failed(() => {
                if (this.binding === binding && binding.current())
                  this.owner?.retry();
              });
            if (snapshot.status === "ready") this.observe();
          });
        }
      }
      const source = binding?.current();
      if (
        !source ||
        !this.owner ||
        this.view.compositionStarted ||
        this.view.composing
      ) {
        this.owner?.cancel();
        this.clearWork();
        this.doc = undefined;
        this.items = [];
        this.cache.clear();
        return;
      }
      const tree = syntaxTree(this.view.state),
        ranges = JSON.stringify(this.view.visibleRanges);
      if (this.work && this.workingQuote && !this.view.visibleRanges.some(range => range.from <= this.workingQuote!.to && range.to >= this.workingQuote!.from)) {
        this.clearWork();
        this.candidate = false;
        this.definitions = undefined;
        this.owner.cancel();
        this.items = [];
      }
      if (this.doc !== source.doc || this.tree !== tree) {
        this.clearWork();
        if (this.doc !== source.doc) this.candidate = false;
        this.doc = source.doc;
        this.tree = tree;
        this.ranges = ranges;
        this.items = [];
        this.definitions = undefined;
        this.cache.clear();
        this.queryNeeded = true;
        this.work = hasCalloutCandidate(
          source.doc,
          tree,
          this.view.visibleRanges
        );
        this.phase = "candidate";
      }
      // Preserve in-flight body progress across scrolling. The latest window is
      // examined after completion; completed visible quotes reuse eligibility.
      if (this.ranges !== ranges && !this.work) {
        this.ranges = ranges;
        for (const [from, entry] of this.cache)
          if (
            !this.view.visibleRanges.some(
              (range) => range.from <= entry.to && range.to >= from
            )
          )
            this.cache.delete(from);
        this.work = hasCalloutCandidate(
          source.doc,
          tree,
          this.view.visibleRanges
        );
        this.phase = "candidate";
        this.queryNeeded = true;
      }
      this.owner.observe(this.candidate);
      const snapshot = this.owner.getSnapshot();
      if (
        this.candidate &&
        !(this.phase === "candidate" && this.work) &&
        snapshot.status === "ready" &&
        this.owner.isCurrent(snapshot.definitions) &&
        (this.definitions !== snapshot.definitions ||
          (this.queryNeeded && !this.work))
      ) {
        this.clearWork();
        if (this.definitions !== snapshot.definitions) this.cache.clear();
        this.definitions = snapshot.definitions;
        this.queryNeeded = false;
        this.pendingTree = false;
        this.phase = "body";
        const state = this.view.state;
        this.work = queryEditingCallouts(
          source.doc,
          tree,
          this.view.visibleRanges,
          snapshot.definitions,
          (to) => {
            const complete = syntaxTreeAvailable(state, to);
            if (!complete) this.pendingTree = true;
            return complete;
          },
          this.cache,
          range => { this.workingQuote = range; }
        );
      }
      if (this.work && !this.timer)
        this.timer = setTimeout(() => this.advance(), 0);
    }
    private advance() {
      this.timer = undefined;
      if (
        this.dead ||
        !this.binding?.current() ||
        this.view.compositionStarted ||
        this.view.composing
      ) {
        this.observe();
        return;
      }
      if (!this.work) return;
      // A single generator covers every quote; one budget for the whole task.
      const step = advanceCalloutWork(this.work);
      if (!step.done) {
        this.timer = setTimeout(() => this.advance(), 0);
        return;
      }
      this.work = undefined;
      if (this.phase === "candidate") {
        this.candidate = step.value === true;
        if (!this.candidate) { this.items = []; this.definitions = undefined; this.cache.clear(); this.changed(); }
        this.owner?.observe(this.candidate);
        this.observe();
      } else {
        this.items = step.value as EditingCallout[];
        this.changed();
      }
    }
    update(update: ViewUpdate) {
      if (update.view.compositionStarted || update.view.composing) {
        this.decorations = this.decorations.map(update.changes);
        queueMicrotask(() => this.observe());
        return;
      }
      if (
        this.pendingTree &&
        !this.work &&
        update.transactions.some(
          (transaction) =>
            !transaction.effects.some((effect) => effect.is(readyEffect))
        )
      )
        this.queryNeeded = true;
      this.observe();
      this.decorations = decorations(this.view, this.items);
    }
    destroy() {
      this.dead = true;
      this.clearWork();
      this.unsubscribe?.();
      this.owner?.dispose();
    }
}
export const calloutPresentation = ViewPlugin.fromClass(CalloutPresentation,
  {
    decorations: (value) => value.decorations,
    eventHandlers: {
      compositionstart() {
        this.observe();
      },
      compositionend() {
        queueMicrotask(() => this.observe());
      },
    },
  }
);
export const calloutEditingTheme = EditorView.baseTheme({
  ".cm-callout": {
    "--callout-accent": "#2563eb",
    backgroundColor:
      "color-mix(in oklab, var(--callout-accent) 8%, var(--background))",
    borderLeft: "3px solid var(--callout-accent)",
  },
  ".cm-callout-tip": { "--callout-accent": "#16803c" },
  ".cm-callout-important": { "--callout-accent": "#8957e5" },
  ".cm-callout-warning": { "--callout-accent": "#ad7100" },
  ".cm-callout-caution": { "--callout-accent": "#d1242f" },
  ".cm-callout-title": { color: "var(--callout-accent)", fontWeight: "600" },
  ".dark & .cm-callout-note": { "--callout-accent": "#79b8ff" },
  ".dark & .cm-callout-tip": { "--callout-accent": "#56d364" },
  ".dark & .cm-callout-important": { "--callout-accent": "#bc8cff" },
  ".dark & .cm-callout-warning": { "--callout-accent": "#e3b341" },
  ".dark & .cm-callout-caution": { "--callout-accent": "#ff7b72" },
});
