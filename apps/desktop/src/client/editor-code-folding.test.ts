import { expect, test } from "bun:test";

import { undoDepth } from "@codemirror/commands";
import {
  foldEffect,
  foldedRanges,
  syntaxTreeAvailable,
} from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from "@codemirror/state";

import { isCommand } from "../shared/commands";

import {
  editorFoldEntries,
  foldEntry,
  currentTypedFold,
  selectedTypedFold,
  toggleTypedFold,
  type EditorFoldEntry,
} from "./editor-fold-state";
import {
  pauseEditorParser,
  resumeEditorParser,
  safeSourceEffects,
  switchEditorMode,
} from "./editor-mode";
import {
  codeToggleTransaction,
  headingToggleTransaction,
  headingStructureReady,
} from "./heading-folding";
import { headingStructureSteps } from "./heading-structure";
import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

function prepared(
  raw = "# A\n```ts\nx\ny\n```\nend\n# B\nlast",
  extra: Parameters<typeof createRawEditorState>[1] = []
) {
  let state = createRawEditorState(raw, extra);
  const task = headingStructureSteps(state);
  let next = task.next();
  while (!next.done) next = task.next();
  state = state.update({ effects: headingStructureReady.of(next.value) }).state;
  return { state, structure: next.value };
}
function count(state: EditorState) {
  return foldedRanges(state).size;
}
function entry(
  section: ReturnType<typeof prepared>["structure"]["code"][number]
): EditorFoldEntry {
  return {
    kind: "fencedCode",
    openingFrom: section.line,
    from: section.from,
    to: section.to,
    languageLabel: section.languageLabel,
    lineCount: section.lineCount,
  };
}
test("actual factory prepares typed code placeholder in one state update with raw/history unchanged", () => {
  let updates = 0;
  const spy = StateField.define({
    create: () => 0,
    update: (value) => {
      updates++;
      return value + 1;
    },
  });
  const { state, structure } = prepared(undefined, spy),
    before = updates;
  const tr = codeToggleTransaction(state, structure.code[0])!,
    next = tr.state;
  expect(updates - before).toBe(1);
  expect(count(next)).toBe(1);
  expect(next.field(rawText)).toBe(state.field(rawText));
  expect(undoDepth(next)).toBe(undoDepth(state));
  const item = foldedRanges(next).iter();
  expect(
    (item.value!.spec as { widget: { value: unknown } }).widget.value
  ).toEqual({
    doc: next.doc,
    from: structure.code[0].from,
    to: structure.code[0].to,
    entry: entry(structure.code[0]),
  });
  expect(next.field(editorFoldEntries).size).toBe(1);
  const entries = next.field(editorFoldEntries);
  expect(next.update({}).state.field(editorFoldEntries)).toBe(entries);
  expect(
    next.update({ selection: { anchor: 1 } }).state.field(editorFoldEntries)
  ).toBe(entries);
});
test("typed builder requires current reliable structure and refuses stale/forged/crossing ranges", () => {
  const { state, structure } = prepared(),
    code = structure.code[0],
    value = entry(code);
  expect(
    toggleTypedFold(
      createRawEditorState(state.field(rawText)),
      state.doc,
      value
    )
  ).toBeNull();
  const changed = state.update({ changes: { from: 0, insert: "X" } }).state;
  expect(toggleTypedFold(changed, changed.doc, value)).toBeNull();
  expect(
    toggleTypedFold(state, state.doc, { ...value, to: value.to - 1 })
  ).toBeNull();
  expect(
    toggleTypedFold(state, state.doc, {
      kind: "heading",
      titleFrom: code.line,
      from: code.from,
      to: code.to,
    })
  ).toBeNull();
  const crossing = state.update({
    effects: foldEffect.of({ from: code.from - 1, to: code.to - 1 }),
  }).state;
  expect(codeToggleTransaction(crossing, code)).toBeNull();
});
test("both nesting orders preserve code on heading unfold and commands remain kind limited", () => {
  for (const reverse of [true, false]) {
    const { state: initial, structure } = prepared();
    let state = initial;
    state = reverse
      ? headingToggleTransaction(state, structure.sections[0])!.state
      : codeToggleTransaction(state, structure.code[0])!.state;
    state = reverse
      ? codeToggleTransaction(state, structure.code[0])!.state
      : headingToggleTransaction(state, structure.sections[0])!.state;
    expect(count(state)).toBe(2);
    const code = structure.code[0];
    expect(
      currentTypedFold(state, {
        doc: state.doc,
        kind: "heading",
        from: code.from,
        to: code.to,
      })
    ).toBeUndefined();
    state = headingToggleTransaction(state, structure.sections[0])!.state;
    expect(count(state)).toBe(1);
    expect(selectedTypedFold(state, "heading")).toBeUndefined();
    state = state.update({ selection: { anchor: code.line } }).state;
    expect(selectedTypedFold(state, "fencedCode")?.kind).toBe("fencedCode");
    expect(state.field(editorFoldEntries).size).toBe(1);
  }
});
test("all selected locations expand nested typed folds and nonempty/multicursor new folds reject", () => {
  const { state: initial, structure } = prepared();
  let state = initial.update({ effects: switchEditorMode("source") }).state;
  const code = structure.code[0];
  for (const selection of [
    EditorSelection.single(code.from, code.to),
    EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(code.from + 2),
    ]),
  ]) {
    const selected = state.update({ selection }).state;
    expect(selected.selection.ranges.length).toBe(selection.ranges.length);
    expect(codeToggleTransaction(selected, code)).toBeNull();
  }
  state = codeToggleTransaction(state, code)!.state;
  state = headingToggleTransaction(state, structure.sections[0])!.state;
  state = state.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(0),
      EditorSelection.cursor(code.from + 2),
    ]),
  }).state;
  expect(count(state)).toBe(0);
  expect(state.field(editorFoldEntries).size).toBe(0);
});
test("single caret safely moves; safe/edit clear metadata; source readonly and partial resume preserve", () => {
  const { state: initial, structure } = prepared();
  const code = structure.code[0];
  let state = initial.update({ selection: { anchor: code.from + 2 } }).state;
  state = codeToggleTransaction(state, code)!.state;
  expect(state.selection.main.head).toBe(code.from);
  state = state.update({
    effects: [
      ...switchEditorMode("source"),
      StateEffect.appendConfig.of(EditorState.readOnly.of(true)),
    ],
  }).state;
  expect(count(state)).toBe(1);
  const stamp = {
    doc: state.doc,
    kind: "fencedCode" as const,
    from: code.from,
    to: code.to,
  };
  state = state.update({ effects: pauseEditorParser(true) }).state;
  state = state.update({ effects: resumeEditorParser(state) }).state;
  expect(currentTypedFold(state, stamp)).toBeDefined();
  const clean = state.update({ effects: safeSourceEffects() }).state;
  expect(count(clean)).toBe(0);
  expect(clean.field(editorFoldEntries).size).toBe(0);
  const changed = state.update({ changes: { from: 0, insert: "X" } }).state;
  expect(count(changed)).toBe(0);
  expect(changed.field(editorFoldEntries).size).toBe(0);
  expect(currentTypedFold(changed, stamp)).toBeUndefined();
});
test("official automatic new-fold selection cleanup has safe unknown preparation and no typed ghost", () => {
  const { state, structure } = prepared(),
    range = structure.code[0];
  const next = state.update({
    effects: foldEffect.of(range),
    selection: { anchor: range.from + 2 },
  }).state;
  expect(count(next)).toBe(0);
  expect(next.field(editorFoldEntries).size).toBe(0);
  const unknown = state.update({ effects: foldEffect.of(range) }).state;
  expect(foldEntry(unknown, range)).toBeUndefined();
  expect(
    (
      foldedRanges(unknown).iter().value!.spec as {
        widget: { value: { entry: unknown } };
      }
    ).widget.value.entry
  ).toBeUndefined();
  expect(codeToggleTransaction(unknown, range)).toBeNull();
});
test("closed and unclosed folded code suppress duplicate live language decorations", () => {
  for (const raw of [
    "before\n\n```ts\nx\n```\nafter",
    "before\n\n```ts\nx\n",
  ]) {
    const { state, structure } = prepared(raw),
      code = structure.code[0];
    const beforeClasses: string[] = [];
    liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
      0,
      state.doc.length,
      (_from, _to, value) => {
        const spec = value.spec as { class?: string };
        if (spec.class) beforeClasses.push(spec.class);
      }
    );
    expect(
      beforeClasses.some((value) => value.includes("cm-live-code-info"))
    ).toBe(true);
    const folded = codeToggleTransaction(state, code)!.state;
    const classes: string[] = [];
    liveDecorations(folded, [{ from: 0, to: folded.doc.length }]).between(
      0,
      folded.doc.length,
      (_from, _to, value) => {
        const spec = value.spec as { class?: string };
        if (spec.class) classes.push(spec.class);
      }
    );
    expect(classes.some((value) => value.includes("cm-live-code-info"))).toBe(
      false
    );
  }
});
test("code command accepts bounded target forms, not arbitrary effects or kind spoofing", () => {
  expect(isCommand({ type: "toggleCodeFold", args: {} })).toBe(true);
  expect(isCommand({ type: "toggleCodeFold", args: { heading: 4 } })).toBe(
    true
  );
  expect(
    isCommand({ type: "toggleCodeFold", args: { unfoldFrom: 4, unfoldTo: 20 } })
  ).toBe(true);
  expect(
    isCommand({
      type: "toggleCodeFold",
      args: { heading: 4, unfoldFrom: 4, unfoldTo: 20 },
    })
  ).toBe(false);
  expect(
    isCommand({
      type: "toggleCodeFold",
      args: { effects: [], kind: "heading" },
    })
  ).toBe(false);
});

test("fenced projection uses actual normalized CM coordinates with fixed line-count and boundary oracles", () => {
  const cases = [
    ["```ts\na\nb\n```\nafter", 2, "ts", "\na\nb\n```"],
    ["~~~\nx\n~~~", 1, "纯文本", "\nx\n~~~"],
    ["```\n```", 0, "纯文本", ""],
    ["```\n\n```", 1, "纯文本", "\n\n```"],
    ["```\nx\n\n```\n", 2, "纯文本", "\nx\n\n```"],
    ["```js\nx", 1, "js", "\nx"],
    ["```\nx\n", 1, "纯文本", "\nx"],
    ["> ```ts\n> a\n> b\n> ```\n> after", 2, "ts", "\n> a\n> b\n> ```"],
    ["- ```\n  a\n  ```\n- after", 1, "纯文本", "\n  a\n  ```"],
    ["> - ```js\n>   a\n>   ```\n> - after", 1, "js", "\n>   a\n>   ```"],
    ["```\n# A\n```\n# B", 1, "纯文本", "\n# A\n```"],
    ["```\n\n", 1, "纯文本", "\n"],
    ["```\n", 0, "纯文本", ""],
    ["> ```\n> x\n\noutside", 1, "纯文本", "\n> x"],
  ] as const;
  for (const [raw, count, label, hidden] of cases)
    for (const eol of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const input = bom + raw.replaceAll("\n", eol),
          { state, structure } = prepared(input);
        expect(state.field(rawText)).toBe(input);
        expect(structure.code).toHaveLength(count ? 1 : 0);
        if (count) {
          const code = structure.code[0];
          expect(code.lineCount).toBe(count);
          expect(code.languageLabel).toBe(label);
          expect(state.doc.sliceString(code.from, code.to)).toBe(hidden);
        }
      }
});
test("actual partial tree never publishes an unreliable long code tail", () => {
  for (const tail of ["", "```\n"]) {
    const { state, structure } = prepared(
      "```ts\n" + "x\n".repeat(9000) + tail
    );
    expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false);
    expect(structure.code).toEqual([]);
  }
});
