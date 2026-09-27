import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

test("split visible ranges retain nested styles under a shared ancestor", () => {
  const state = away("**one\n*two*\nthree**");
  const values: string[] = [];
  liveDecorations(state, [
    { from: 0, to: 5 },
    { from: 6, to: 11 },
  ]).between(0, state.doc.length, (_from, _to, decoration) => {
    const spec = decoration.spec as { class?: string };
    if (spec.class) values.push(spec.class);
  });
  expect(values.filter((value) => value === "cm-live-strong")).toHaveLength(1);
  expect(values.filter((value) => value === "cm-live-emphasis")).toHaveLength(
    1
  );
});

function decorations(state: EditorState, from = 0, to = state.doc.length) {
  const result: {
    from: number;
    to: number;
    className: string;
    hidden: boolean;
    text: string;
  }[] = [];
  liveDecorations(state, [{ from, to }]).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as { class?: string };
      result.push({
        from,
        to,
        className: spec.class ?? "",
        hidden: !spec.class,
        text: state.sliceDoc(from, to),
      });
    }
  );
  return result;
}
function away(text: string) {
  return createRawEditorState(text + "\n\nend").update({
    selection: { anchor: text.length + 5 },
  }).state;
}

test("inactive ATX headings hide opening separator whitespace without changing raw text", () => {
  for (let level = 1; level <= 6; level++) {
    for (const separator of [" ", "   ", " \t", " \t "]) {
      const prefix = "#".repeat(level);
      const source = `${prefix}${separator}标题 内部  空格 ${prefix}  `;
      const state = away(source);
      const hidden = decorations(state).filter((value) => value.hidden);
      expect(hidden.map((value) => value.text)).toEqual([
        prefix + separator,
        prefix,
      ]);
      let visible = source;
      for (const range of [...hidden].reverse())
        visible = visible.slice(0, range.from) + visible.slice(range.to);
      expect(visible).toBe("标题 内部  空格   ");
      expect(state.field(rawText)).toBe(source + "\n\nend");
    }
  }
});

test("heading marker hiding preserves leading indentation, BOM, empty headings and line boundaries", () => {
  for (const bom of ["", "\uFEFF"]) {
    for (const indent of ["", " ", "  ", "   "]) {
      for (const suffix of ["", "   ", " \t ", " \t 标题"]) {
        const source = `${bom}${indent}##${suffix}`;
        const state = away(source);
        const hidden = decorations(state).filter((value) => value.hidden);
        expect(hidden).toHaveLength(1);
        expect(hidden[0].from).toBe(bom.length + indent.length);
        expect(hidden[0].text).toBe("##" + (/^[ \t]*/.exec(suffix)?.[0] ?? ""));
        expect(hidden[0].text).not.toContain("\n");
        expect(state.field(rawText)).toBe(source + "\n\nend");
        for (const selection of [
          EditorSelection.cursor(0),
          EditorSelection.cursor(source.length),
          EditorSelection.range(source.length + 1, 0),
        ]) {
          const active = state.update({ selection }).state;
          expect(decorations(active).filter((value) => value.hidden)).toEqual(
            []
          );
          expect(active.field(rawText)).toBe(source + "\n\nend");
        }
      }
    }
  }
});

test("tab-only separators retain the existing parser's literal behavior", () => {
  for (const source of ["#\t标题", "##\t "]) {
    const state = away(source);
    expect(decorations(state)).toEqual([]);
    expect(state.field(rawText)).toBe(source + "\n\nend");
  }
});

test("ATX levels, optional closing markers and inline styles use actual CommonMark nodes", () => {
  for (let level = 1; level <= 6; level++) {
    const prefix = "#".repeat(level);
    const state = away(`${prefix} 中文 **bold** *斜体* \`code\` ${prefix}`);
    const values = decorations(state);
    expect(values.some((v) => v.className.includes(`cm-live-h${level}`))).toBe(
      true
    );
    expect(values.filter((v) => v.hidden).map((v) => v.text)).toEqual([
      prefix + " ",
      "**",
      "**",
      "*",
      "*",
      "`",
      "`",
      prefix,
    ]);
    expect(values.filter((v) => v.className).length).toBe(4);
  }
});
test("caret and both selection edges reveal enclosing spans, while untouched spans stay hidden", () => {
  const initial = away("**one** and *two*");
  for (const pos of [0, 2, 5, 7]) {
    const state = initial.update({ selection: { anchor: pos } }).state;
    expect(
      decorations(state)
        .filter((v) => v.hidden)
        .map((v) => v.text)
    ).toEqual(["*", "*"]);
  }
  for (const selection of [
    EditorSelection.range(8, 1),
    EditorSelection.range(1, 15),
  ]) {
    const state = initial.update({ selection }).state;
    expect(decorations(state).filter((v) => v.hidden).length).toBe(
      selection.to >= 15 ? 0 : 2
    );
  }
  const heading = away("  ## title ##");
  expect(
    decorations(heading.update({ selection: { anchor: 0 } }).state).filter(
      (v) => v.hidden
    )
  ).toEqual([]);
});
test("nested styles own direct markers, escapes and unmatched syntax stay raw", () => {
  const state = away("***nested*** \\*escaped\\* **unfinished");
  expect(
    decorations(state)
      .filter((v) => v.hidden)
      .map((v) => v.text)
      .join("")
  ).toBe("******");
  expect(
    decorations(state.update({ selection: { anchor: 5 } }).state).filter(
      (v) => v.hidden
    )
  ).toEqual([]);
});
test("fenced/indented code and HTML blocks do not render contained pseudo Markdown", () => {
  for (const text of [
    "```md\n# hi **x**\n```",
    "~~~\n# x *x*\n~~~",
    "    # x **x**",
    "<script>\n# x **x**\n</script>",
    "```\n# unclosed **code**",
  ]) {
    const state = away(text);
    expect(
      decorations(state).every(
        (value) =>
          (value.from === value.to &&
            (value.className.startsWith("cm-live-code-block") ||
              value.className === "cm-live-code-info")) ||
          /^(`{3,}|~{3,})$/.test(state.doc.sliceString(value.from, value.to)) ||
          (syntaxTree(state).resolveInner(value.from, 1).name === "CodeInfo" &&
            value.hidden)
      )
    ).toBe(true);
  }
});
test("multiline inline syntax only replaces single-line delimiters, raw HTML/links stay text", () => {
  const values = decorations(
    away("**first\nlast** and ``a\nb`` <img src=x> [link](https://example.com)")
  );
  expect(values.filter((v) => v.hidden).map((v) => v.text)).toEqual([
    "**",
    "**",
    "``",
    "``",
  ]);
  expect(values.some((v) => v.hidden && v.text.includes("\n"))).toBe(false);
});
test("visible ranges prune unrelated blocks and overlapping ranges do not duplicate decorations", () => {
  const state = away("# before\n\n**visible**\n\n# after");
  const start = state.doc.line(3).from,
    end = state.doc.line(3).to;
  const values = decorations(state, start, end);
  expect(values.filter((v) => v.className).map((v) => v.className)).toEqual([
    "cm-live-strong",
  ]);
  let count = 0;
  liveDecorations(state, [
    { from: start, to: end },
    { from: start + 1, to: end },
  ]).between(0, state.doc.length, () => {
    count++;
  });
  expect(count).toBe(values.length);
});
test("selection/formatting preserve raw bytes, history and syntax tree; edits reparse incrementally", () => {
  const original = "\uFEFF# title\r\n**中文😀**\n*italic*\rfinal";
  let state = createRawEditorState(original);
  const tree = syntaxTree(state);
  state = state.update({ selection: { anchor: 5 } }).state;
  decorations(state);
  expect(syntaxTree(state)).toBe(tree);
  expect(state.field(rawText)).toBe(original);
  const pos = state.doc.toString().indexOf("中文");
  state = state.update({
    changes: { from: pos, insert: "新" },
    userEvent: "input.type",
  }).state;
  expect(state.field(rawText)).toBe(original.replace("中文", "新中文"));
  expect(
    decorations(state).some((value) => value.className === "cm-live-strong")
  ).toBe(true);
  const dispatch = (tr: ReturnType<EditorState["update"]>) => {
    state = tr.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(original);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(original.replace("中文", "新中文"));
  expect(state.sliceDoc(pos, pos + 5)).toBe("新中文😀");
});
test("appearance uses app tokens and does not require replacing language/state", () => {
  const css = createRawEditorState("x")
    .facet(EditorView.styleModule)
    .map((module) => module.getRules())
    .join("\n");
  expect(css).toContain(".cm-live-h6");
  expect(css).toContain("var(--muted-foreground)");
  expect(css).toContain("var(--background)");
});

test("BOM is excluded from Markdown syntax without shifting document positions", () => {
  for (const prefix of ["", "   "]) {
    let state = away(`\uFEFF${prefix}# title\n\n**bold**`);
    expect(
      decorations(state).some((value) => value.className.includes("cm-live-h1"))
    ).toBe(true);
    expect(
      decorations(state)
        .filter((value) => value.hidden)
        .map((value) => value.text)
    ).toEqual(["# ", "**", "**"]);
    const pos = state.doc.toString().indexOf("bold");
    state = state.update({ changes: { from: pos, insert: "new " } }).state;
    expect(
      decorations(state).some((value) => value.className === "cm-live-strong")
    ).toBe(true);
    expect(
      decorations(state)
        .filter((value) => value.hidden)
        .map((value) => value.text)
    ).toEqual(["# ", "**", "**"]);
    expect(state.field(rawText).startsWith("\uFEFF")).toBe(true);
  }
  expect(() => createRawEditorState("\uFEFF")).not.toThrow();
});

test("BOM fragment reuse matches a fresh parse after distant edits and BOM removal/reinsertion", () => {
  let state = createRawEditorState(
    "\uFEFF# heading\n\n" + "**bold** and *em*\n\n".repeat(150)
  );
  const shape = (value: EditorState) => {
    const tree = ensureSyntaxTree(value, value.doc.length, 1000);
    expect(tree).not.toBeNull();
    const nodes: string[] = [];
    tree?.iterate({
      enter: (node) => {
        nodes.push(`${node.name}:${node.from}:${node.to}`);
      },
    });
    return nodes;
  };
  shape(state);
  for (const change of [
    { from: 1000, insert: "中文" },
    { from: 2000, to: 2002, insert: "`x`" },
    { from: 0, to: 1, insert: "" },
    { from: 0, insert: "\uFEFF" },
    { from: 2, insert: "##" },
  ]) {
    state = state.update({ changes: change }).state;
    expect(shape(state)).toEqual(
      shape(createRawEditorState(state.field(rawText)))
    );
  }
});
