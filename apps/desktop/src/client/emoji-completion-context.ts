import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

import { getEditorMode, isSafeSource } from "./editor-mode-state";
import { emojiQualified, emojiValue } from "./emoji-extension";
import { EMOJI_MAX_NAME } from "./emoji-map";

const alphabet = /^[A-Za-z0-9_+-]$/;
const opaque = new Set([
  "Frontmatter",
  "FencedCode",
  "CodeBlock",
  "InlineCode",
  "HTMLTag",
  "HTMLBlock",
  "URL",
  "LinkTitle",
  "LinkReference",
  "LinkLabel",
  "LinkMark",
  "Escape",
  "Entity",
]);
const hosts = /^(Paragraph|ATXHeading[1-6]|SetextHeading[12]|TableCell)$/;
export interface EmojiPrefix {
  from: number;
  to: number;
  head: number;
  prefix: string;
}
/** Incomplete source, not an Emoji syntax node. Never requests parsing work. */
export function emojiPrefix(state: EditorState): EmojiPrefix | null {
  if (
    state.readOnly ||
    getEditorMode(state) !== "editing" ||
    isSafeSource(state) ||
    state.selection.ranges.length !== 1 ||
    !state.selection.main.empty
  )
    return null;
  const head = state.selection.main.head,
    line = state.doc.lineAt(head);
  let from = head;
  while (
    from > line.from &&
    head - from <= EMOJI_MAX_NAME &&
    alphabet.test(state.sliceDoc(from - 1, from))
  )
    from--;
  if (
    head === from ||
    head - from > EMOJI_MAX_NAME ||
    from === line.from ||
    state.sliceDoc(from - 1, from) !== ":"
  )
    return null;
  from--;
  const next = state.sliceDoc(head, Math.min(head + 1, state.doc.length));
  if (alphabet.test(next)) return null;
  const to = head + (next === ":" ? 1 : 0);
  if (next === ":" && emojiValue(state.sliceDoc(from, to))) return null;
  if (!syntaxTreeAvailable(state, to)) return null;
  const tree = syntaxTree(state);
  let node = tree.resolveInner(Math.max(from, head - 1), -1),
    host = false,
    steps = 64,
    lower = line.from;
  for (;;) {
    if (--steps < 0 || opaque.has(node.name)) return null;
    if (node.name === "Link" || node.name === "Image") {
      // Public children expose literal label delimiters; destinations never qualify.
      let first = -1,
        closed = -1;
      for (let child = node.firstChild; child; child = child.nextSibling) {
        if (--steps < 0) return null;
        if (child.name === "LinkMark") {
          if (first < 0) first = child.to;
          else {
            closed = child.from;
            break;
          }
        }
      }
      if (first < 0 || closed < 0 || from < first || to > closed) return null;
    }
    if (hosts.test(node.name)) {
      host = true;
      lower = Math.max(lower, node.from);
    }
    if (!node.parent) break;
    node = node.parent;
  }
  if (
    !host ||
    !emojiQualified(from, to, {
      lower,
      limit: line.to,
      read: (p) => state.sliceDoc(p, p + 1),
    })
  )
    return null;
  return { from, to, head, prefix: state.sliceDoc(from + 1, head) };
}
