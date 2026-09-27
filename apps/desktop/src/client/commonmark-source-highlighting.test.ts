import { expect, test } from "bun:test";

import { undo, redo } from "@codemirror/commands";
import { highlightingFor, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import { highlightTree, tags, type Tag } from "@lezer/highlight";

import {
  safeSourceEffects,
  sourceHighlightStyle,
  switchEditorMode,
} from "./editor-mode";
import { createRawEditorState, rawText } from "./raw-buffer";

function colors(state: EditorState) {
  const result: { from: number; to: number; classes: string }[] = [];
  highlightTree(
    syntaxTree(state),
    { style: (nodeTags) => highlightingFor(state, nodeTags) },
    (from, to, classes) => {
      result.push({ from, to, classes });
    }
  );
  return result;
}

test("actual CommonMark nodes receive the missing source colors, not merely registered tags", () => {
  const fixtures: { text: string; node: string; token: string; tag: Tag }[] = [
    {
      text: "---",
      node: "HorizontalRule",
      token: "---",
      tag: tags.contentSeparator,
    },
    { text: "\\* literal", node: "Escape", token: "\\*", tag: tags.escape },
    { text: "A &amp; B", node: "Entity", token: "&amp;", tag: tags.character },
    {
      text: "```typescript\nx\n```",
      node: "CodeInfo",
      token: "typescript",
      tag: tags.labelName,
    },
    {
      text: "<!-- 中文 -->",
      node: "CommentBlock",
      token: "<!-- 中文 -->",
      tag: tags.comment,
    },
    {
      text: "text <!-- comment --> text",
      node: "Comment",
      token: "<!-- comment -->",
      tag: tags.comment,
    },
    {
      text: '[id]: local.md "标题"',
      node: "LinkLabel",
      token: "[id]",
      tag: tags.labelName,
    },
    {
      text: '[id]: local.md "标题"',
      node: "LinkTitle",
      token: '"标题"',
      tag: tags.string,
    },
    { text: "> 引用", node: "Blockquote", token: "引用", tag: tags.quote },
    { text: "- 列表", node: "BulletList", token: "列表", tag: tags.list },
    { text: "1. 列表", node: "OrderedList", token: "列表", tag: tags.list },
    { text: "正文🙂", node: "Paragraph", token: "正文🙂", tag: tags.content },
  ];
  for (const fixture of fixtures) {
    const state = createRawEditorState(fixture.text).update({
      effects: switchEditorMode("source"),
    }).state;
    let found = false;
    syntaxTree(state).iterate({
      enter(node) {
        if (node.name === fixture.node) found = true;
      },
    });
    expect(found).toBe(true);
    const expectedClass = highlightingFor(state, [fixture.tag]);
    expect(expectedClass).toBeTruthy();
    const from = state.doc.toString().indexOf(fixture.token),
      to = from + fixture.token.length;
    expect(
      colors(state).some(
        (range) =>
          range.from <= from &&
          range.to >= to &&
          range.classes.split(" ").includes(expectedClass!)
      )
    ).toBe(true);
  }
});

test("existing syntax, raw HTML and code remain source text; only source owns color mapping", () => {
  const raw =
    '# 标题\n\n**粗体** *斜体* `code` [链接](https://invalid.example "title")\n\n<div onclick="alert(1)">raw</div>\n\n```js\n<script>literal</script>\n```';
  const editing = createRawEditorState(raw);
  const source = editing.update({ effects: switchEditorMode("source") }).state;
  expect(colors(editing)).toEqual([]);
  expect(colors(source).length).toBeGreaterThan(0);
  expect(source.doc).toBe(editing.doc);
  expect(syntaxTree(source)).toBe(syntaxTree(editing));
  expect(source.field(rawText)).toBe(raw);
  const isolated = source.update({ effects: safeSourceEffects() }).state;
  expect(colors(isolated)).toEqual([]);
  expect(isolated.field(rawText)).toBe(raw);
  for (const spec of sourceHighlightStyle.specs) {
    expect(Object.keys(spec).sort()).toEqual(["color", "tag"]);
    expect(
      spec.color === "var(--foreground)" ||
        spec.color === "var(--muted-foreground)"
    ).toBe(true);
  }
});

test("new colors preserve BOM, mixed line endings, selection and undo across mode changes", () => {
  const raw = "\uFEFF---\r\n\n\\* &amp;\r\n```js\ncode\n```";
  let state = createRawEditorState(raw);
  state = state.update({
    changes: { from: state.doc.length, insert: "!" },
    selection: EditorSelection.range(1, 4),
    userEvent: "input.type",
  }).state;
  const document = state.doc,
    selection = state.selection,
    tree = syntaxTree(state);
  state = state.update({ effects: switchEditorMode("source") }).state;
  expect(state.doc).toBe(document);
  expect(state.selection).toBe(selection);
  expect(syntaxTree(state)).toBe(tree);
  expect(state.field(rawText)).toBe(raw + "!");
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  state = state.update({ effects: switchEditorMode("editing") }).state;
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw + "!");
  expect(colors(state)).toEqual([]);
});
