import { syntaxTree } from "@codemirror/language";
import { StateEffect, Transaction } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import { editorFaultSession } from "./editor-fault";
import {
  createFrontmatterDiagnosticOwner,
  type DiagnosticOutcome,
  type FrontmatterDiagnosticWorker,
} from "./frontmatter-diagnostic-owner";
import { FRONTMATTER_DIAGNOSTIC_LIMIT } from "./frontmatter-diagnostic-protocol";
import {
  currentFrontmatter,
  frontmatterEditing,
  type FrontmatterSection,
} from "./frontmatter-structure";

let factory: (() => FrontmatterDiagnosticWorker) | undefined;
export function setFrontmatterDiagnosticFactory(next: typeof factory) {
  const previous = factory;
  factory = next;
  return previous;
}
const refreshed = StateEffect.define<null>();
class HeaderStatus extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: HeaderStatus) {
    return this.label === other.label;
  }
  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement("span");
    element.className = "cm-frontmatter-status";
    element.textContent = this.label;
    element.setAttribute("aria-label", `YAML Frontmatter：${this.label}`);
    return element;
  }
}
export class FrontmatterPresentation {
  decorations: DecorationSet = Decoration.none;
  private owner = createFrontmatterDiagnosticOwner(() => {
    if (!factory) throw new Error("Diagnostic worker unavailable");
    return factory();
  });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private header: FrontmatterSection | null = null;
  private ticket: object | null = null;
  private outcome: DiagnosticOutcome | { status: "pending" } | null = null;
  private alive = true;
  private composing = false;
  constructor(private readonly view: EditorView) {
    this.schedule();
  }
  update(update: ViewUpdate) {
    if (update.docChanged && this.header) {
      let touched = false;
      update.changes.iterChangedRanges((from) => {
        if (from <= this.header!.to) touched = true;
      });
      if (touched) this.clear();
    }
    if (!this.allowed()) this.clear();
    if (
      update.docChanged ||
      update.startState.facet(frontmatterEditing) !==
        update.state.facet(frontmatterEditing) ||
      syntaxTree(update.startState) !== syntaxTree(update.state)
    )
      this.schedule();
    this.draw();
  }
  private allowed() {
    return (
      this.view.state.facet(frontmatterEditing) &&
      !this.view.state.field(editorFaultSession, false)?.fault
    );
  }
  private schedule() {
    if (this.timer === undefined && this.alive)
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.observe();
      }, 0);
  }
  compositionStart() {
    this.composing = true;
    this.clear();
  }
  compositionEnd() {
    this.composing = false;
    this.schedule();
  }
  observe() {
    if (!this.alive || !this.allowed()) {
      this.clear();
      return;
    }
    // A changed header was invalidated in update before any late result can run.
    if (this.composing || this.view.composing || this.view.compositionStarted)
      return;
    const header = currentFrontmatter(this.view.state);
    if (!header) return;
    if (
      this.ticket &&
      this.header?.from === header.from &&
      this.header.to === header.to
    )
      return;
    this.clear();
    this.header = header;
    const ticket = (this.ticket = {}),
      length = header.bodyTo - header.bodyFrom;
    if (length < 0 || length > FRONTMATTER_DIAGNOSTIC_LIMIT || !factory) {
      this.outcome = { status: "unavailable" };
      this.refresh();
      return;
    }
    this.outcome = { status: "pending" };
    this.refresh();
    const body = this.view.state.doc.sliceString(
      header.bodyFrom,
      header.bodyTo
    );
    void this.owner.request(body).then((outcome) => {
      if (
        !this.alive ||
        this.ticket !== ticket ||
        !this.allowed() ||
        this.composing ||
        this.view.composing ||
        this.view.compositionStarted ||
        outcome.status === "cancelled"
      )
        return;
      this.outcome = outcome;
      this.refresh();
    });
  }
  private refresh() {
    if (
      !this.alive ||
      this.composing ||
      this.view.composing ||
      this.view.compositionStarted
    )
      return;
    this.view.dispatch({
      effects: refreshed.of(null),
      annotations: Transaction.addToHistory.of(false),
    });
  }
  private draw() {
    if (!this.allowed() || !this.header || !this.outcome) {
      this.decorations = Decoration.none;
      return;
    }
    const outcome = this.outcome;
    const label =
      outcome.status === "pending"
        ? "YAML · 检查中"
        : outcome.status !== "ready"
          ? "YAML · 诊断暂不可用"
          : outcome.result.hasErrors
            ? "YAML · 有语法错误"
            : outcome.result.hasWarnings
              ? "YAML · 有警告"
              : "YAML · 未发现语法错误";
    const ranges = [
      Decoration.widget({ widget: new HeaderStatus(label), side: -1 }).range(
        this.header.from
      ),
    ];
    if (outcome.status === "ready")
      for (const diagnostic of outcome.result.diagnostics) {
        const from = this.header.bodyFrom + diagnostic.from,
          to = this.header.bodyFrom + diagnostic.to;
        if (
          to > from &&
          from >= this.header.bodyFrom &&
          to <= this.header.bodyTo
        )
          ranges.push(
            Decoration.mark({ class: "cm-frontmatter-diagnostic" }).range(
              from,
              to
            )
          );
      }
    this.decorations = Decoration.set(ranges, true);
  }
  private clear() {
    this.owner.cancel();
    this.header = null;
    this.ticket = null;
    this.outcome = null;
    this.decorations = Decoration.none;
  }
  destroy() {
    this.alive = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.clear();
    this.owner.dispose();
  }
}
export const frontmatterPresentation = ViewPlugin.fromClass(
  FrontmatterPresentation,
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      compositionstart() {
        this.compositionStart();
      },
      compositionend() {
        this.compositionEnd();
      },
    },
  }
);

export function observeFrontmatter(view: EditorView) {
  view.plugin(frontmatterPresentation)?.observe();
}
export const frontmatterTheme = EditorView.baseTheme({
  ".cm-frontmatter-status": {
    color: "var(--muted-foreground)",
    fontSize: "11px",
    marginLeft: "12px",
    fontFamily: "var(--font-sans)",
    userSelect: "none",
  },
  ".cm-frontmatter-diagnostic": {
    textDecoration: "underline wavy",
    textDecorationColor: "var(--destructive)",
  },
});
