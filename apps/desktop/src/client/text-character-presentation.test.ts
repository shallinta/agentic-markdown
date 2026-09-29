import { expect, test } from "bun:test";

import { redo, undo } from "@codemirror/commands";
import type { Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { characterEntities } from "character-entities";

import { liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";
import {
  decodeTextCharacter,
  displayTextCharacter,
  TextCharacterWidget,
} from "./text-character-presentation";

function widgets(
  text: string,
  position = text.length + 5,
  from = 0,
  to = text.length
) {
  const state = createRawEditorState(text + "\n\nend").update({
    selection: { anchor: position },
  }).state;
  const values: string[] = [];
  liveDecorations(state, [{ from, to }]).between(
    0,
    state.doc.length,
    (_from, _to, value) => {
      const spec = value.spec as { widget?: unknown };
      if (spec.widget instanceof TextCharacterWidget)
        values.push(spec.widget.text);
    }
  );
  return values;
}

test("complete named table is case-sensitive and unknown or malformed references stay raw", () => {
  for (const [name, value] of Object.entries(characterEntities))
    expect(decodeTextCharacter("Entity", `&${name};`)).toBe(value);
  for (const bad of [
    "&bad;",
    "&constructor;",
    "&AMP",
    "&Amp;",
    "&#;",
    "&#x;",
    "&#12345678;",
    "&#x1234567;",
    "&#65",
    "&amp;tail",
  ])
    expect(decodeTextCharacter("Entity", bad)).toBeNull();
  expect(decodeTextCharacter("Entity", "&NotEqualTilde;")).toBe("≂̸");
});

test("numeric references follow CommonMark code points, never HTML C1 remapping", () => {
  for (const source of [
    "&#0;",
    "&#xD800;",
    "&#xDFFF;",
    "&#1114112;",
    "&#xFFFFFF;",
  ])
    expect(decodeTextCharacter("Entity", source)).toBe("�");
  expect(decodeTextCharacter("Entity", "&#128;")).toBe("\u0080");
  expect(decodeTextCharacter("Entity", "&#X1F600;")).toBe("😀");
  expect(decodeTextCharacter("Entity", "&#0000065;")).toBe("A");
  expect(decodeTextCharacter("Escape", "\\*")).toBe("*");
  expect(decodeTextCharacter("Escape", "\\a")).toBeNull();
});

test("display filter rejects any whitespace, control or default-ignorable result", () => {
  for (const source of [
    "&#32;",
    "&nbsp;",
    "&Tab;",
    "&NewLine;",
    "&#128;",
    "&#x2028;",
    "&#x202E;",
    "&#x200B;",
    "&#x034F;",
    "&caps;",
  ])
    expect(displayTextCharacter("Entity", source)).toBeNull();
  expect(displayTextCharacter("Entity", "&NotEqualTilde;")).toBe("≂̸");
  expect(displayTextCharacter("Entity", "&#0;")).toBe("�");
});

test("text widgets are inert spans using textContent and allow editor pointer handling", () => {
  const element = { className: "", textContent: "" };
  const view = {
    dom: {
      ownerDocument: {
        createElement: (tag: string) => {
          expect(tag).toBe("span");
          return element;
        },
      },
    },
  } as unknown as EditorView;
  const widget = new TextCharacterWidget("<script>");
  expect(Object.is(widget.toDOM(view), element)).toBe(true);
  expect(element.textContent).toBe("<script>");
  expect(Object.keys(element).sort()).toEqual(["className", "textContent"]);
  expect(widget.ignoreEvent()).toBe(false);
  expect(widget.eq(new TextCharacterWidget("<script>"))).toBe(true);
});

test("visible escapes/entities render but excluded contexts and protected lines do not", () => {
  expect(widgets("&amp;lt;")).toEqual(["&"]);
  expect(decodeTextCharacter("Entity", "&__proto__;")).toBeNull();
  expect(decodeTextCharacter("Entity", "&" + "a".repeat(100) + ";")).toBeNull();
  expect(
    widgets("\\* &amp; &#65; &#x1F600; &NotEqualTilde; &bad; &nbsp;")
  ).toEqual(["*", "&", "A", "😀", "≂̸"]);
  for (const text of [
    "`&amp;`",
    "```\n&amp;\n```",
    "<div>\n&amp;\n</div>",
    '<span title="&amp;">',
    '[plain](url&amp; "&amp;")',
    "[&amp;][ref]\n\n[ref]: /url",
    "![&amp;](img)",
    "[![&amp;](img)](url)",
  ])
    expect(widgets(text)).toEqual([]);
  expect(widgets("[&amp;](target)")).toEqual(["&"]);
  expect(widgets("x".repeat(10000) + " &amp;")).toEqual([]);
  expect(widgets("&amp;\n\n&copy;", undefined, 8, 13)).toEqual(["©"]);
});

test("inclusive source, whole link and Setext touch restore original characters", () => {
  for (const text of ["&amp;", "[&amp;](url)", "&amp; \\*\n==="]) {
    for (let position = 0; position <= text.length; position++)
      expect(widgets(text, position)).toEqual([]);
  }
});

test("presentation never mutates BOM, mixed endings, selections or history", () => {
  const raw = "\uFEFF&amp;\r\n\\*\nend";
  let state = createRawEditorState(raw);
  state = state.update({
    changes: { from: 1, to: 6, insert: "&#65;" },
    selection: { anchor: 6 },
  }).state;
  liveDecorations(state, [{ from: 0, to: state.doc.length }]);
  expect(state.field(rawText)).toBe(raw.replace("&amp;", "&#65;"));
  expect(state.selection.main.head).toBe(6);
  const dispatch = (transaction: Transaction) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw.replace("&amp;", "&#65;"));
});
