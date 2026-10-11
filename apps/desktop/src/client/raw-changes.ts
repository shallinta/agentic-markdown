import type { ChangeSet, Text } from "@codemirror/state";

/** Monotonic CM-to-raw traversal; no document-sized index on ordinary typing. */
export function visitRawChanges(
  raw: string,
  changes: ChangeSet,
  visit: (from: number, to: number, insert: Text, separator: string) => void
): void {
  let cursor = 0,
    logical = 0,
    previousSeparator = "\n";
  let nextStop = -1,
    nextSeparator = "";
  const offset = (target: number) => {
    while (cursor < raw.length && logical < target) {
      if (raw[cursor] === "\r" && raw[cursor + 1] === "\n") {
        cursor += 2;
        previousSeparator = "\r\n";
      } else {
        if (raw[cursor] === "\n")
          previousSeparator = raw[cursor - 1] === "\r" ? "\r\n" : "\n";
        cursor++;
      }
      logical++;
    }
    return cursor;
  };
  const separator = (start: number) => {
    if (start > nextStop) {
      nextStop = start;
      while (
        nextStop < raw.length &&
        raw[nextStop] !== "\r" &&
        raw[nextStop] !== "\n"
      )
        nextStop++;
      nextSeparator =
        raw[nextStop] === "\n"
          ? "\n"
          : raw[nextStop] === "\r" && raw[nextStop + 1] === "\n"
            ? "\r\n"
            : "";
    }
    // A lone CR ends the forward search, matching the original EOL policy.
    return nextSeparator || previousSeparator;
  };
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const start = offset(from);
    const ending = inserted.lines > 1 ? separator(start) : "\n";
    // Resolve the insertion's context before advancing beyond the removed span.
    const end = offset(to);
    visit(start, end, inserted, ending);
  });
}

export function applyRawChanges(raw: string, changes: ChangeSet): string {
  const pieces: string[] = [];
  let previous = 0;
  visitRawChanges(raw, changes, (start, end, inserted, separator) => {
    const text = inserted.toString();
    pieces.push(
      raw.slice(previous, start),
      inserted.lines > 1 ? text.replace(/\n/g, separator) : text
    );
    previous = end;
  });
  pieces.push(raw.slice(previous));
  return pieces.join("");
}
