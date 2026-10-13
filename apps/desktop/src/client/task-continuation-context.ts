import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { LONG_LINE_UNITS, longLineProtection } from "./long-line-protection";
import { paragraphTaskPrefix } from "./task-marker";

/** An operation-local classification, never a second parser or widget query. */
export function taskContinuationContext(
  state: EditorState
): "none" | "task" | "unknown" {
  const tree = syntaxTree(state),
    protectedSpans = state.field(longLineProtection);
  let units = 0,
    visited = 0,
    task = false,
    unknown = false;
  const seen = new Set<number>();
  const inspect = (node: SyntaxNode) => {
    if (node.name !== "ListItem" || seen.has(node.from)) return;
    seen.add(node.from);
    const paragraph = node.getChild("Paragraph");
    if (paragraphTaskPrefix(state, paragraph)) {
      task = true;
      return;
    }
    // A known Paragraph that fails the task predicate is ordinary Markdown,
    // including no-gap links and bracket-prefixed words, not uncertain syntax.
    if (paragraph) return;
    // A missing first-content node is not permission to interpret raw text as a task.
    const mark = node.getChild("ListMark");
    if (
      mark &&
      /^\s*\[[ xX]\](?:[\t \n]|$)/.test(
        state.sliceDoc(mark.to, Math.min(node.to, mark.to + 8))
      )
    )
      unknown = true;
  };
  const windows: { from: number; to: number }[] = [];
  for (const range of state.selection.ranges) {
    const from = range.from,
      to = range.to;
    const last = windows[windows.length - 1];
    if (last && from <= last.to) last.to = Math.max(to, last.to);
    else windows.push({ from, to });
  }
  for (const window of windows) {
    units += Math.max(1, window.to - window.from);
    if (
      units > LONG_LINE_UNITS ||
      !syntaxTreeAvailable(state, window.to) ||
      protectedSpans.some(
        (span) => span.from <= window.to && span.to >= window.from
      )
    )
      return "unknown";
    for (const position of [window.from, window.to])
      for (const bias of [-1, 1] as const) {
        let node: SyntaxNode | null = tree.resolveInner(position, bias);
        while (node) {
          if (++visited > LONG_LINE_UNITS) return "unknown";
          // A sibling touching the far boundary but outside the selection is not selected.
          if (
            window.from === window.to
              ? node.from <= position && node.to >= position
              : node.from < window.to && node.to > window.from
          )
            inspect(node);
          node = node.parent;
        }
      }
    if (window.to > window.from)
      tree.iterate({
        from: window.from,
        to: window.to,
        enter(ref) {
          if (++visited > LONG_LINE_UNITS) {
            unknown = true;
            return false;
          }
          if (ref.from >= window.to || ref.to <= window.from) return false;
          if (ref.name === "ListItem") inspect(ref.node);
          return [
            "Document",
            "BulletList",
            "OrderedList",
            "ListItem",
            "Blockquote",
          ].includes(ref.name)
            ? undefined
            : false;
        },
      });
    if (unknown) return "unknown";
  }
  return task ? "task" : "none";
}
