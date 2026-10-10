import type { ChangeSet } from "@codemirror/state";

/** Monotonic CM-to-raw traversal; no document-sized index on ordinary typing. */
export function applyRawChanges(raw: string, changes: ChangeSet): string {
  let cursor = 0,
    logical = 0,
    previousSeparator = "\n",
    previous = 0;
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
  const pieces: string[] = [];
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const start = offset(from),
      text = inserted.toString();
    const insertion =
      inserted.lines > 1 ? text.replace(/\n/g, separator(start)) : text;
    // Resolve the insertion's context before advancing beyond the removed span.
    const end = offset(to);
    pieces.push(raw.slice(previous, start), insertion);
    previous = end;
  });
  pieces.push(raw.slice(previous));
  return pieces.join("");
}
