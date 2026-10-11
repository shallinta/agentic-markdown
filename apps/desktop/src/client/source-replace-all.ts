import { SearchQuery } from "@codemirror/search";
import { EditorState, Text, type ChangeSet } from "@codemirror/state";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import { visitRawChanges } from "./raw-changes";
import {
  ALL_LINE_WORK,
  ALL_INSERTED_BREAK_LIMIT,
  ALL_RANGE_LIMIT,
  validReplaceAllRequest,
  validReplaceAllResult,
  type ReplaceAllRequest,
  type ReplaceAllResult,
} from "./source-replace-all-protocol";

const normalize = (s: string) => s.replace(/\r\n?/g, "\n");
const logical = normalize;
const bytes = (s: string) => new TextEncoder().encode(s).length;
class Rejected extends Error {
  constructor(readonly reason: "size" | "cost") {
    super(reason);
  }
}
function makeChanges(
  state: EditorState,
  pairs: Uint32Array,
  replacement: string
) {
  const insert = Text.of(replacement.split("\n"));
  return state.changes(
    Array.from({ length: pairs.length / 2 }, (_, i) => ({
      from: pairs[i * 2],
      to: pairs[i * 2 + 1],
      insert,
    }))
  );
}
function beforeConstruction(
  state: EditorState,
  pairs: Uint32Array,
  replacement: string
) {
  const count = pairs.length / 2;
  if (count > ALL_RANGE_LIMIT) throw new Rejected("cost");
  let breaks = 0;
  for (const char of replacement) {
    if (char === "\n" && ++breaks * count > ALL_INSERTED_BREAK_LIMIT)
      throw new Rejected("cost");
  }
  let removed = 0;
  for (let i = 0; i < pairs.length; i += 2) removed += pairs[i + 1] - pairs[i];
  if (
    state.doc.length - removed + replacement.length * count >
    MAX_DOCUMENT_BYTES
  )
    throw new Rejected("size");
  if (
    !/[\uD800-\uDFFF]/u.test(replacement) &&
    bytes(replacement) * count > MAX_DOCUMENT_BYTES
  )
    throw new Rejected("size");
  let longest = 0;
  const lines = state.doc.iterLines();
  while (!lines.next().done) longest = Math.max(longest, lines.value.length);
  if (longest * count > ALL_LINE_WORK) throw new Rejected("cost");
  return longest;
}
function outputCost(longest: number, output: number, count: number) {
  if (!replaceAllCostAllowed(count, longest, output))
    throw new Rejected("cost");
}
function replaceAllCostAllowed(
  count: number,
  sourceLine: number,
  outputLine: number
) {
  return (
    [count, sourceLine, outputLine].every(
      (n) => Number.isSafeInteger(n) && n >= 0
    ) &&
    count <= ALL_RANGE_LIMIT &&
    sourceLine * count <= ALL_LINE_WORK &&
    outputLine * count <= ALL_LINE_WORK &&
    (sourceLine + outputLine) * count <= ALL_LINE_WORK * 2
  );
}

/** Stream the exact shared raw policy; no expanded whole output before byte checks. */
function measure(
  raw: string,
  changes: ChangeSet,
  pairs: Uint32Array,
  replacement: string
) {
  const encoder = new TextEncoder();
  let pendingHigh = "",
    pendingCR = false,
    line = 0,
    longest = 0;
  let outputBytes = 0,
    outputOffset = 0,
    equal = true,
    changed = 0;
  const emit = (piece: string) => {
    if (equal && raw.slice(outputOffset, outputOffset + piece.length) !== piece)
      equal = false;
    outputOffset += piece.length;
    const joined = pendingHigh + piece;
    const last = joined.charCodeAt(joined.length - 1);
    pendingHigh = last >= 0xd800 && last <= 0xdbff ? joined.slice(-1) : "";
    outputBytes += encoder.encode(
      pendingHigh ? joined.slice(0, -1) : joined
    ).length;
    if (outputBytes > MAX_DOCUMENT_BYTES) throw new Rejected("size");
    let i = 0;
    while (i < piece.length) {
      const char = piece[i++];
      if (pendingCR) {
        longest = Math.max(longest, line);
        line = 0;
        pendingCR = false;
        if (char === "\n") continue;
      }
      if (char === "\r") pendingCR = true;
      else if (char === "\n") {
        longest = Math.max(longest, line);
        line = 0;
      } else line++;
    }
  };
  let previous = 0,
    pair = 0;
  // At most two bounded replacement strings, never replacement × match count.
  const insertions = new Map<string, string>();
  visitRawChanges(raw, changes, (start, end, insert, separator) => {
    emit(raw.slice(previous, start));
    let insertion = insertions.get(separator);
    if (insertion === undefined) {
      insertion =
        separator === "\n"
          ? replacement
          : replacement.replace(/\n/g, separator);
      insertions.set(separator, insertion);
    }
    let pos = start,
      units = 0;
    while (pos < end) {
      if (pair >= pairs.length) throw new Error("missing replacement range");
      const begin = pos,
        length = pairs[pair + 1] - pairs[pair];
      for (let i = 0; i < length; i++)
        pos += raw[pos] === "\r" && raw[pos + 1] === "\n" ? 2 : 1;
      if (pos > end) throw new Error("invalid replacement range");
      if (raw.slice(begin, pos) !== insertion) changed++;
      emit(insertion);
      units += replacement.length;
      pair += 2;
    }
    if (units !== insert.length)
      throw new Error("invalid replacement contribution");
    previous = end;
  });
  emit(raw.slice(previous));
  outputBytes += encoder.encode(pendingHigh).length;
  if (outputBytes > MAX_DOCUMENT_BYTES) throw new Rejected("size");
  longest = Math.max(longest, line);
  if (pair !== pairs.length)
    throw new Error("missing replacement contribution");
  return {
    bytes: outputBytes,
    longest,
    changed: equal && outputOffset === raw.length ? 0 : changed,
  };
}

/** Worker-only complete snapshot planning; no Markdown parser or filesystem. */
export function planReplaceAll(request: ReplaceAllRequest): ReplaceAllResult {
  if (!validReplaceAllRequest(request))
    throw new Error("invalid replacement request");
  const { id, raw, options } = request;
  try {
    if (bytes(raw) > MAX_DOCUMENT_BYTES) throw new Rejected("size");
    const replacement = normalize(request.replacement),
      query = normalize(options.query);
    const folded = options.caseSensitive ? query : query.toLowerCase();
    const search = new SearchQuery({
      search: query,
      literal: true,
      regexp: false,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      test: (match) =>
        (options.caseSensitive ? match : match.toLowerCase()) === folded,
    });
    const state = EditorState.create({ doc: logical(raw) });
    // This proof deliberately excludes case-folding and contextual line endings.
    const exactNoop =
      options.caseSensitive && query === replacement && !/[\r\n]/.test(query);
    const pairs = exactNoop
      ? new Uint32Array()
      : new Uint32Array(ALL_RANGE_LIMIT * 2);
    let matched = 0,
      removed = 0;
    if (search.valid) {
      const cursor = search.getCursor(state);
      for (let item = cursor.next(); !item.done; item = cursor.next()) {
        if (!exactNoop) {
          if (matched === ALL_RANGE_LIMIT) throw new Rejected("cost");
          pairs[matched * 2] = item.value.from;
          pairs[matched * 2 + 1] = item.value.to;
          removed += item.value.to - item.value.from;
        }
        matched++;
      }
    }
    if (exactNoop || !matched) return { id, kind: "noop", matched, changed: 0 };
    if (
      state.doc.length - removed + replacement.length * matched >
      MAX_DOCUMENT_BYTES
    )
      throw new Rejected("size");
    // Surrogate seams can reduce summed encoding sizes; use only this safe shortcut.
    if (
      !/[\uD800-\uDFFF]/u.test(replacement) &&
      bytes(replacement) * matched > MAX_DOCUMENT_BYTES
    )
      throw new Rejected("size");
    const ranges = pairs.slice(0, matched * 2);
    const longest = beforeConstruction(state, ranges, replacement);
    const changes = makeChanges(state, ranges, replacement);
    const result = measure(raw, changes, ranges, replacement);
    if (!result.changed) return { id, kind: "noop", matched, changed: 0 };
    outputCost(longest, result.longest, matched);
    return {
      id,
      kind: "plan",
      matched,
      changed: result.changed,
      bytes: result.bytes,
      pairs: ranges,
    };
  } catch (error) {
    if (error instanceof Rejected)
      return { id, kind: "rejected", reason: error.reason };
    throw error;
  }
}

/** Live caller verifies snapshot/permissions immediately before this one transaction. */
export function prepareAllChanges(
  state: EditorState,
  raw: string,
  replacement: string,
  plan: Extract<ReplaceAllResult, { kind: "plan" }>
) {
  if (state.readOnly || !validReplaceAllResult(plan, plan.id, state.doc.length))
    return null;
  try {
    const normalized = normalize(replacement);
    const longest = beforeConstruction(state, plan.pairs, normalized);
    const changes = makeChanges(state, plan.pairs, normalized);
    const measured = measure(raw, changes, plan.pairs, normalized);
    if (measured.bytes !== plan.bytes || measured.changed !== plan.changed)
      return null;
    outputCost(longest, measured.longest, plan.matched);
    return changes;
  } catch {
    return null;
  }
}
