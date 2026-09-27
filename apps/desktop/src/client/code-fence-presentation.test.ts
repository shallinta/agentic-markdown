import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

import { safeSourceEffects, switchEditorMode } from "./editor-mode";
import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

function decorated(
  state: EditorState,
  visible = [{ from: 0, to: state.doc.length }]
) {
  const results: { from: number; to: number; className: string }[] = [];
  liveDecorations(state, visible).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as { class?: string };
      results.push({ from, to, className: spec.class ?? "" });
    }
  );
  return results;
}

test("code fences and indented code retain line presentation without changing source", () => {
  for (const raw of [
    "\uFEFF```typescript\r\n# 标题 **粗体**\n- list\r\n```",
    "~~~js\n<script>alert(1)</script>\n~~~",
    "    # 中文🙂\n    - list",
    "```\n```",
    "```",
    "```md\nnot closed",
  ]) {
    const state = createRawEditorState(raw);
    const decos = decorated(state).filter((value) =>
      value.className.startsWith("cm-live-code-block")
    );
    expect(decos.length).toBeGreaterThan(0);
    expect(
      decos.every(
        (value) =>
          value.from === value.to &&
          value.className.startsWith("cm-live-code-block")
      )
    ).toBe(true);
    expect(decos[0].className).toContain("cm-live-code-block-first");
    expect(decos[decos.length - 1].className).toContain(
      "cm-live-code-block-last"
    );
    expect(state.field(rawText)).toBe(raw);
  }
});

test("code block boundaries belong to source lines, not viewport fragments", () => {
  const state = createRawEditorState("before\n\n```md\na\nb\nc\n```\n\nafter");
  const from = state.doc.line(5).from,
    to = state.doc.line(6).to;
  const values = decorated(state, [
    { from, to },
    { from: from + 1, to },
  ]);
  expect(
    values.map((value) => [
      state.doc.lineAt(value.from).number,
      value.className,
    ])
  ).toEqual([
    [5, "cm-live-code-block"],
    [6, "cm-live-code-block"],
  ]);
  const full = decorated(state).filter((value) =>
    value.className.startsWith("cm-live-code-block")
  );
  expect(full.map((value) => state.doc.lineAt(value.from).number)).toEqual([
    3, 4, 5, 6, 7,
  ]);
  expect(full[0].className).toContain("first");
  expect(full[full.length - 1].className).toContain("last");
});

test("HTML and inline code are not mistaken for blocks; list-contained code stays literal", () => {
  expect(
    decorated(createRawEditorState("<script>\n```\n- no\n</script>"))
  ).toEqual([]);
  expect(
    decorated(createRawEditorState("plain `code` text")).some((value) =>
      value.className.startsWith("cm-live-code-block")
    )
  ).toBe(false);
  const state = createRawEditorState(
    "- outer\n\n  ```\n  # code\n  - code\n  ```"
  );
  const inside = decorated(state).filter(
    (value) => value.from >= state.doc.line(3).from && value.from === value.to
  );
  expect(inside).toHaveLength(4);
  expect(
    inside.every(
      (value) =>
        value.from === value.to &&
        value.className.startsWith("cm-live-code-block")
    )
  ).toBe(true);
});

test("inactive parsed fences hide only symbols; any selection touching the block reveals both", () => {
  for (const block of [
    "```js\n# **literal**\n```",
    "~~~~lang\nbody\n~~~~~",
    "```\n```",
    "```",
    "~~~js\nnot closed",
    "> ```js\n> body\n> ```",
    "- item\n\n  ```js\n  body\n  ```",
  ]) {
    const raw = `before\n\n${block}`;
    const initial = createRawEditorState(raw);
    let from = 0,
      to = 0;
    const markers: { from: number; to: number; className: string }[] = [];
    syntaxTree(initial).iterate({
      enter(ref) {
        if (ref.name === "FencedCode") {
          from = ref.from;
          to = ref.to;
        }
        if (ref.name === "CodeMark")
          markers.push({ from: ref.from, to: ref.to, className: "" });
      },
    });
    expect(markers.length).toBeGreaterThan(0);
    const replacements = (state: EditorState) =>
      decorated(state, [
        { from: 0, to: state.doc.length },
        { from: 0, to: state.doc.length },
      ]).filter(
        (value) =>
          value.from !== value.to &&
          value.className === "" &&
          /^(`{3,}|~{3,})$/.test(state.doc.sliceString(value.from, value.to))
      );
    expect(replacements(initial)).toEqual(markers);
    for (const marker of markers)
      expect(initial.doc.sliceString(marker.from, marker.to)).toMatch(
        /^(`{3,}|~{3,})$/
      );
    for (const selection of [
      EditorSelection.cursor(from),
      EditorSelection.cursor(to),
      EditorSelection.range(0, to),
      EditorSelection.range(from + 1, to),
    ]) {
      const active = initial.update({ selection }).state;
      expect(replacements(active)).toEqual([]);
      expect(active.field(rawText)).toBe(raw);
    }
    expect(initial.field(rawText)).toBe(raw);
  }
});

test("BOM, multiple selections, viewport clipping and source/safe source keep fence boundaries", () => {
  const raw = "\uFEFF````js\r\nbody\n````\r\n\noutside\n\n~~~\nbody\n~~~";
  let state = createRawEditorState(
    raw,
    EditorState.allowMultipleSelections.of(true)
  );
  const outside = state.doc.line(5).from;
  state = state.update({ selection: EditorSelection.cursor(outside) }).state;
  const hidden = decorated(state).filter((value) => value.from !== value.to);
  expect(
    hidden.map((value) => state.doc.sliceString(value.from, value.to))
  ).toEqual(["````", "js", "````", "~~~", "~~~"]);
  expect(hidden[0].from).toBe(1);
  expect(
    decorated(state, [
      { from: state.doc.line(2).from, to: state.doc.line(2).to },
    ]).every((value) => value.from === value.to)
  ).toBe(true);
  // A cross-block selection reveals both blocks, including opening/closing edges.
  const selected = state.update({
    selection: EditorSelection.range(2, state.doc.length - 1),
  }).state;
  expect(
    decorated(selected).filter((value) => value.from !== value.to)
  ).toEqual([]);
  const multiple = state.update({
    selection: EditorSelection.create(
      [
        EditorSelection.cursor(2),
        EditorSelection.cursor(outside),
        EditorSelection.cursor(state.doc.length - 1),
      ],
      1
    ),
  }).state;
  expect(multiple.selection.ranges).toHaveLength(3);
  expect(
    decorated(multiple).filter((value) => value.from !== value.to)
  ).toEqual([]);
  const doc = state.doc,
    selection = state.selection;
  for (const effects of [switchEditorMode("source"), safeSourceEffects()]) {
    const switched = state.update({ effects }).state;
    expect(switched.doc).toBe(doc);
    expect(switched.selection).toBe(selection);
    expect(switched.field(rawText)).toBe(raw);
    expect(
      switched
        .facet(EditorView.styleModule)
        .map((module) => module.getRules())
        .join("\n")
    ).not.toContain("cm-live-code-block");
  }
});

test("long quoted fences inspect only child edges, not offscreen code siblings", () => {
  const state = createRawEditorState(
    `outside\n\n> ~~~js\n${"> literal\n".repeat(10_000)}> ~~~`
  );
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  expect(tree).not.toBeNull();
  let block: SyntaxNode | null = null;
  tree!.iterate({
    enter(ref) {
      if (ref.name === "FencedCode") {
        block = ref.node;
        return false;
      }
    },
  });
  const fence = block as SyntaxNode | null;
  expect(fence?.firstChild?.name).toBe("CodeMark");
  expect(fence?.lastChild?.name).toBe("CodeMark");
  // Instrument the real node accessor: a viewport decoration pass must not
  // traverse thousands of QuoteMark/CodeText siblings, regardless of timing.
  let prototype = Object.getPrototypeOf(fence!.firstChild) as object;
  while (!Object.getOwnPropertyDescriptor(prototype, "nextSibling"))
    prototype = Object.getPrototypeOf(prototype) as object;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "nextSibling")!;
  let visits = 0;
  Object.defineProperty(prototype, "nextSibling", {
    ...descriptor,
    get() {
      visits++;
      return descriptor.get!.call(this) as unknown;
    },
  });
  try {
    const middle = decorated(state, [
      { from: state.doc.line(5000).from, to: state.doc.line(5002).to },
    ]);
    expect(
      middle.filter((value) => value.className === "cm-live-code-block")
    ).toHaveLength(3);
    expect(
      middle
        .filter((value) => value.from !== value.to)
        .map((value) => state.doc.sliceString(value.from, value.to))
    ).toEqual(["> ", "> ", "> "]);
    const opening = decorated(state, [
      { from: state.doc.line(3).from, to: state.doc.line(3).to },
    ]);
    expect(
      opening
        .filter(
          (value) =>
            value.from !== value.to &&
            value.from >= fence!.from &&
            !/^>\s?$/.test(state.doc.sliceString(value.from, value.to))
        )
        .map((value) => state.doc.sliceString(value.from, value.to))
    ).toEqual(["~~~", "js"]);
    expect(visits).toBeLessThanOrEqual(1);
  } finally {
    Object.defineProperty(prototype, "nextSibling", descriptor);
  }
});

test("inactive info becomes a bounded upper-right label, active info returns verbatim", () => {
  const raw =
    'outside\n\n> ```typescript title="<img src=x onerror=alert(1)>"\n> code\n> ```';
  const state = createRawEditorState(raw);
  const infos: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter(ref) {
      if (ref.name === "CodeInfo") infos.push({ from: ref.from, to: ref.to });
    },
  });
  const values: { from: number; to: number; label?: string }[] = [];
  liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as { attributes?: Record<string, string> };
      values.push({
        from,
        to,
        label: spec.attributes?.["data-code-language"],
      });
    }
  );
  expect(
    values.some(
      (value) => value.from === infos[0].from && value.to === infos[0].to
    )
  ).toBe(true);
  expect(
    values.filter((value) => value.label).map((value) => value.label)
  ).toEqual(["typescript"]);
  const active = state.update({
    selection: EditorSelection.cursor(state.doc.line(4).from),
  }).state;
  expect(
    decorated(active).filter(
      (value) =>
        value.from !== value.to &&
        value.from >= raw.indexOf("```") &&
        !/^>\s?$/.test(state.doc.sliceString(value.from, value.to))
    )
  ).toEqual([]);
  expect(state.field(rawText)).toBe(raw);
  expect(active.field(rawText)).toBe(raw);
});

test("language labels are inert bounded attributes with no empty badge or metadata leak", () => {
  for (const info of [
    "",
    "js title=secret",
    '<img/onerror="oops"> trailing',
    "x".repeat(100_000),
    "\u202ejavascript",
  ]) {
    const state = createRawEditorState(`outside\n\n~~~${info}\ncode\n~~~`);
    ensureSyntaxTree(state, state.doc.length, 1000);
    const labels: string[] = [];
    const ranges = [
      { from: 0, to: state.doc.length },
      { from: 0, to: state.doc.length },
    ];
    liveDecorations(state, ranges).between(
      0,
      state.doc.length,
      (_from, _to, value) => {
        const { attributes } = value.spec as {
          attributes?: Record<string, string>;
        };
        if (attributes?.["data-code-language"]) {
          expect(Object.keys(attributes)).toEqual(["data-code-language"]);
          labels.push(attributes["data-code-language"]);
        }
      }
    );
    // F-018c leaves an overlong physical opening line entirely literal.
    const hasLabel = !!info && info.length < 10_000;
    expect(labels).toHaveLength(hasLabel ? 1 : 0);
    if (hasLabel) {
      expect(labels[0].length).toBeLessThanOrEqual(41);
      expect(labels[0]).not.toContain("trailing");
      expect(labels[0]).not.toContain("secret");
      expect(labels[0]).not.toContain("\u202e");
    }
    if (info.startsWith("<")) expect(labels[0]).toBe('<img/onerror="oops">');
    expect(state.field(rawText)).toBe(`outside\n\n~~~${info}\ncode\n~~~`);
  }
  const state = createRawEditorState("outside\n\n```js\ncode\n```");
  const css = state
    .facet(EditorView.styleModule)
    .map((module) => module.getRules())
    .join("\n");
  expect(css).toContain("attr(data-code-language)");
  expect(css).toContain("font-size: 0.75em");
  expect(css).toContain("var(--muted-foreground)");
  expect(css).toContain("text-overflow: ellipsis");
  expect(css).toContain("max-width: min(40%, 24ch)");
});

test("source mode drops block styling while raw, selection, parser and history remain shared", () => {
  const raw = "\uFEFF```md\r\n中文🙂\n```";
  let state = createRawEditorState(raw);
  state = state.update({
    changes: { from: state.doc.line(2).to, insert: "!" },
    userEvent: "input.type",
    selection: EditorSelection.range(1, 4),
  }).state;
  const tree = syntaxTree(state),
    doc = state.doc,
    selection = state.selection;
  const editingCSS = state
    .facet(EditorView.styleModule)
    .map((module) => module.getRules())
    .join("\n");
  expect(editingCSS).toContain("cm-live-code-block");
  expect(editingCSS).toContain("var(--border)");
  state = state.update({ effects: switchEditorMode("source") }).state;
  expect(
    state
      .facet(EditorView.styleModule)
      .map((module) => module.getRules())
      .join("\n")
  ).not.toContain("cm-live-code-block");
  expect(state.doc).toBe(doc);
  expect(state.selection).toBe(selection);
  expect(syntaxTree(state)).toBe(tree);
  expect(state.field(rawText)).toBe(raw.replace("中文🙂", "中文🙂!"));
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw.replace("中文🙂", "中文🙂!"));
});
