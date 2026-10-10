import { expect, test } from "bun:test";

import { EditorState, type ChangeSet } from "@codemirror/state";

import { applyEditorChanges, editorText } from "./raw-buffer";

// Frozen repository oracle from e492c6f, before F-043d's lazy traversal.
// Deliberately do not reuse production offset/separator helpers: their original
// prefix scans define compatibility, not an alternative production algorithm.
function originalApply(raw: string, changes: ChangeSet): string {
  const offset = (target: number) => {
    let cursor = 0;
    let logical = 0;
    while (cursor < raw.length && logical < target) {
      if (raw[cursor] === "\r" && raw[cursor + 1] === "\n") cursor++;
      cursor++;
      logical++;
    }
    return cursor;
  };
  const separator = (start: number) => {
    for (let cursor = start; cursor < raw.length; cursor++) {
      if (raw[cursor] === "\r" && raw[cursor + 1] === "\n") return "\r\n";
      if (raw[cursor] === "\n") return "\n";
      if (raw[cursor] === "\r") break;
    }
    for (let cursor = start - 1; cursor >= 0; cursor--) {
      if (raw[cursor] === "\n") return raw[cursor - 1] === "\r" ? "\r\n" : "\n";
    }
    return "\n";
  };
  const pieces: string[] = [];
  let previous = 0;
  changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    const start = offset(from);
    const end = offset(to);
    pieces.push(raw.slice(previous, start));
    pieces.push(inserted.toString().replace(/\n/g, separator(start)));
    previous = end;
  });
  pieces.push(raw.slice(previous));
  return pieces.join("");
}

interface Edit {
  from: number;
  to: number;
  insert: string;
}

function compare(raw: string, edits: Edit[]) {
  const state = EditorState.create({ doc: editorText(raw) });
  const changes = state.changes(edits);
  expect(applyEditorChanges(raw, changes), JSON.stringify({ raw, edits })).toBe(
    originalApply(raw, changes)
  );
}

test("lazy raw mapping retains BOM, mixed separators, EOF and unchanged spans", () => {
  const raw = "\ufeffa\r\nb\nc\rd";
  for (const insert of ["", "x", "\n", "\r", "\r\n", "x\ny", "😀"]) {
    for (let at = 0; at <= editorText(raw).length; at++) {
      compare(raw, [{ from: at, to: at, insert }]);
      if (at < editorText(raw).length)
        compare(raw, [{ from: at, to: at + 1, insert }]);
    }
  }
  const state = EditorState.create({ doc: editorText(raw) });
  expect(applyEditorChanges(raw, state.changes([]))).toBe(raw);
  expect(
    applyEditorChanges(raw, state.changes({ from: 2, insert: "\n" }))
  ).toBe("\ufeffa\r\n\r\nb\nc\rd");
  expect(
    applyEditorChanges(raw, state.changes({ from: 7, insert: "\n" }))
  ).toBe("\ufeffa\r\nb\nc\r\nd");
});

test("lazy raw mapping matches bounded exhaustive short CR/LF edits and same-position inserts", () => {
  const raws = [""];
  let level = [""];
  for (let depth = 0; depth < 3; depth++) {
    level = level.flatMap((raw) => ["a", "\r", "\n"].map((c) => raw + c));
    raws.push(...level);
  }
  for (const raw of raws) {
    const length = editorText(raw).length;
    for (let from = 0; from <= length; from++) {
      for (let to = from; to <= length; to++) {
        for (const insert of [
          "",
          "x",
          "\n",
          "\r",
          "\r\n",
          "x\ny",
          "\ufeff",
          "😀",
        ])
          compare(raw, [{ from, to, insert }]);
      }
      compare(raw, [
        { from, to: from, insert: "\r" },
        { from, to: from, insert: "\n" },
      ]);
    }
  }
});

test("lazy raw mapping matches fixed-seed multi-change oracle including Unicode offsets", () => {
  let seed = 0x12345678;
  const random = (max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % max;
  };
  const alphabet = ["a", "b", "\r", "\n", "😀", "\ufeff"];
  const inserts = ["", "x", "\n", "\r", "\r\n", "x\ny", "\ufeff", "😀"];
  for (let sample = 0; sample < 2000; sample++) {
    let raw = "";
    for (let remaining = random(60); remaining > 0; remaining--)
      raw += alphabet[random(alphabet.length)];
    const length = editorText(raw).length;
    let at = 0;
    const edits: Edit[] = [];
    for (
      let remaining = 1 + random(8);
      remaining > 0 && at <= length;
      remaining--
    ) {
      const from = at + random(length - at + 1);
      const to = from + random(length - from + 1);
      edits.push({ from, to, insert: inserts[random(inserts.length)] });
      at = to;
    }
    compare(raw, edits);
  }
});

test("default adjacent-change reporting remains intact without coalescing coordinate maps", () => {
  for (const raw of ["aa", "a\r\na", "\ufeffa\rb\nc\r\nd"]) {
    const state = EditorState.create({ doc: editorText(raw) });
    const changes = state.changes([
      { from: 0, to: 1, insert: "b\nb" },
      { from: 1, to: 2, insert: "c\nc" },
      { from: 2, insert: "\n" },
    ]);
    const before: unknown = changes.toJSON();
    const positions = Array.from({ length: state.doc.length + 1 }, (_, at) => [
      changes.mapPos(at, -1),
      changes.mapPos(at, 1),
    ]);
    expect(applyEditorChanges(raw, changes)).toBe(originalApply(raw, changes));
    expect(changes.toJSON()).toEqual(before);
    expect(
      Array.from({ length: state.doc.length + 1 }, (_, at) => [
        changes.mapPos(at, -1),
        changes.mapPos(at, 1),
      ])
    ).toEqual(positions);
  }
});
