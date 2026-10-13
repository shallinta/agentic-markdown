import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorState, Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import {
  LONG_LINE_UNITS,
  longLineProtection,
  touchesProtected,
  unprotectedParts,
} from "./long-line-protection";

export interface TaskMarker {
  from: number;
  to: number;
  checked: boolean;
}

/** Source domain, independent of visibility and of checkbox availability. */
export function paragraphTaskPrefix(
  state: EditorState,
  paragraph: SyntaxNode | null
): TaskMarker | undefined {
  return paragraphTaskPrefixIn(state.doc, paragraph);
}

/** Query a public local tree against its corresponding Text. Returned positions
 * are absolute; offset binds local parser coordinates to that same document. */
export function paragraphTaskPrefixIn(
  doc: Text,
  paragraph: SyntaxNode | null,
  offset = 0
): TaskMarker | undefined {
  if (paragraph?.name !== "Paragraph" || paragraph.parent?.name !== "ListItem")
    return;
  let first = paragraph.parent.firstChild;
  while (first && (first.name === "ListMark" || first.name === "QuoteMark"))
    first = first.nextSibling;
  if (
    first?.from !== paragraph.from ||
    first.name !== "Paragraph" ||
    paragraph.to - paragraph.from < 3
  )
    return;
  const from = paragraph.from + offset;
  const marker = doc.sliceString(from, from + 3);
  if (!/^\[[ xX]\]$/.test(marker)) return;
  const next = doc.sliceString(
    from + 3,
    Math.min(paragraph.to + offset, from + 4)
  );
  if (next && next !== " " && next !== "\t" && next !== "\n") return;
  return {
    from,
    to: from + 3,
    checked: marker[1] !== " ",
  };
}

/** Current state's public tree only. No parser, raw mapping, or full text copy. */
export function taskMarkers(
  state: EditorState,
  visible: readonly { from: number; to: number }[]
): TaskMarker[] {
  const tree = syntaxTree(state),
    markers: TaskMarker[] = [],
    seen = new Set<number>();
  const protectedSpans = state.field(longLineProtection, false) ?? [];
  for (const window of visible.flatMap((range) =>
    unprotectedParts(protectedSpans, range.from, range.to)
  ))
    tree.iterate({
      from: window.from,
      to: window.to,
      enter(ref) {
        if (ref.name !== "Paragraph")
          return [
            "Document",
            "BulletList",
            "OrderedList",
            "ListItem",
            "Blockquote",
          ].includes(ref.name)
            ? undefined
            : false;
        if (seen.has(ref.from)) return false;
        seen.add(ref.from);
        const marker = paragraphTaskPrefix(state, ref.node);
        if (
          !marker ||
          !visible.some((v) => marker.from < v.to && marker.to > v.from) ||
          !syntaxTreeAvailable(state, ref.to) ||
          touchesProtected(protectedSpans, ref.from, ref.to)
        )
          return false;
        let at = marker.to,
          gap = false,
          body = false;
        for (; at < ref.to && at - marker.from < LONG_LINE_UNITS; at++) {
          const character = state.sliceDoc(at, at + 1);
          if (character === "\n") break;
          if (character === " " || character === "\t") {
            gap = true;
            continue;
          }
          body = gap;
          break;
        }
        if (!body) return false;
        let crossing = false;
        tree.iterate({
          from: marker.from,
          to: marker.to,
          enter(node) {
            if (node.to <= marker.from || node.from >= marker.to) return false;
            if (
              [
                "Document",
                "BulletList",
                "OrderedList",
                "Blockquote",
                "ListItem",
                "Paragraph",
              ].includes(node.name)
            )
              return;
            if (node.from < marker.from || node.to > marker.to) crossing = true;
          },
        });
        if (!crossing) markers.push(marker);
        return false;
      },
    });
  return markers;
}

/** Protect marker syntax, not reliable task body formatting. */
export function touchesTaskMarker(
  state: EditorState,
  from: number,
  to: number
): boolean {
  const tree = syntaxTree(state);
  for (const position of [from, to]) {
    for (
      let node: SyntaxNode | null = tree.resolveInner(position, -1);
      node;
      node = node.parent
    ) {
      const marker = paragraphTaskPrefix(state, node);
      if (marker && from < marker.to && to >= marker.from) return true;
    }
  }
  let found = false;
  tree.iterate({
    from,
    to,
    enter(ref) {
      if (ref.name !== "Paragraph") return;
      const marker = paragraphTaskPrefix(state, ref.node);
      if (marker && from < marker.to && to >= marker.from) found = true;
      return false;
    },
  });
  return found;
}
