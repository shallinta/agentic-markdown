import { foldedRanges } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

import type { ContentSearchDocument } from "./content-search";
import { editorOffset, rawOffset, rawText } from "./raw-buffer";

export interface ContentSearchLocation {
  query: string;
  from: number;
  to: number;
  source: "disk" | "memory";
  diskHash: string;
  version?: ContentSearchDocument;
}

export function contentSearchEditorRange(
  state: EditorState,
  { query, from, to }: Pick<ContentSearchLocation, "query" | "from" | "to">
): { from: number; to: number } | undefined {
  const raw = state.field(rawText);
  if (
    !query ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to > raw.length ||
    to - from !== query.length ||
    raw.slice(from, to) !== query
  )
    return;
  const start = editorOffset(raw, from);
  const end = editorOffset(raw, to);
  if (
    start >= end ||
    end > state.doc.length ||
    rawOffset(raw, start) !== from ||
    rawOffset(raw, end) !== to
  )
    return;
  let hidden = false;
  foldedRanges(state).between(start, end, (foldFrom, foldTo) => {
    if (foldFrom < end && foldTo > start) hidden = true;
  });
  if (!hidden) return { from: start, to: end };
}
