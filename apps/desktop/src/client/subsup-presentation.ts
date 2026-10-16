import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode, Tree } from "@lezer/common";

export interface SubSupBudget {
  nodes: number;
  units: number;
}
export const subSupBudget = (): SubSupBudget => ({ nodes: 1024, units: 4096 });
export const isSubSup = (name: string) =>
  name === "Superscript" || name === "Subscript";
interface Span {
  from: number;
  to: number;
}
export interface SubSupPresentation {
  range: Span;
  reveal: boolean;
  markers: Span[];
  slashes: Span[];
}
const visible = new Set([
  "Superscript",
  "Subscript",
  "StrongEmphasis",
  "Emphasis",
  "Highlight",
  "Strikethrough",
  "Link",
  "Image",
]);
/** No cache: all reads belong to this call's Text/tree/viewport and shared budget.
 * Results are staged until complete. Unknown inline nodes are opaque, not text.
 */
export function subSupPresentation(
  state: EditorState,
  tree: Tree,
  root: SyntaxNode,
  viewport: Span,
  budget: SubSupBudget
): SubSupPresentation | null {
  if (
    !isSubSup(root.name) ||
    syntaxTree(state) !== tree ||
    !syntaxTreeAvailable(state, root.to)
  )
    return null;
  const visit = () => --budget.nodes >= 0;
  const read = (from: number, to: number) => {
    budget.units -= to - from;
    if (budget.units < 0) throw new Error("SubSup presentation budget");
    return state.doc.sliceString(from, to);
  };
  const touched = (node: SyntaxNode) =>
    state.selection.ranges.some((r) => r.from <= node.to && r.to >= node.from);
  try {
    let reveal = touched(root);
    for (let parent = root.parent; parent; parent = parent.parent) {
      if (!visit()) return null;
      if (
        (isSubSup(parent.name) ||
          parent.name === "Link" ||
          parent.name.startsWith("SetextHeading")) &&
        touched(parent)
      )
        reveal = true;
    }
    const markers: Span[] = [],
      slashes: Span[] = [];
    const intersect = (from: number, to: number) => ({
      from: Math.max(from, viewport.from),
      to: Math.min(to, viewport.to),
    });
    const gap = (from: number, to: number) => {
      const clipped = intersect(from, to);
      if (clipped.from >= clipped.to || reveal) return;
      let start = clipped.from;
      // Include a preceding slash run only for parity at the clipping boundary.
      while (start > from && read(start - 1, start) === "\\") start--;
      const text = read(start, Math.min(to, clipped.to + 1));
      for (let at = 0; at < text.length - 1; at++) {
        if (text[at] !== "\\") continue;
        const slash = start + at,
          next = text[++at];
        if (
          slash >= clipped.from &&
          slash < clipped.to &&
          (next === " " || next === "\t")
        )
          slashes.push({ from: slash, to: slash + 1 });
      }
    };
    interface Frame {
      node: SyntaxNode;
      child: SyntaxNode | null;
      at: number;
      to: number;
    }
    const frame = (node: SyntaxNode): Frame | null => {
      if (!visible.has(node.name)) return null;
      let from = node.from,
        to = node.to;
      if (node.name === "Link" || node.name === "Image") {
        // Only the explicit label, never destination/title/reference identifier.
        let close: number | undefined;
        for (let child = node.firstChild; child; child = child.nextSibling) {
          if (!visit()) throw new Error("SubSup presentation budget");
          if (child.name === "LinkMark" && read(child.from, child.to) === "]") {
            close = child.from;
            break;
          }
        }
        if (close === undefined) return null;
        from += node.name === "Image" ? 2 : 1;
        to = close;
      }
      return { node, child: node.firstChild, at: from, to };
    };
    // The root is visited here; child eligibility is already charged by its
    // parent's loop, so frame() must not charge that same access a second time.
    if (!visit()) return null;
    const initial = frame(root);
    if (!initial) return null;
    const frames = [initial];
    while (frames.length) {
      const current = frames[frames.length - 1],
        child = current.child;
      if (!child || child.from >= current.to) {
        gap(current.at, current.to);
        frames.pop();
        continue;
      }
      if (!visit()) return null;
      current.child = child.nextSibling;
      if (child.to <= current.at) continue;
      gap(current.at, Math.min(child.from, current.to));
      current.at = Math.max(current.at, child.to);
      if (child.to <= viewport.from || child.from >= viewport.to) continue;
      if (
        child.name === `${root.name}Mark` &&
        child.parent?.from === root.from &&
        child.parent?.to === root.to
      )
        markers.push({ from: child.from, to: child.to });
      // Nested SubSup owns its own source and budget qualification.
      if (isSubSup(child.name)) continue;
      const next = frame(child);
      if (next) frames.push(next);
    }
    if (syntaxTree(state) !== tree) return null;
    return { range: intersect(root.from, root.to), reveal, markers, slashes };
  } catch {
    return null;
  }
}
