import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { Facet, StateEffect, type EditorState } from "@codemirror/state";

/** Presentation capability only; source keeps the same atomic syntax and full raw text. */
export const frontmatterEditing = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});
export const unfoldFrontmatter = StateEffect.define<null>();
export interface FrontmatterSection {
  readonly opening: number;
  readonly line: number;
  readonly from: number;
  readonly to: number;
  readonly bodyFrom: number;
  readonly bodyTo: number;
  readonly lineCount: number;
}
export function currentFrontmatter(
  state: EditorState
): FrontmatterSection | null {
  const node = syntaxTree(state).topNode.firstChild;
  if (node?.name !== "Frontmatter" || !syntaxTreeAvailable(state, node.to))
    return null;
  const first = state.doc.lineAt(node.from),
    last = state.doc.lineAt(node.to);
  return {
    opening: node.from,
    line: first.from,
    from: first.to,
    to: node.to,
    bodyFrom: first.to + 1,
    bodyTo: last.from,
    lineCount: last.number - first.number - 1,
  };
}
