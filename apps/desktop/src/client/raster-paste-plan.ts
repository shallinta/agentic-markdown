import { isolateHistory } from "@codemirror/commands";
import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import { EditorSelection, type EditorState, type Transaction } from "@codemirror/state";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";
import { validRasterPastePath } from "../shared/raster-paste";

import { BomAwareParser } from "./bom-aware-parser";
import { getEditorMode } from "./editor-mode-state";
import { LONG_LINE_UNITS } from "./long-line-protection";
import { markdownGrammar } from "./markdown-grammar";
import { applyEditorChanges, rawText } from "./raw-buffer";

const longestPath = "./assets/image-00000000-0000-4000-8000-000000000000-4.png";
const parser = new BomAwareParser(markdownGrammar);
const utf8 = new TextEncoder();

export interface RasterPastePlan {
  readonly doc: EditorState["doc"];
  readonly selection: EditorSelection;
}

function safeBoundary(line: string, at: number): boolean {
  const left = line.charCodeAt(at - 1);
  const right = line.charCodeAt(at);
  return !(left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff);
}

function candidate(state: EditorState, path: string) {
  if (state.readOnly || getEditorMode(state) !== "editing" || state.selection.ranges.length !== 1)
    return undefined;
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  if (to > line.to || line.length >= LONG_LINE_UNITS || !syntaxTreeAvailable(state, line.to))
    return undefined;
  const tree = syntaxTree(state);
  if (tree.length < line.to || (tree.length === line.to && line.to < state.doc.length))
    return undefined;

  const start = from - line.from;
  const end = to - line.from;
  const bom = line.number === 1 && line.text.startsWith("\uFEFF") ? 1 : 0;
  if (start < bom || !safeBoundary(line.text, start) || !safeBoundary(line.text, end))
    return undefined;
  const text = line.text.slice(bom);
  if (/^ {0,3}$/.test(text) && text.length <= 3) {
    // A trailing blank can lie past the reported range of an unclosed block.
    const blank = (number: number) =>
      number < 1 || number > state.doc.lines || state.doc.line(number).length === 0;
    const previous = tree.topNode.childBefore(line.from);
    if (tree.resolveInner(line.from, 0).name !== "Document" ||
        (previous && previous.name !== "Paragraph") ||
        !blank(line.number - 1) || !blank(line.number + 1)) return undefined;
  } else {
    const content = line.from + bom + (/^ {0,3}/.exec(text)?.[0].length ?? 0);
    let paragraph = tree.resolveInner(content, 1);
    while (paragraph.parent && paragraph.parent.name !== "Document")
      paragraph = paragraph.parent;
    if (paragraph.name !== "Paragraph" || paragraph.from < line.from ||
        paragraph.to > line.to || from < paragraph.from || to > paragraph.to)
      return undefined;
    for (let inline = paragraph.childAfter(from); inline && inline.from < to; inline = inline.nextSibling)
      if (inline.to > from) return undefined;
  }

  const insert = `![图片](${path})`;
  if (line.length - (end - start) + insert.length >= LONG_LINE_UNITS)
    return undefined;
  const proposed = line.text.slice(0, start) + insert + line.text.slice(end);
  const paragraph = parser.parse(proposed).topNode.firstChild;
  const image = paragraph?.childAfter(start);
  if (paragraph?.name !== "Paragraph" || paragraph.nextSibling || image?.name !== "Image" ||
      image.from !== start || image.to !== start + insert.length)
    return undefined;
  const raw = state.field(rawText, false);
  const changes = state.changes({ from, to, insert });
  if (raw === undefined || raw.length > MAX_DOCUMENT_BYTES ||
      utf8.encode(applyEditorChanges(raw, changes)).length > MAX_DOCUMENT_BYTES)
    return undefined;
  return { changes, cursor: from + insert.length };
}

export function planRasterPaste(state: EditorState): RasterPastePlan | undefined {
  if (!candidate(state, longestPath)) return undefined;
  return { doc: state.doc, selection: state.selection };
}

export function rasterPasteTransaction(
  state: EditorState,
  plan: RasterPastePlan,
  relativePath: unknown
): Transaction | undefined {
  if (state.doc !== plan.doc || !state.selection.eq(plan.selection, true) ||
      !validRasterPastePath(relativePath))
    return undefined;
  const insertion = candidate(state, relativePath);
  if (!insertion) return undefined;
  return state.update({
    changes: insertion.changes,
    selection: EditorSelection.cursor(insertion.cursor),
    annotations: isolateHistory.of("full"),
    userEvent: "input.paste",
  });
}
