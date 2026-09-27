import { expect, test } from "bun:test";

import { undo } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { safeSourceEffects, switchEditorMode } from "./editor-mode";
import { liveDecorations, QuoteRuleWidget } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

function symbols(
  state: EditorState,
  visible = [{ from: 0, to: state.doc.length }]
) {
  const found: { from: number; to: number; kind: string; text: string }[] = [];
  liveDecorations(state, visible).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const { widget } = value.spec as { widget?: unknown };
      if (widget instanceof QuoteRuleWidget)
        found.push({
          from,
          to,
          kind: widget.kind,
          text: state.doc.sliceString(from, to),
        });
    }
  );
  return found;
}

test("quote prefixes and nested rules render only parsed symbols, active lines reveal source", () => {
  const raw =
    "outside\n\n> 中文 **bold**\n> > nested\n> continuation\nlazy\n\n> ---\n\n- item\n  > quote\n\n* * *\n\n___";
  const state = createRawEditorState(raw);
  const found = symbols(state);
  expect(found.filter((value) => value.kind === "quote")).toHaveLength(6);
  expect(
    found.filter((value) => value.kind === "rule").map((value) => value.text)
  ).toEqual(["---", "* * *", "___"]);
  expect(
    found
      .filter((value) => value.kind === "quote")
      .every((value) => /^>[ \t]?$/.test(value.text))
  ).toBe(true);
  expect(found.some((value) => state.doc.lineAt(value.from).number === 6)).toBe(
    false
  );
  const line = state.doc.line(4);
  const active = state.update({
    selection: EditorSelection.cursor(line.to),
  }).state;
  expect(
    symbols(active).filter(
      (value) => value.from >= line.from && value.to <= line.to
    )
  ).toEqual([]);
  const selected = state.update({
    selection: EditorSelection.range(0, state.doc.length),
  }).state;
  expect(symbols(selected)).toEqual([]);
  expect(selected.field(rawText)).toBe(raw);
});

test("Setext, escaped text, fenced/indented code and HTML remain outside quote/rule rendering", () => {
  for (const raw of [
    "title\n---",
    "title\n===",
    "\\> literal",
    "```\n> literal\n---\n```",
    "    > code\n    ---",
    "<script>\n> raw\n---\n</script>",
  ]) {
    expect(symbols(createRawEditorState(`outside\n\n${raw}`))).toEqual([]);
  }
  const state = createRawEditorState(
    "outside\n\n> ```js\n> > code\n> ---\n> ```"
  );
  // Only container prefixes hide; the second > in CodeText stays literal.
  expect(
    symbols(state).map((value) => [
      state.doc.lineAt(value.from).number,
      value.text,
    ])
  ).toEqual([
    [3, "> "],
    [4, "> "],
    [5, "> "],
    [6, "> "],
  ]);
});

test("long quotes visit only viewport nodes and deduplicate overlapping ranges", () => {
  const state = createRawEditorState(
    `outside\n\n${"> quote\n".repeat(10_000)}`
  );
  expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
  const viewport = {
    from: state.doc.line(5000).from,
    to: state.doc.line(5002).to,
  };
  const found = symbols(state, [viewport, viewport]);
  expect(found).toHaveLength(3);
  expect(found.map((value) => state.doc.lineAt(value.from).number)).toEqual([
    5000, 5001, 5002,
  ]);
});

test("BOM, mixed line endings, selection, history and source modes preserve raw", () => {
  const raw = "\uFEFF> 中文🙂\r\n> nested\n\r\n---";
  let state = createRawEditorState(raw);
  state = state.update({
    changes: { from: state.doc.line(2).to, insert: "!" },
    userEvent: "input.type",
  }).state;
  const originalDoc = state.doc,
    selection = state.selection,
    tree = syntaxTree(state);
  for (const effects of [switchEditorMode("source"), safeSourceEffects()]) {
    const switched = state.update({ effects }).state;
    expect(switched.doc).toBe(originalDoc);
    expect(switched.selection).toBe(selection);
    expect(switched.field(rawText)).toBe(raw.replace("nested", "nested!"));
    expect(
      switched
        .facet(EditorView.styleModule)
        .map((module) => module.getRules())
        .join("\n")
    ).not.toContain("cm-live-quote-symbol");
  }
  expect(syntaxTree(state)).toBe(tree);
  expect(
    undo({
      state,
      dispatch: (transaction: Transaction) => {
        state = transaction.state;
      },
    })
  ).toBe(true);
  expect(state.field(rawText)).toBe(raw);
});

test("widgets create only inert fixed spans and theme rules use application colors", () => {
  const attrs: Record<string, string> = {};
  const node = {
    className: "",
    setAttribute: (name: string, value: string) => {
      attrs[name] = value;
    },
  };
  const view = {
    dom: {
      ownerDocument: {
        createElement: (name: string) => {
          expect(name).toBe("span");
          return node;
        },
      },
    },
  } as unknown as EditorView;
  for (const kind of ["quote", "rule"] as const) {
    const widget = new QuoteRuleWidget(kind);
    expect(widget.toDOM(view) === (node as unknown as HTMLSpanElement)).toBe(
      true
    );
    expect(node.className).toBe(`cm-live-${kind}-symbol`);
    expect(attrs).toEqual({ "aria-hidden": "true" });
    expect(widget.ignoreEvent()).toBe(false);
    expect(widget.eq(new QuoteRuleWidget(kind))).toBe(true);
  }
  const css = createRawEditorState("")
    .facet(EditorView.styleModule)
    .map((module) => module.getRules())
    .join("\n");
  expect(css).toContain("var(--muted-foreground)");
  expect(css).toContain("cm-live-rule-line::after");
  expect(css).not.toContain("min(24em, 60%)");
});

test("quote structure spans lazy and blank lines with nesting and real paragraph edges", () => {
  const raw = "outside\n\n> first\nlazy\n>\n> second\n> > nested\n> tail";
  const state = createRawEditorState(raw);
  const lines: { line: number; className: string; style?: string }[] = [];
  liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
    0,
    state.doc.length,
    (from, to, value) => {
      const spec = value.spec as {
        class?: string;
        attributes?: { style?: string };
      };
      if (from === to && spec.class?.includes("cm-live-quote-line"))
        lines.push({
          line: state.doc.lineAt(from).number,
          className: spec.class,
          style: spec.attributes?.style,
        });
    }
  );
  expect(lines.map((value) => value.line)).toEqual([3, 4, 5, 6, 7, 8]);
  expect(lines.find((value) => value.line === 7)?.style).toBe(
    "--quote-depth: 2"
  );
  expect(lines.find((value) => value.line === 6)?.className).toContain(
    "paragraph-first"
  );
  const middle = state.doc.line(4);
  const classes: string[] = [];
  liveDecorations(state, [{ from: middle.from, to: middle.to }]).between(
    middle.from,
    middle.to,
    (_from, _to, value) => {
      const spec = value.spec as { class?: string };
      if (spec.class) classes.push(spec.class);
    }
  );
  expect(classes.join(" ")).not.toContain("cm-live-quote-first");
  expect(
    symbols(state)
      .filter((value) => value.kind === "quote")
      .every((value) => /^>\s?$/.test(value.text))
  ).toBe(true);
  expect(state.field(rawText)).toBe(raw);
});

test("long Setext inline children are not traversed by structural rendering", () => {
  const state = createRawEditorState("**x** ".repeat(3000) + "\n===");
  ensureSyntaxTree(state, state.doc.length, 1000);
  const parsed = state.update({}).state;
  const tree = syntaxTree(parsed);
  // Save the exact method for finally restoration; invoke with explicit receiver.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const original = tree.iterate;
  let visited = 0;
  tree.iterate = function (spec) {
    return original.call(this, {
      ...spec,
      enter(node) {
        visited++;
        return spec.enter(node);
      },
    });
  };
  try {
    liveDecorations(parsed, [{ from: 0, to: parsed.doc.line(1).to }]);
    expect(visited).toBeLessThanOrEqual(3);
  } finally {
    tree.iterate = original;
  }
});

test("rule lines carry list indent without counting quote prefixes twice", () => {
  for (const raw of [
    "- item\n\n  ---",
    "- item\n\n  > ---",
    "> - item\n>\n>   ---",
    "> > - item\n> >\n> >   ---",
  ]) {
    let state = createRawEditorState(`outside\n\n${raw}`);
    ensureSyntaxTree(state, state.doc.length, 1000);
    state = state.update({}).state;
    const styles: string[] = [];
    liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
      0,
      state.doc.length,
      (_from, _to, value) => {
        const spec = value.spec as {
          class?: string;
          attributes?: { style?: string };
        };
        if (spec.class === "cm-live-rule-line")
          styles.push(spec.attributes?.style ?? "");
      }
    );
    expect(styles).toEqual(["--list-indent: 2ch"]);
  }
});
