import { StateField, type ChangeDesc, type Text } from "@codemirror/state";

// Provisional local presentation threshold in UTF-16 units, not a file limit/SLO.
export const LONG_LINE_UNITS = 10_000;
export interface TextSpan {
  readonly from: number;
  readonly to: number;
}

function scan(doc: Text, from: number, to: number): TextSpan[] {
  const spans: TextSpan[] = [];
  let line = doc.lineAt(from);
  while (line.from <= to) {
    if (line.length >= LONG_LINE_UNITS)
      spans.push({ from: line.from, to: line.to });
    if (line.to >= to || line.to === doc.length) break;
    line = doc.lineAt(line.to + 1);
  }
  return spans;
}

export function detectLongLines(doc: Text): readonly TextSpan[] {
  return scan(doc, 0, doc.length);
}

/** Map unchanged spans, inspect only new physical lines touched by changes. */
export function updateLongLines(
  previous: readonly TextSpan[],
  changes: ChangeDesc,
  doc: Text
): readonly TextSpan[] {
  if (changes.empty) return previous;
  const windows: TextSpan[] = [];
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const from = doc.lineAt(fromB).from;
    const to = doc.lineAt(toB).to;
    const last = windows[windows.length - 1];
    if (last && from <= last.to + 1)
      windows[windows.length - 1] = {
        from: last.from,
        to: Math.max(last.to, to),
      };
    else windows.push({ from, to });
  });
  const mapped = previous
    .map(({ from, to }) => ({
      from: changes.mapPos(from, 1),
      to: changes.mapPos(to, -1),
    }))
    .filter(
      ({ from, to }) =>
        from < to &&
        !windows.some((window) => from <= window.to && to >= window.from)
    );
  for (const window of windows)
    mapped.push(...scan(doc, window.from, window.to));
  return mapped.sort((a, b) => a.from - b.from);
}

export const longLineProtection = StateField.define<readonly TextSpan[]>({
  create: (state) => detectLongLines(state.doc),
  update: (value, transaction) =>
    transaction.docChanged
      ? updateLongLines(value, transaction.changes, transaction.newDoc)
      : value,
});

/** Point/line decorations need an inclusive check at the physical line edges. */
export function protectedPosition(
  spans: readonly TextSpan[],
  position: number
) {
  return spans.some(({ from, to }) => from <= position && position <= to);
}

/** Marks may be split, but replacement decorations must not be split. */
export function unprotectedParts(
  spans: readonly TextSpan[],
  from: number,
  to: number
): TextSpan[] {
  const parts: TextSpan[] = [];
  let cursor = from;
  for (const span of spans) {
    if (span.to <= cursor) continue;
    if (span.from >= to) break;
    if (cursor < span.from) parts.push({ from: cursor, to: span.from });
    cursor = Math.max(cursor, span.to);
    if (cursor >= to) break;
  }
  if (cursor < to) parts.push({ from: cursor, to });
  return parts;
}

export function touchesProtected(
  spans: readonly TextSpan[],
  from: number,
  to: number
) {
  return spans.some((span) => from < span.to && to > span.from);
}
