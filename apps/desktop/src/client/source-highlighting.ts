import { syntaxTree, type HighlightStyle } from "@codemirror/language";
import { RangeSetBuilder, type EditorState } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Tree } from "@lezer/common";
import { highlightTree, type Highlighter } from "@lezer/highlight";

import {
  longLineProtection,
  unprotectedParts,
  type TextSpan,
} from "./long-line-protection";

/** Clip before tree traversal, not after constructing marks for protected text. */
export function sourceColorDecorations(
  state: EditorState,
  tree: Tree,
  visible: readonly TextSpan[],
  highlighter: Highlighter
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const protectedLines = state.field(longLineProtection);
  const marks = new Map<string, Decoration>();
  for (const range of visible)
    for (const { from, to } of unprotectedParts(
      protectedLines,
      range.from,
      range.to
    )) {
      if (from >= to) continue;
      highlightTree(
        tree,
        highlighter,
        (start, end, classes) => {
          let mark = marks.get(classes);
          if (!mark)
            marks.set(classes, (mark = Decoration.mark({ class: classes })));
          builder.add(start, end, mark);
        },
        from,
        to
      );
    }
  return builder.finish();
}

/** Owns source colors only; the language and its incremental parser are unchanged. */
export function protectedSourceHighlighting(style: HighlightStyle) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      private tree: Tree;
      constructor(view: EditorView) {
        this.tree = syntaxTree(view.state);
        this.decorations = sourceColorDecorations(
          view.state,
          this.tree,
          view.visibleRanges,
          style
        );
      }
      update(update: ViewUpdate) {
        const tree = syntaxTree(update.state);
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some((transaction) => transaction.reconfigured) ||
          tree !== this.tree ||
          update.state.field(longLineProtection) !==
            update.startState.field(longLineProtection)
        ) {
          this.tree = tree;
          // Never map old colors across a threshold change or a newly published tree.
          this.decorations = sourceColorDecorations(
            update.state,
            tree,
            update.view.visibleRanges,
            style
          );
        }
      }
    },
    { decorations: (value) => value.decorations }
  );
  return [style.module ? EditorView.styleModule.of(style.module) : [], plugin];
}
