import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { Language, syntaxTree } from "@codemirror/language";
import {
  StateEffect,
  countColumn,
  type EditorState,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import {
  AsyncLongLineParser,
  asyncMarkdownSession,
  asyncMarkdownLifecycle,
} from "./async-markdown";
import { BomAwareParser } from "./bom-aware-parser";
import { GuardedParser, editorFaultSession } from "./editor-fault";
import {
  longLineProtection,
  protectedPosition,
  touchesProtected,
  unprotectedParts,
} from "./long-line-protection";

export const createEditingMarkdown = () =>
  new Language(
    commonmarkLanguage.data,
    new GuardedParser(new AsyncLongLineParser(new BomAwareParser())),
    [asyncMarkdownSession, asyncMarkdownLifecycle],
    "markdown"
  );
export const editingMarkdown = createEditingMarkdown();

const compositionFinished = StateEffect.define<null>();

/** Fixed, inert text only. Selection/copy continues to use the source document. */
export class ListBullet extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement("span");
    element.className = "cm-live-list-bullet";
    element.textContent = "•";
    element.setAttribute("aria-hidden", "true");
    return element;
  }
  ignoreEvent() {
    return false;
  }
}
const listBullet = new ListBullet();

/** Inert presentation only; all selection and copy data stays in the document. */
export class QuoteRuleWidget extends WidgetType {
  constructor(readonly kind: "quote" | "rule") {
    super();
  }
  eq(other: QuoteRuleWidget) {
    return this.kind === other.kind;
  }
  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement("span");
    element.className = `cm-live-${this.kind}-symbol`;
    element.setAttribute("aria-hidden", "true");
    return element;
  }
  ignoreEvent() {
    return false;
  }
}
const quoteSymbol = new QuoteRuleWidget("quote");
const ruleSymbol = new QuoteRuleWidget("rule");

/** Inclusive boundaries reveal delimiters before arrows/deletion can cross them. */
function touched(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some(
    (range) => range.from <= to && range.to >= from
  );
}

/** Only visits visible syntax; no ensureSyntaxTree/forced parsing on cursor moves. */
export function liveDecorations(
  state: EditorState,
  visibleRanges: readonly { from: number; to: number }[]
): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const protectedLines = state.field(longLineProtection, false) ?? [];
  const add = (range: Range<Decoration>) => {
    if (range.from === range.to) {
      if (!protectedPosition(protectedLines, range.from)) ranges.push(range);
    } else if ((range.value.spec as { class?: string }).class) {
      for (const part of unprotectedParts(protectedLines, range.from, range.to))
        ranges.push(range.value.range(part.from, part.to));
    } else if (!touchesProtected(protectedLines, range.from, range.to)) {
      // A replacement is indivisible: never hide half of a syntax delimiter.
      ranges.push(range);
    }
  };
  const seen = new Set<string>();
  const tree = syntaxTree(state);
  const codeLines = new Set<number>();
  const listLines = new Set<number>();
  const quoteLines = new Map<
    number,
    { depth: number; first: boolean; last: boolean }
  >();
  const paragraphStarts = new Set<number>();
  const paragraphEnds = new Set<number>();
  // Structural pass: visible block lines only, never enumerate inline content.
  for (const visible of visibleRanges)
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(ref) {
        if (ref.name === "Paragraph") {
          let parent = ref.node.parent;
          while (parent && parent.name !== "Blockquote") parent = parent.parent;
          if (parent) {
            paragraphStarts.add(state.doc.lineAt(ref.from).from);
            paragraphEnds.add(
              state.doc.lineAt(Math.max(ref.from, ref.to - 1)).from
            );
          }
          return false;
        }
        if (ref.name === "FencedCode" || ref.name === "CodeBlock") {
          const first = state.doc.lineAt(ref.from).from;
          const last = state.doc.lineAt(Math.max(ref.from, ref.to - 1)).from;
          let line = state.doc.lineAt(Math.max(ref.from, visible.from));
          while (
            line.from <= Math.min(ref.to, visible.to) &&
            line.from <= last
          ) {
            if (!codeLines.has(line.from)) {
              codeLines.add(line.from);
              ranges.push(
                Decoration.line({
                  class: `cm-live-code-block${line.from === first ? " cm-live-code-block-first" : ""}${line.from === last ? " cm-live-code-block-last" : ""}`,
                }).range(line.from)
              );
            }
            if (line.to >= visible.to || line.to === state.doc.length) break;
            line = state.doc.lineAt(line.to + 1);
          }
          return false;
        }
        if (ref.name === "Blockquote") {
          let depth = 1;
          for (let parent = ref.node.parent; parent; parent = parent.parent)
            if (parent.name === "Blockquote") depth++;
          const first = state.doc.lineAt(ref.from).from;
          const last = state.doc.lineAt(Math.max(ref.from, ref.to - 1)).from;
          let line = state.doc.lineAt(Math.max(ref.from, visible.from));
          while (
            line.from <= Math.min(ref.to, visible.to) &&
            line.from <= last
          ) {
            const previous = quoteLines.get(line.from);
            quoteLines.set(line.from, {
              depth: Math.max(depth, previous?.depth ?? 0),
              first: (previous?.first ?? false) || line.from === first,
              last: (previous?.last ?? false) || line.from === last,
            });
            if (line.to >= visible.to || line.to === state.doc.length) break;
            line = state.doc.lineAt(line.to + 1);
          }
        }
        if (
          ![
            "Document",
            "Blockquote",
            "BulletList",
            "OrderedList",
            "ListItem",
          ].includes(ref.name)
        )
          return false;
      },
    });
  for (const [from, quote] of quoteLines) {
    ranges.push(
      Decoration.line({
        class: `cm-live-quote-line${quote.first ? " cm-live-quote-first" : ""}${quote.last ? " cm-live-quote-last" : ""}${paragraphStarts.has(from) ? " cm-live-quote-paragraph-first" : ""}${paragraphEnds.has(from) ? " cm-live-quote-paragraph-last" : ""}`,
        attributes: { style: `--quote-depth: ${quote.depth}` },
      }).range(from)
    );
    const line = state.doc.lineAt(from);
    if (touched(state, from, line.to)) continue;
    let position = from;
    while (position < line.to) {
      let node = tree.resolveInner(position, 1);
      // childAfter is positional lookup, not a sibling walk through a long fence.
      for (
        let child = node.childAfter(position);
        child;
        child = node.childAfter(position)
      )
        node = child;
      if (node.from > line.to || node.to <= position) break;
      if (node.name === "QuoteMark") {
        seen.add(`quote-rule:${node.from}:${node.to}`);
        const markerEnd = /[ \t]/.test(
          state.doc.sliceString(node.to, node.to + 1)
        )
          ? node.to + 1
          : node.to;
        ranges.push(
          Decoration.replace({ widget: quoteSymbol }).range(
            node.from,
            markerEnd
          )
        );
      } else if (node.name !== "ListMark") break;
      position = node.to;
    }
  }
  const listLine = (position: number, prefixTo: number) => {
    const line = state.doc.lineAt(position);
    if (
      listLines.has(line.from) ||
      protectedPosition(protectedLines, line.from)
    )
      return;
    listLines.add(line.from);
    const prefix = line.text
      .slice(0, prefixTo - line.from)
      .replace(/^\uFEFF/, "");
    const columns = countColumn(prefix, state.tabSize);
    add(
      Decoration.line({
        class: "cm-live-list-line",
        attributes: { style: `--list-indent: ${columns}ch` },
      }).range(line.from)
    );
  };
  const safeRanges = visibleRanges.flatMap((visible) =>
    unprotectedParts(protectedLines, visible.from, visible.to)
  );
  for (const visible of safeRanges) {
    tree.iterate({
      from: visible.from,
      to: visible.to,
      enter(ref) {
        const { name, from, to } = ref;
        if (
          ![
            "Document",
            "Blockquote",
            "BulletList",
            "OrderedList",
            "ListItem",
            "FencedCode",
            "CodeBlock",
            "QuoteMark",
            "HorizontalRule",
          ].includes(name) &&
          protectedLines.some(
            (line) => line.from <= from && line.to >= Math.max(from, to - 1)
          )
        )
          return false;
        if (name === "HTMLBlock") return false;
        if (name === "QuoteMark" || name === "HorizontalRule") {
          const key = `quote-rule:${from}:${to}`;
          if (seen.has(key)) return;
          seen.add(key);
          const line = state.doc.lineAt(from);
          if (!touched(state, line.from, line.to))
            ranges.push(
              Decoration.replace({
                widget: name === "QuoteMark" ? quoteSymbol : ruleSymbol,
              }).range(from, to)
            );
          if (
            name === "HorizontalRule" &&
            !touched(state, line.from, line.to)
          ) {
            // A rule cannot inherit indentation from a previous list row.
            // Exclude parser-owned quote prefixes, whose depth has its own CSS.
            let list = ref.node.parent;
            while (list && list.name !== "ListItem") list = list.parent;
            let indent = 0;
            if (list) {
              let prefix = "";
              for (let position = line.from; position < from;) {
                const node = tree.resolveInner(position, 1);
                if (node.name === "QuoteMark") {
                  position = node.to;
                  if (
                    /[ \t]/.test(state.doc.sliceString(position, position + 1))
                  )
                    position++;
                } else {
                  prefix += state.doc.sliceString(position, position + 1);
                  position++;
                }
              }
              indent = countColumn(
                prefix.replace(/^\uFEFF/, ""),
                state.tabSize
              );
            }
            ranges.push(
              Decoration.line({
                class: "cm-live-rule-line",
                attributes: { style: `--list-indent: ${indent}ch` },
              }).range(line.from)
            );
          }
          return;
        }
        if (name === "FencedCode" || name === "CodeBlock") {
          if (name === "FencedCode" && !touched(state, from, to)) {
            // Hide parsed fence symbols, never container prefixes/newlines.
            // CommonMark places fences at the child edges. Quoted code has
            // QuoteMark/CodeText children per line: never scan those siblings.
            for (const child of [ref.node.firstChild, ref.node.lastChild]) {
              if (
                child?.name !== "CodeMark" ||
                child.to < visible.from ||
                child.from > visible.to
              )
                continue;
              const key = `fence:${child.from}:${child.to}`;
              if (seen.has(key)) continue;
              seen.add(key);
              ranges.push(Decoration.replace({}).range(child.from, child.to));
            }
            const opening = ref.node.firstChild;
            const firstLine = state.doc.lineAt(from);
            const infoKey = `code-info:${from}`;
            if (
              firstLine.to >= visible.from &&
              firstLine.from <= visible.to &&
              !protectedPosition(protectedLines, firstLine.from) &&
              !seen.has(infoKey)
            ) {
              // CodeInfo immediately follows the opening mark. One bounded hop,
              // never a scan of the per-line QuoteMark/CodeText siblings.
              const info = opening?.nextSibling;
              seen.add(infoKey);
              if (info?.name === "CodeInfo") {
                const token =
                  /^\S+/.exec(
                    state.doc.sliceString(
                      info.from,
                      Math.min(info.to, info.from + 65)
                    )
                  )?.[0] ?? "";
                const label = token.replace(
                  // Strip display controls in the derived badge, never in source.
                  // eslint-disable-next-line no-control-regex
                  /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
                  ""
                );
                add(Decoration.replace({}).range(info.from, info.to));
                if (label)
                  add(
                    Decoration.line({
                      class: "cm-live-code-info",
                      attributes: {
                        "data-code-language":
                          label.length > 40 ? `${label.slice(0, 40)}…` : label,
                      },
                    }).range(firstLine.from)
                  );
              }
            }
          }
          const firstLine = state.doc.lineAt(from).from;
          const lastLine = state.doc.lineAt(Math.max(from, to - 1)).from;
          const end = Math.min(to, visible.to);
          let line = state.doc.lineAt(Math.max(from, visible.from));
          while (line.from <= end && line.from <= lastLine) {
            if (!codeLines.has(line.from)) {
              codeLines.add(line.from);
              const classes = ["cm-live-code-block"];
              if (line.from === firstLine)
                classes.push("cm-live-code-block-first");
              if (line.from === lastLine)
                classes.push("cm-live-code-block-last");
              ranges.push(
                Decoration.line({ class: classes.join(" ") }).range(line.from)
              );
            }
            if (line.to >= end || line.to === state.doc.length) break;
            line = state.doc.lineAt(line.to + 1);
          }
          // Code stays literal; never visit pseudo headings, lists or inline syntax.
          return false;
        }
        if (name === "ListMark" && ref.node.parent?.name === "ListItem") {
          const key = `list:${from}:${to}`;
          if (seen.has(key)) return;
          seen.add(key);
          const line = state.doc.lineAt(from);
          let contentFrom = to;
          while (
            contentFrom < line.to &&
            /[ \t]/.test(line.text[contentFrom - line.from])
          )
            contentFrom++;
          listLine(from, contentFrom);
          const bullet = ref.node.parent.parent?.name === "BulletList";
          add(
            (bullet && !touched(state, line.from, line.to)
              ? Decoration.replace({ widget: listBullet })
              : Decoration.mark({ class: "cm-live-marker" })
            ).range(from, to)
          );
          return;
        }
        if (name === "Paragraph" && ref.node.parent?.name === "ListItem") {
          // Only visible physical lines, not the whole (possibly huge) list item.
          // Preserve physical indentation; lazy continuations gain no semantic indent.
          const end = Math.min(to, visible.to);
          let line = state.doc.lineAt(Math.max(from, visible.from));
          while (line.from <= end) {
            if (!protectedPosition(protectedLines, line.from)) {
              const first = from >= line.from && from <= line.to;
              const indentation =
                /^[\uFEFF \t]*/.exec(line.text)?.[0].length ?? 0;
              listLine(line.from, first ? from : line.from + indentation);
            }
            if (line.to >= end || line.to === state.doc.length) break;
            line = state.doc.lineAt(line.to + 1);
          }
        }
        const heading = /^ATXHeading([1-6])$/.exec(name);
        const className = heading
          ? `cm-live-heading cm-live-h${heading[1]}`
          : name === "StrongEmphasis"
            ? "cm-live-strong"
            : name === "Emphasis"
              ? "cm-live-emphasis"
              : name === "InlineCode"
                ? "cm-live-code"
                : null;
        if (!className) return;
        const key = `${name}:${from}:${to}`;
        // Another visible segment may contain children not visited previously.
        if (seen.has(key)) return;
        seen.add(key);
        const line = state.doc.lineAt(from);
        const reveal = touched(
          state,
          heading ? line.from : from,
          heading ? line.to : to
        );
        if (heading)
          add(Decoration.line({ class: className }).range(line.from));
        else add(Decoration.mark({ class: className }).range(from, to));
        const markerName = heading
          ? "HeaderMark"
          : name === "InlineCode"
            ? "CodeMark"
            : "EmphasisMark";
        // These syntax delimiters are edge children. Avoid walking a spanning
        // emphasis node's many children inside a protected physical line.
        for (const child of [ref.node.firstChild, ref.node.lastChild]) {
          if (child?.name !== markerName) continue;
          const markerKey = `inline-marker:${child.from}:${child.to}`;
          if (seen.has(markerKey)) continue;
          seen.add(markerKey);
          let markerTo = child.to;
          // Only the opening ATX marker owns its following syntax separator.
          // Keep source indentation, closing markers, content and line breaks intact.
          if (heading && !reveal && child.from === ref.node.firstChild?.from) {
            while (markerTo < line.to) {
              const code = line.text.charCodeAt(markerTo - line.from);
              if (code !== 32 && code !== 9) break;
              markerTo++;
            }
          }
          // Direct children only: nested emphasis owns its own markers.
          add(
            (reveal
              ? Decoration.mark({ class: "cm-live-marker" })
              : Decoration.replace({})
            ).range(child.from, markerTo)
          );
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

export const liveFormattingPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    composing = false;
    timer: ReturnType<typeof setTimeout> | undefined;
    constructor(view: EditorView) {
      this.decorations = liveDecorations(view.state, view.visibleRanges);
    }
    update(update: ViewUpdate) {
      if (
        update.state.field(editorFaultSession, false)?.inject === "presentation"
      )
        throw new Error("editor-presentation-test");
      if (this.composing || update.view.compositionStarted) {
        this.decorations = this.decorations.map(update.changes);
        return;
      }
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state) ||
        update.transactions.some((tr) =>
          tr.effects.some((effect) => effect.is(compositionFinished))
        )
      ) {
        this.decorations = liveDecorations(
          update.state,
          update.view.visibleRanges
        );
      }
    }
    destroy() {
      clearTimeout(this.timer);
    }
  },
  {
    decorations: (value) => value.decorations,
    eventHandlers: {
      compositionstart() {
        this.composing = true;
        clearTimeout(this.timer);
      },
      compositionend(_event, view) {
        this.composing = false;
        // Let the browser's final composition transaction settle before rebuilding.
        this.timer = setTimeout(
          () => view.dispatch({ effects: compositionFinished.of(null) }),
          0
        );
      },
    },
  }
);

const liveTheme = EditorView.baseTheme({
  ".cm-live-quote-line": {
    position: "relative",
    backgroundColor:
      "color-mix(in oklab, var(--foreground) 4%, var(--background))",
    color: "var(--muted-foreground)",
    paddingLeft:
      "calc(6px + var(--quote-depth) * 1em + var(--list-indent, 0ch))",
  },
  ".cm-live-quote-line::before": {
    content: "''",
    position: "absolute",
    left: "6px",
    top: "0",
    bottom: "0",
    width: "calc(var(--quote-depth) * 1em)",
    background:
      "repeating-linear-gradient(to right, var(--border) 0 2px, transparent 2px 1em)",
    pointerEvents: "none",
  },
  ".cm-live-quote-first": { paddingTop: "0.3em" },
  ".cm-live-quote-last": { paddingBottom: "0.3em" },
  ".cm-live-quote-paragraph-first": { paddingTop: "0.15em" },
  ".cm-live-quote-paragraph-last": { paddingBottom: "0.15em" },
  ".cm-live-quote-line.cm-live-list-line": {
    paddingLeft:
      "calc(6px + var(--quote-depth) * 1em + var(--list-indent, 0ch))",
  },
  ".cm-live-quote-line.cm-live-code-block": { color: "var(--foreground)" },
  ".cm-live-rule-line": { position: "relative" },
  ".cm-live-rule-line::after": {
    content: "''",
    position: "absolute",
    left: "calc(6px + var(--list-indent, 0ch))",
    right: "6px",
    top: "50%",
    borderTop: "1px solid var(--muted-foreground)",
    pointerEvents: "none",
  },
  ".cm-live-quote-line.cm-live-rule-line::after": {
    left: "calc(6px + var(--quote-depth) * 1em + var(--list-indent, 0ch))",
  },
  ".cm-live-quote-symbol": {
    display: "inline-block",
    width: "0",
    height: "1em",
    verticalAlign: "text-bottom",
  },
  ".cm-live-rule-symbol": {
    display: "inline-block",
    width: "1ch",
    height: "1em",
    verticalAlign: "text-bottom",
  },
  ".cm-live-code-info": { position: "relative" },
  ".cm-live-code-info::after": {
    content: "attr(data-code-language)",
    position: "absolute",
    top: "0",
    right: "8px",
    maxWidth: "min(40%, 24ch)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "0.75em",
    fontWeight: "normal",
    fontStyle: "normal",
    color: "var(--muted-foreground)",
    pointerEvents: "none",
    userSelect: "none",
    textIndent: "0",
    direction: "ltr",
    unicodeBidi: "isolate",
  },
  ".cm-live-code-block": {
    fontFamily: "monospace",
    fontWeight: "normal",
    fontStyle: "normal",
    backgroundColor:
      "color-mix(in oklab, var(--foreground) 6%, var(--background))",
    boxShadow: "inset 2px 0 var(--border), inset -2px 0 var(--border)",
  },
  ".cm-live-code-block-first": {
    borderTopLeftRadius: "4px",
    borderTopRightRadius: "4px",
    boxShadow:
      "inset 2px 0 var(--border), inset -2px 0 var(--border), inset 0 1px var(--border)",
  },
  ".cm-live-code-block-last": {
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
    boxShadow:
      "inset 2px 0 var(--border), inset -2px 0 var(--border), inset 0 -1px var(--border)",
  },
  ".cm-live-code-block-first.cm-live-code-block-last": {
    boxShadow: "inset 0 0 0 1px var(--border)",
  },
  ".cm-live-list-line": {
    // Keep CM's base 6px line inset; content's separate 16px padding is untouched.
    paddingLeft: "calc(6px + var(--list-indent))",
    textIndent: "calc(-1 * var(--list-indent))",
  },
  ".cm-live-list-bullet": {
    display: "inline-block",
    width: "1ch",
    textIndent: "0",
    textAlign: "center",
    color: "var(--muted-foreground)",
  },
  ".cm-live-heading": { fontWeight: "700", lineHeight: "1.5" },
  ".cm-live-h1": { fontSize: "1.75em" },
  ".cm-live-h2": { fontSize: "1.5em" },
  ".cm-live-h3": { fontSize: "1.3em" },
  ".cm-live-h4": { fontSize: "1.15em" },
  ".cm-live-h5": { fontSize: "1.05em" },
  ".cm-live-h6": { fontSize: "1em" },
  ".cm-live-strong": { fontWeight: "700" },
  ".cm-live-emphasis": { fontStyle: "italic" },
  ".cm-live-code": {
    fontFamily: "monospace",
    backgroundColor:
      "color-mix(in oklab, var(--foreground) 10%, var(--background))",
    borderRadius: "3px",
  },
  ".cm-live-marker": {
    color: "var(--muted-foreground)",
    fontWeight: "normal",
    fontStyle: "normal",
  },
});

// Direct language, rather than markdown(), avoids adding paste/Enter/HTML behavior.
export const livePresentation = [liveFormattingPlugin, liveTheme];
export const basicLiveFormatting = [editingMarkdown, livePresentation];
