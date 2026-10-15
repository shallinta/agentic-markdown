import {
  foldEffect,
  foldedRanges,
  unfoldEffect,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type SelectionRange,
  type Text,
} from "@codemirror/state";

import { editorFaultSession } from "./editor-fault";
import { frontmatterEditing, unfoldFrontmatter } from "./frontmatter-structure";
import { headingStructureState, headingLowerBound } from "./heading-structure";

interface FoldRange {
  readonly from: number;
  readonly to: number;
}
export type EditorFoldEntry =
  | (FoldRange & { readonly kind: "frontmatter"; readonly openingFrom: number })
  | (FoldRange & { readonly kind: "heading"; readonly titleFrom: number })
  | (FoldRange & {
      readonly kind: "fencedCode";
      readonly openingFrom: number;
      readonly languageLabel: string;
      readonly lineCount: number;
    });
export type EditorFoldKind = EditorFoldEntry["kind"];
const registerFold = StateEffect.define<EditorFoldEntry>();
export const clearEditorFolds = StateEffect.define<null>();
const emptyEntries: ReadonlyMap<string, EditorFoldEntry> = new Map();
const key = (range: FoldRange) => `${range.from}:${range.to}`;

export function selectionIntersectsFold(
  selection: SelectionRange,
  range: FoldRange
) {
  return selection.empty
    ? selection.head > range.from && selection.head < range.to
    : selection.from < range.to && selection.to > range.from;
}

/** One-way dependency: official preparePlaceholder reads this field, never vice versa. */
export const editorFoldEntries = StateField.define<
  ReadonlyMap<string, EditorFoldEntry>
>({
  create: () => emptyEntries,
  update(previous, tr) {
    if (
      tr.docChanged ||
      tr.effects.some((e) => e.is(clearEditorFolds)) ||
      tr.startState.field(editorFaultSession, false)?.fault
    )
      return emptyEntries;
    const relevant = tr.effects.some(
      (e) => e.is(registerFold) || e.is(unfoldEffect)
    );
    if (!relevant && !tr.selection) return previous;
    let changed: Map<string, EditorFoldEntry> | undefined;
    const remove = (entry: EditorFoldEntry) => {
      changed ??= new Map(previous);
      changed.delete(key(entry));
    };
    for (const effect of tr.effects) {
      if (effect.is(registerFold)) {
        changed ??= new Map(previous);
        changed.set(key(effect.value), effect.value);
      } else if (effect.is(unfoldEffect)) {
        const entry = (changed ?? previous).get(key(effect.value));
        if (entry) remove(entry);
      }
    }
    if (tr.selection)
      for (const entry of (changed ?? previous).values())
        if (
          tr.newSelection.ranges.some((range) =>
            selectionIntersectsFold(range, entry)
          )
        )
          remove(entry);
    return changed?.size === 0 ? emptyEntries : (changed ?? previous);
  },
});

export function foldEntry(state: EditorState, range: FoldRange) {
  return state.field(editorFoldEntries, false)?.get(key(range));
}
export function exactLiveFold(state: EditorState, range: FoldRange) {
  let found = false;
  foldedRanges(state).between(range.from, range.from, (from, to) => {
    if (from === range.from && to === range.to) found = true;
  });
  return found;
}
export function currentTypedFold(
  state: EditorState,
  stamp: FoldRange & { doc: Text; kind: EditorFoldKind }
) {
  const entry = foldEntry(state, stamp);
  return state.doc === stamp.doc &&
    entry?.kind === stamp.kind &&
    exactLiveFold(state, stamp)
    ? entry
    : undefined;
}
export function selectedTypedFold(state: EditorState, kind: EditorFoldKind) {
  const head = state.selection.main.head;
  let result: EditorFoldEntry | undefined;
  for (const entry of state.field(editorFoldEntries).values()) {
    const line = entry.kind === "heading" ? entry.titleFrom : entry.openingFrom;
    if (
      entry.kind === kind &&
      head >= line &&
      head <= entry.to &&
      (!result || entry.from >= result.from) &&
      exactLiveFold(state, entry)
    )
      result = entry;
  }
  return result;
}

/** Sole builder. No arbitrary effects/changes are accepted; clearing and adding cannot mix. */
export function toggleTypedFold(
  state: EditorState,
  doc: Text,
  entry: EditorFoldEntry
) {
  if (
    state.doc !== doc ||
    (entry.kind === "frontmatter" && !state.facet(frontmatterEditing)) ||
    state.field(editorFaultSession, false)?.fault ||
    !Number.isSafeInteger(entry.from) ||
    !Number.isSafeInteger(entry.to) ||
    entry.from < 0 ||
    entry.to > state.doc.length ||
    entry.to <= entry.from
  )
    return null;
  const prior = foldEntry(state, entry);
  if (exactLiveFold(state, entry)) {
    if (prior?.kind !== entry.kind) return null;
    return state.update({
      effects: unfoldEffect.of(entry),
      annotations: Transaction.addToHistory.of(false),
    });
  }
  const structure = state.field(headingStructureState, false);
  if (structure?.doc !== doc || structure.tree !== syntaxTree(state))
    return null;
  if (entry.kind === "heading") {
    const section =
      structure.sections[
        headingLowerBound(structure.sections, entry.titleFrom)
      ];
    if (
      section?.line !== entry.titleFrom ||
      section.from !== entry.from ||
      section.to !== entry.to
    )
      return null;
  } else if (entry.kind === "fencedCode") {
    const section =
      structure.code[headingLowerBound(structure.code, entry.openingFrom)];
    if (
      section?.line !== entry.openingFrom ||
      section.from !== entry.from ||
      section.to !== entry.to ||
      section.languageLabel !== entry.languageLabel ||
      section.lineCount !== entry.lineCount
    )
      return null;
  } else {
    const section = structure.frontmatter;
    if (
      !section ||
      section.lineCount <= 0 ||
      section.line !== entry.openingFrom ||
      section.from !== entry.from ||
      section.to !== entry.to
    )
      return null;
  }
  let crossing = false;
  foldedRanges(state).between(entry.from, entry.to, (from, to) => {
    if (
      from < entry.to &&
      to > entry.from &&
      !(from <= entry.from && to >= entry.to) &&
      !(from >= entry.from && to <= entry.to)
    )
      crossing = true;
  });
  if (crossing) return null;
  const overlaps = state.selection.ranges.some((range) =>
    selectionIntersectsFold(range, entry)
  );
  if (
    overlaps &&
    (state.selection.ranges.length !== 1 || !state.selection.main.empty)
  )
    return null;
  const selection = overlaps
    ? EditorSelection.single(entry.from)
    : state.selection;
  if (selection.ranges.some((range) => selectionIntersectsFold(range, entry)))
    return null;
  return state.update({
    effects: [registerFold.of(entry), foldEffect.of(entry)],
    selection: overlaps ? selection : undefined,
    annotations: Transaction.addToHistory.of(false),
  });
}

export const clearLocatedEditorFolds = EditorState.transactionExtender.of(
  (tr) => {
    const all =
      tr.docChanged ||
      tr.effects.some((e) => e.is(clearEditorFolds)) ||
      !!tr.startState.field(editorFaultSession, false)?.fault;
    const onlyFrontmatter = tr.effects.some((effect) =>
      effect.is(unfoldFrontmatter)
    );
    if (!all && !tr.selection && !onlyFrontmatter) return null;
    const effects: StateEffect<unknown>[] = [];
    foldedRanges(tr.startState).between(
      0,
      tr.startState.doc.length,
      (from, to) => {
        const mapped = {
          from: tr.changes.mapPos(from, 1),
          to: tr.changes.mapPos(to, -1),
        };
        if (
          all ||
          (onlyFrontmatter &&
            foldEntry(tr.startState, { from, to })?.kind === "frontmatter") ||
          tr.newSelection.ranges.some((range) =>
            selectionIntersectsFold(range, mapped)
          )
        )
          effects.push(unfoldEffect.of(mapped));
      }
    );
    return effects.length ? { effects } : null;
  }
);
