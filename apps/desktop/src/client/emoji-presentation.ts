import {
  foldedRanges,
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

import { emojiValue } from "./emoji-extension";

export interface EmojiBudget {
  nodes: number;
  units: number;
}
export const emojiBudget = (): EmojiBudget => ({ nodes: 1024, units: 4096 });
const revealAncestors = new Set([
  "Link",
  "SetextHeading1",
  "SetextHeading2",
  "StrongEmphasis",
  "Emphasis",
  "Highlight",
  "Strikethrough",
  "Subscript",
  "Superscript",
]);
const opaque = new Set([
  "Image",
  "LinkReference",
  "URL",
  "LinkTitle",
  "HTMLTag",
  "InlineCode",
  "FencedCode",
  "CodeBlock",
  "Frontmatter",
]);

/** Stages a whole token. Nothing is replaced until all current-state guards pass. */
export function emojiPresentation(
  state: EditorState,
  tree: Tree,
  node: SyntaxNode,
  budget: EmojiBudget
): { value?: string; reveal: boolean } | null {
  if (
    node.name !== "EmojiShortcode" ||
    syntaxTree(state) !== tree ||
    !syntaxTreeAvailable(state, node.to)
  )
    return null;
  if (--budget.nodes < 0) return null;
  const touches = (target: SyntaxNode) =>
    state.selection.ranges.some(
      (r) => r.from <= target.to && r.to >= target.from
    );
  let reveal = touches(node),
    excluded = false;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (--budget.nodes < 0) return null;
    if (opaque.has(parent.name)) excluded = true;
    if (revealAncestors.has(parent.name) && touches(parent)) reveal = true;
  }
  foldedRanges(state).between(node.from, node.to, (from, to) => {
    if (from < node.to && to > node.from) excluded = true;
  });
  if (reveal || excluded) return { reveal: true };
  budget.units -= node.to - node.from;
  if (budget.units < 0) return null;
  if (state.doc.lineAt(node.from).number !== state.doc.lineAt(node.to).number)
    return null;
  return {
    value: emojiValue(state.sliceDoc(node.from, node.to)),
    reveal: false,
  };
}
