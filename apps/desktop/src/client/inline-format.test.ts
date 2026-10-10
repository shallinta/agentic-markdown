import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";

import { parseCanonicalMarkdown } from "./canonical-parser";
import {
  inlineFormatTransaction,
  planInlineFormat,
  type InlineFormat,
} from "./inline-format";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";

function state(raw: string, ranges: [number, number][], main = 0) {
  return createRawEditorState(raw, EditorStateAllowMultiple).update({
    selection: EditorSelection.create(
      ranges.map(([a, b]) => EditorSelection.range(a, b)),
      main
    ),
  }).state;
}
const EditorStateAllowMultiple = EditorState.allowMultipleSelections.of(true);
function apply(value: EditorState, kind: InlineFormat) {
  const tx = inlineFormatTransaction(value, kind);
  expect(tx).toBeDefined();
  return tx!.state;
}
test("empty caret at a reliable text endpoint supports templates without borrowing markup", () => {
  expect(apply(state("AAA", [[3, 3]]), "bold").doc.toString()).toBe(
    "AAA**文本**"
  );
  expect(apply(state("AAA\n\nBBB", [[3, 3]]), "bold").doc.toString()).toBe(
    "AAA**文本**\n\nBBB"
  );
  for (const raw of ["- AAA", "> AAA", "# AAA"])
    expect(
      apply(state(raw, [[raw.length, raw.length]]), "bold").doc.toString()
    ).toBe(raw + "**文本**");
  const multi = apply(
    state(
      "AAA\nBBB",
      [
        [0, 3],
        [7, 7],
      ],
      1
    ),
    "bold"
  );
  expect(multi.doc.toString()).toBe("**AAA**\nBBB**文本**");
  expect(multi.selection.mainIndex).toBe(1);
  expect(
    multi.selection.ranges.map((r) => multi.sliceDoc(r.from, r.to))
  ).toEqual(["AAA", "文本"]);
  for (const raw of ["**AAA**", "`AAA`", "```\nAAA\n```", "<div>AAA</div>"])
    expect(
      planInlineFormat(state(raw, [[raw.length, raw.length]]), "bold")
    ).toBeUndefined();
});
test("three formats wrap, unwrap, and empty documents use selected Chinese templates", () => {
  for (const [kind, mark] of [
    ["bold", "**"],
    ["italic", "*"],
    ["code", "`"],
  ] as const) {
    const before = state("hello", [[0, 5]]);
    const after = apply(before, kind);
    expect(after.doc.toString()).toBe(mark + "hello" + mark);
    expect(apply(after, kind).doc.toString()).toBe("hello");
    const empty = apply(state("", [[0, 0]]), kind);
    expect(
      empty.sliceDoc(empty.selection.main.from, empty.selection.main.to)
    ).toBe("文本");
    expect(empty.doc.toString()).toBe(mark + "文本" + mark);
  }
});
test("code delimiters preserve literal backticks and spaces, unwrap retains padding", () => {
  for (const text of ["a`b", "`x", " a ", "   "]) {
    const after = apply(
      state("pre " + text + " end", [[4, 4 + text.length]]),
      "code"
    );
    expect(
      after.sliceDoc(after.selection.main.from, after.selection.main.to)
    ).toBe(text);
    const paragraph = parseCanonicalMarkdown(after.field(rawText)).children[0];
    expect(paragraph.type).toBe("paragraph");
    if (paragraph.type === "paragraph") {
      const code = paragraph.children.find(
        (node) => node.type === "inlineCode"
      );
      expect(code && "value" in code ? code.value : undefined).toBe(text);
    }
  }
  const padded = apply(state("`x", [[0, 2]]), "code");
  const whole = padded.update({
    selection: { anchor: 0, head: padded.doc.length },
  }).state;
  expect(apply(whole, "code").doc.toString()).toBe(" `x ");
});

test("whole semantic blocks validate multiline context and mixed wrap/unwrap once", () => {
  expect(
    planInlineFormat(state("*first\nsecond", [[1, 6]]), "italic")
  ).toBeUndefined();
  for (const raw of ["- first\n  second", "> first\n> second"]) {
    const from = raw.indexOf("second");
    expect(apply(state(raw, [[from, from + 6]]), "bold").doc.toString()).toBe(
      raw.replace("second", "**second**")
    );
  }
  expect(
    apply(
      state(
        "**AAA** BBB",
        [
          [2, 5],
          [8, 11],
        ],
        1
      ),
      "bold"
    ).doc.toString()
  ).toBe("AAA **BBB**");
  const same = apply(
    state(
      "**ABCDE**",
      [
        [3, 3],
        [5, 5],
      ],
      1
    ),
    "bold"
  );
  expect(same.doc.toString()).toBe("ABCDE");
  expect(same.selection.ranges.map((r) => r.head)).toEqual([1, 3]);
  expect(same.selection.mainIndex).toBe(1);
  const raw = "a".repeat(6000) + "\n\n" + "b".repeat(6000);
  expect(
    planInlineFormat(
      state(raw, [
        [1, 2],
        [6003, 6004],
      ]),
      "bold"
    )
  ).toBeUndefined();
  const readonly = createRawEditorState("").update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(planInlineFormat(readonly, "bold")).toBeUndefined();
});
test("multiple ranges preserve direction/main and one history step/raw fidelity", () => {
  let value = state(
    "\uFEFFAAA\r\nBBB",
    [
      [4, 1],
      [5, 8],
    ],
    1
  );
  const before = value;
  value = apply(value, "bold");
  expect(value.field(rawText)).toBe("\uFEFF**AAA**\r\n**BBB**");
  expect(value.selection.mainIndex).toBe(1);
  expect(value.selection.ranges[0].anchor).toBeGreaterThan(
    value.selection.ranges[0].head
  );
  const formatted = value;
  expect(
    undo({
      state: value,
      dispatch: (tx) => {
        value = tx.state;
      },
    })
  ).toBe(true);
  expect(value.field(rawText)).toBe(before.field(rawText));
  expect(
    redo({
      state: value,
      dispatch: (tx) => {
        value = tx.state;
      },
    })
  ).toBe(true);
  expect(value.field(rawText)).toBe(formatted.field(rawText));
});
test("cross-line, partial syntax, code blocks, marker positions and unsafe whitespace reject", () => {
  for (const [raw, from, to] of [
    ["a\nb", 0, 3],
    ["**abc**", 3, 4],
    ["```\na\n```", 4, 5],
    ["- abc", 0, 1],
    ["> abc", 0, 1],
    [" a ", 0, 3],
  ] as const)
    expect(planInlineFormat(state(raw, [[from, to]]), "bold")).toBeUndefined();
  expect(apply(state("- abc", [[2, 5]]), "bold").doc.toString()).toBe(
    "- **abc**"
  );
  expect(apply(state("> abc", [[2, 5]]), "italic").doc.toString()).toBe(
    "> *abc*"
  );
  expect(apply(state("a\n\n", [[3, 3]]), "bold").doc.toString()).toBe(
    "a\n\n**文本**"
  );
});
