import {
  codeFolding,
  foldedRanges,
  language,
  syntaxTree,
  unfoldEffect,
} from "@codemirror/language";
import {
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  Transaction,
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
  clearEditorFolds,
  clearLocatedEditorFolds,
  currentTypedFold,
  editorFoldEntries,
  exactLiveFold,
  foldEntry,
  selectedTypedFold,
  toggleTypedFold,
  type EditorFoldKind,
} from "./editor-fold-state";
import {
  headingLowerBound,
  headingStructureSteps,
  headingStructureReady,
  headingStructureState,
  type HeadingSection,
  type HeadingStructure,
  type CodeFoldSection,
} from "./heading-structure";

export {
  headingStructureReady,
  headingStructureState,
} from "./heading-structure";
export const clearHeadingFolds = clearEditorFolds;
export { selectionIntersectsFold } from "./editor-fold-state";
const headingHoverChanged = StateEffect.define<null>();
export interface HeadingAction {
  kind?: EditorFoldKind;
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
export function headingToggleTransaction(
  state: EditorState,
  section: HeadingSection
) {
  return toggleTypedFold(state, state.doc, {
    kind: "heading",
    titleFrom: section.line,
    from: section.from,
    to: section.to,
  });
}
export function codeToggleTransaction(
  state: EditorState,
  section: CodeFoldSection
) {
  return toggleTypedFold(state, state.doc, {
    kind: "fencedCode",
    openingFrom: section.line,
    from: section.from,
    to: section.to,
    languageLabel: section.languageLabel,
    lineCount: section.lineCount,
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
  stamp: {
    doc: EditorState["doc"];
    from: number;
    to: number;
    kind?: EditorFoldKind;
  }
) {
  // Existing exact folds may always unfold for the same Text, even while the
  // resumed parser has not yet covered the tail. Never reuse this to add folds.
  const entry = currentTypedFold(state, {
    ...stamp,
    kind: stamp.kind ?? "heading",
  });
  return entry ? { from: entry.from, to: entry.to } : undefined;
}
export function currentFoldAtSelection(state: EditorState) {
  const entry = selectedTypedFold(state, "heading");
  return entry ? { from: entry.from, to: entry.to } : undefined;
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
  const { heading, unfoldFrom, unfoldTo, kind = "heading" } = action;
  let unfolding: { from: number; to: number } | undefined;
  if (unfoldFrom !== undefined && unfoldTo !== undefined)
    unfolding = currentFoldTarget(view.state, {
      doc: view.state.doc,
      from: unfoldFrom,
      to: unfoldTo,
      kind,
    });
  else if (heading === undefined)
    unfolding = selectedTypedFold(view.state, kind);
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
  if (kind === "fencedCode") {
    const head = view.state.selection.main.head;
    const section = structure.code.find((item) =>
      heading !== undefined
        ? item.opening === heading
        : head >= item.line && head <= item.to
    );
    if (!section) return false;
    const tr = codeToggleTransaction(view.state, section);
    if (!tr) {
      route.rejected();
      return true;
    }
    view.dispatch(tr);
    return view.state === tr.state;
  }
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
    readonly hovered: boolean,
    readonly kind: EditorFoldKind = "heading"
  ) {
    super();
  }
  eq(other: HeadingMarker) {
    return (
      this.structure === other.structure &&
      this.heading === other.heading &&
      this.closed === other.closed &&
      this.hovered === other.hovered &&
      this.kind === other.kind
    );
  }
  toDOM(view: EditorView) {
    const button = view.dom.ownerDocument.createElement("button");
    button.type = "button";
    button.className = `cm-heading-arrow${this.closed || this.hovered ? " cm-heading-visible" : ""}`;
    button.textContent = this.closed ? "›" : "⌄";
    button.setAttribute(
      "aria-label",
      this.closed
        ? this.kind === "heading"
          ? "展开标题章节"
          : "展开代码块"
        : this.kind === "heading"
          ? "折叠标题章节"
          : "折叠代码块"
    );
    button.setAttribute("aria-expanded", String(!this.closed));
    button.title = button.getAttribute("aria-label")!;
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
        route.run({ heading: this.heading, kind: this.kind });
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
        const code = structure.code[headingLowerBound(structure.code, line)];
        if (code?.line === line) heading = code.opening;
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
          title = structure.sections[at],
          code = structure.code[headingLowerBound(structure.code, block.from)],
          section = title?.line === block.from ? title : code;
        if (section?.line !== block.from) continue;
        const closed = exactLiveFold(this.view.state, section),
          isTitle = "heading" in section,
          position = isTitle ? section.heading : section.opening;
        builder.add(
          block.from,
          block.from,
          new HeadingMarker(
            structure,
            position,
            closed,
            position === this.hovered,
            isTitle ? "heading" : "fencedCode"
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
  editorFoldEntries,
  codeFolding({
    preparePlaceholder: (state, range) => ({
      doc: state.doc,
      from: range.from,
      to: range.to,
      entry: foldEntry(state, range),
    }),
    placeholderDOM(view, _defaultClick, prepared: unknown) {
      const button = view.dom.ownerDocument.createElement("button");
      const stamp = prepared as {
        doc: EditorState["doc"];
        from: number;
        to: number;
        entry: ReturnType<typeof foldEntry>;
      } | null;
      const entry = stamp?.entry;
      button.type = "button";
      button.textContent =
        entry?.kind === "fencedCode"
          ? `${entry.languageLabel} · ${entry.lineCount}行`
          : "…";
      button.className = "cm-foldPlaceholder";
      button.setAttribute(
        "aria-label",
        entry?.kind === "fencedCode"
          ? "展开代码块"
          : entry?.kind === "heading"
            ? "展开标题章节"
            : "展开折叠内容"
      );
      button.title = button.getAttribute("aria-label")!;
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const route = routes.get(view);
        const section =
          stamp && entry
            ? currentFoldTarget(view.state, { ...stamp, kind: entry.kind })
            : undefined;
        if (
          section &&
          route?.ready() &&
          !view.compositionStarted &&
          !view.composing
        )
          route.run({
            unfoldFrom: section.from,
            unfoldTo: section.to,
            kind: entry!.kind,
          });
      });
      return button;
    },
  }),
  headingStructureState,
  clearLocatedEditorFolds,
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
