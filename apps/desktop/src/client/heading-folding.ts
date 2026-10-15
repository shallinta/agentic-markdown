import {
  codeFolding,
  foldEffect,
  foldedRanges,
  language,
  syntaxTree,
  syntaxTreeAvailable,
  unfoldEffect,
} from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  Transaction,
  type SelectionRange,
} from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";

import { editorFaultSession, reportEditorFault } from "./editor-fault";
import {
  headingLowerBound,
  headingStructureSteps,
  type HeadingSection,
  type HeadingStructure,
} from "./heading-structure";

export const headingStructureReady = StateEffect.define<HeadingStructure>();
export const clearHeadingFolds = StateEffect.define<null>();
const headingHoverChanged = StateEffect.define<null>();
export const headingStructureState = StateField.define<HeadingStructure | null>(
  {
    create: () => null,
    update(value, tr) {
      if (
        tr.docChanged ||
        !tr.state.facet(language) ||
        tr.state.field(editorFaultSession, false)?.fault
      )
        return null;
      if (value && value.tree !== syntaxTree(tr.state)) value = null;
      for (const effect of tr.effects)
        if (
          effect.is(headingStructureReady) &&
          effect.value.doc === tr.state.doc &&
          effect.value.tree === syntaxTree(tr.state)
        )
          value = effect.value;
      return value;
    },
  }
);
export interface HeadingAction {
  heading?: number;
  unfoldFrom?: number;
  unfoldTo?: number;
}
const routes = new WeakMap<
  EditorView,
  { ready(): boolean; run(action: HeadingAction): void; rejected(): void }
>();
export function registerHeadingView(
  view: EditorView,
  route: {
    ready(): boolean;
    run(action: HeadingAction): void;
    rejected(): void;
  }
) {
  routes.set(view, route);
  return () => {
    if (routes.get(view) === route) routes.delete(view);
  };
}
export function selectionIntersectsFold(
  selection: SelectionRange,
  range: { from: number; to: number }
) {
  return selection.empty
    ? selection.head > range.from && selection.head < range.to
    : selection.from < range.to && selection.to > range.from;
}
export function headingToggleTransaction(
  state: EditorState,
  section: HeadingSection
) {
  let existing = false;
  foldedRanges(state).between(section.from, section.to, (from, to) => {
    if (from === section.from && to === section.to) existing = true;
  });
  if (existing)
    return state.update({
      effects: unfoldEffect.of(section),
      annotations: Transaction.addToHistory.of(false),
    });
  const overlaps = state.selection.ranges.some((range) =>
    selectionIntersectsFold(range, section)
  );
  if (
    overlaps &&
    (state.selection.ranges.length !== 1 || !state.selection.main.empty)
  )
    return null;
  return state.update({
    effects: foldEffect.of(section),
    selection: overlaps ? EditorSelection.cursor(section.from) : undefined,
    annotations: Transaction.addToHistory.of(false),
  });
}
function currentStructure(state: EditorState) {
  const value = state.field(headingStructureState, false);
  return value?.doc === state.doc && value.tree === syntaxTree(state)
    ? value
    : null;
}
export function currentFoldTarget(
  state: EditorState,
  stamp: { doc: EditorState["doc"]; from: number; to: number }
) {
  // Existing exact folds may always unfold for the same Text, even while the
  // resumed parser has not yet covered the tail. Never reuse this to add folds.
  if (state.doc !== stamp.doc) return undefined;
  let folded = false;
  foldedRanges(state).between(stamp.from, stamp.to, (from, to) => {
    if (from === stamp.from && to === stamp.to) folded = true;
  });
  return folded ? { from: stamp.from, to: stamp.to } : undefined;
}
export function currentFoldAtSelection(state: EditorState) {
  const head = state.selection.main.head;
  let target: { from: number; to: number } | undefined;
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    let titleFrom = state.doc.lineAt(from).from;
    // A resumed partial tree can still prove the complete multiline title.
    // This only widens an existing fold's unfold target, never creates a fold.
    if (syntaxTreeAvailable(state, from)) {
      let node = syntaxTree(state).resolveInner(from, -1);
      for (;;) {
        if (
          /^(?:ATXHeading[1-6]|SetextHeading[12])$/.test(node.name) &&
          node.to === from
        ) {
          titleFrom = state.doc.lineAt(node.from).from;
          break;
        }
        if (!node.parent) break;
        node = node.parent;
      }
    }
    if (head >= titleFrom && head <= to) target = { from, to };
  });
  return target;
}
export function isHeadingShortcut(
  event: Pick<
    KeyboardEvent,
    "code" | "metaKey" | "altKey" | "ctrlKey" | "shiftKey" | "isComposing"
  >
) {
  return (
    event.code === "KeyF" &&
    event.metaKey &&
    event.altKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.isComposing
  );
}
export function toggleCurrentHeading(
  view: EditorView,
  action: HeadingAction = {}
) {
  const route = routes.get(view);
  if (!route?.ready() || view.compositionStarted || view.composing)
    return false;
  const { heading, unfoldFrom, unfoldTo } = action;
  let unfolding: { from: number; to: number } | undefined;
  if (unfoldFrom !== undefined && unfoldTo !== undefined)
    unfolding = currentFoldTarget(view.state, {
      doc: view.state.doc,
      from: unfoldFrom,
      to: unfoldTo,
    });
  else if (heading === undefined)
    unfolding = currentFoldAtSelection(view.state);
  if (unfolding) {
    const tr = view.state.update({
      effects: unfoldEffect.of(unfolding),
      annotations: Transaction.addToHistory.of(false),
    });
    view.dispatch(tr);
    return view.state === tr.state;
  }
  if (unfoldFrom !== undefined || unfoldTo !== undefined) return false;
  const structure = currentStructure(view.state);
  if (!structure) return false;
  let section: HeadingSection | undefined;
  if (heading !== undefined)
    section = structure.sections.find((item) => item.heading === heading);
  else {
    const head = view.state.selection.main.head;
    // Explicit command selects the innermost section containing the primary caret.
    for (const item of structure.sections) {
      if (item.line > head) break;
      if (head <= item.to) section = item;
    }
  }
  if (!section) return false;
  const tr = headingToggleTransaction(view.state, section);
  if (!tr) {
    route.rejected();
    return true;
  }
  view.dispatch(tr);
  return view.state === tr.state;
}
class HeadingMarker extends GutterMarker {
  constructor(
    readonly structure: HeadingStructure,
    readonly heading: number,
    readonly closed: boolean,
    readonly hovered: boolean
  ) {
    super();
  }
  eq(other: HeadingMarker) {
    return (
      this.structure === other.structure &&
      this.heading === other.heading &&
      this.closed === other.closed &&
      this.hovered === other.hovered
    );
  }
  toDOM(view: EditorView) {
    const button = view.dom.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `cm-heading-arrow${this.closed || this.hovered ? " cm-heading-visible" : ""}`;
    button.textContent = this.closed ? "›" : "⌄";
    button.setAttribute(
      "aria-label",
      this.closed ? "展开标题章节" : "折叠标题章节"
    );
    button.setAttribute("aria-expanded", String(!this.closed));
    button.title = this.closed ? "展开标题章节" : "折叠标题章节";
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const route = routes.get(view);
      if (
        currentStructure(view.state) === this.structure &&
        route?.ready() &&
        !view.compositionStarted &&
        !view.composing
      )
        route.run({ heading: this.heading });
    });
    return button;
  }
}
const structurePlugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | undefined;
    task: ReturnType<typeof headingStructureSteps> | undefined;
    captured: EditorState | undefined;
    hovered: number | null = null;
    markers: RangeSet<GutterMarker> = RangeSet.of<GutterMarker>([]);
    constructor(readonly view: EditorView) {
      this.observe();
      this.markers = this.buildMarkers();
      view.contentDOM.addEventListener("mousemove", this.hover);
      view.contentDOM.addEventListener("mouseleave", this.leave);
    }
    hover = (event: MouseEvent) => {
      const structure = currentStructure(this.view.state),
        position = this.view.posAtCoords({
          x: event.clientX,
          y: event.clientY,
        });
      let heading: number | null = null;
      if (structure && position !== null) {
        const line = this.view.state.doc.lineAt(position).from;
        const index = headingLowerBound(structure.sections, line);
        const section =
          structure.sections[index]?.line === line
            ? structure.sections[index]
            : structure.sections[index - 1];
        if (section && position >= section.line && position <= section.from)
          heading = section.heading;
      }
      this.setHover(heading);
    };
    leave = () => this.setHover(null);
    setHover(heading: number | null) {
      if (heading === this.hovered) return;
      this.hovered = heading;
      this.view.dispatch({
        effects: headingHoverChanged.of(null),
        annotations: Transaction.addToHistory.of(false),
      });
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.startState.facet(language) !== update.state.facet(language)
      )
        this.observe();
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.startState.field(headingStructureState) !==
          update.state.field(headingStructureState) ||
        foldedRanges(update.startState) !== foldedRanges(update.state) ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(headingHoverChanged))
        )
      )
        this.markers = this.buildMarkers();
    }
    observe() {
      this.cancel();
      if (
        (routes.has(this.view) && !routes.get(this.view)!.ready()) ||
        !this.view.state.facet(language) ||
        this.view.state.field(editorFaultSession, false)?.fault ||
        currentStructure(this.view.state)
      )
        return;
      this.captured = this.view.state;
      this.task = headingStructureSteps(this.captured);
      this.timer = setTimeout(() => this.step(), 0);
    }
    step() {
      this.timer = undefined;
      const state = this.captured,
        task = this.task;
      if (
        !state ||
        !task ||
        !routes.get(this.view)?.ready() ||
        state.doc !== this.view.state.doc ||
        syntaxTree(state) !== syntaxTree(this.view.state) ||
        !this.view.state.facet(language) ||
        this.view.state.field(editorFaultSession, false)?.fault
      ) {
        this.cancel();
        return;
      }
      try {
        const next = task.next();
        if (!next.done) {
          this.timer = setTimeout(() => this.step(), 0);
          return;
        }
        this.task = undefined;
        this.captured = undefined;
        this.view.dispatch({
          effects: headingStructureReady.of(next.value),
          annotations: Transaction.addToHistory.of(false),
        });
      } catch {
        this.cancel();
        const session = this.view.state.field(editorFaultSession, false);
        if (session) reportEditorFault(session, "presentation");
      }
    }
    buildMarkers() {
      const structure = currentStructure(this.view.state),
        builder = new RangeSetBuilder<GutterMarker>();
      if (!structure) return builder.finish();
      for (const block of this.view.viewportLineBlocks) {
        const at = headingLowerBound(structure.sections, block.from),
          section = structure.sections[at];
        if (section?.line !== block.from) continue;
        let closed = false;
        foldedRanges(this.view.state).between(
          section.from,
          section.to,
          (from, to) => {
            if (from === section.from && to === section.to) closed = true;
          }
        );
        builder.add(
          block.from,
          block.from,
          new HeadingMarker(
            structure,
            section.heading,
            closed,
            section.heading === this.hovered
          )
        );
      }
      return builder.finish();
    }
    cancel() {
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      this.task = undefined;
      this.captured = undefined;
    }
    destroy() {
      this.cancel();
      this.view.contentDOM.removeEventListener("mousemove", this.hover);
      this.view.contentDOM.removeEventListener("mouseleave", this.leave);
    }
  }
);

/** React owner calls after busy/IME state changes; no polling or repeated parse. */
export function observeHeadingFolding(view: EditorView) {
  const plugin = view.plugin(structurePlugin);
  if (plugin && !plugin.task && !currentStructure(view.state)) plugin.observe();
}

/** Shared across editing/source presentations; only heading-specific UI emits folds. */
export const headingFolding = [
  codeFolding({
    preparePlaceholder: (state, range) => ({
      doc: state.doc,
      from: range.from,
      to: range.to,
    }),
    placeholderDOM(view, _defaultClick, prepared: unknown) {
      const button = view.dom.ownerDocument.createElement("button");
      button.type = "button";
      button.textContent = "…";
      button.className = "cm-foldPlaceholder";
      button.setAttribute("aria-label", "展开标题章节");
      button.title = "展开标题章节";
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const route = routes.get(view);
        const stamp = prepared as {
          doc: EditorState["doc"];
          from: number;
          to: number;
        };
        const section = currentFoldTarget(view.state, stamp);
        if (
          section &&
          route?.ready() &&
          !view.compositionStarted &&
          !view.composing
        )
          route.run({ unfoldFrom: section.from, unfoldTo: section.to });
      });
      return button;
    },
  }),
  headingStructureState,
  EditorState.transactionExtender.of((tr) => {
    const all =
      tr.docChanged ||
      tr.effects.some((effect) => effect.is(clearHeadingFolds)) ||
      !!tr.startState.field(editorFaultSession, false)?.fault;
    if (!all && !tr.selection) return null;
    const effects: StateEffect<unknown>[] = [];
    foldedRanges(tr.startState).between(
      0,
      tr.startState.doc.length,
      (from, to) => {
        const mapped = {
          from: tr.changes.mapPos(from, 1),
          to: tr.changes.mapPos(to, -1),
        };
        if (
          all ||
          tr.newSelection.ranges.some((range) =>
            selectionIntersectsFold(range, mapped)
          )
        )
          effects.push(unfoldEffect.of(mapped));
      }
    );
    return effects.length ? { effects } : null;
  }),
  structurePlugin,
  gutter({
    class: "cm-heading-gutter",
    markers: (view) => view.plugin(structurePlugin)?.markers ?? RangeSet.empty,
  }),
  EditorView.baseTheme({
    ".cm-heading-gutter": {
      width: "20px",
      backgroundColor: "var(--background)",
      color: "var(--muted-foreground)",
      border: "none",
    },
    ".cm-heading-arrow": {
      border: "none",
      background: "transparent",
      color: "inherit",
      fontSize: "16px",
      width: "20px",
      padding: "0",
      cursor: "pointer",
      opacity: "0",
    },
    ".cm-gutterElement:hover .cm-heading-arrow, .cm-heading-arrow:focus-visible, .cm-heading-visible":
      { opacity: "1" },
    ".cm-heading-arrow:focus-visible": { outline: "2px solid var(--ring)" },
  }),
];
