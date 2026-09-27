import { expect, test } from "bun:test";

import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { switchEditorMode } from "./editor-mode";
import { ListBullet, liveDecorations } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

function away(text: string, tabSize = 4) {
  const state = createRawEditorState(
    text + "\n\nend",
    EditorState.tabSize.of(tabSize)
  );
  return state.update({ selection: { anchor: state.doc.length } }).state;
}
function values(
  state: EditorState,
  visible = [{ from: 0, to: state.doc.length }]
) {
  interface Spec {
    class?: string;
    widget?: unknown;
    attributes?: { style?: string };
  }
  const result: {
    from: number;
    to: number;
    text: string;
    spec: Spec;
  }[] = [];
  liveDecorations(state, visible).between(
    0,
    state.doc.length,
    (from, to, value) => {
      result.push({
        from,
        to,
        text: state.sliceDoc(from, to),
        spec: value.spec as Spec,
      });
    }
  );
  return result;
}

test("unordered markers become fixed bullets, ordered numbering and raw text stay original", () => {
  const source =
    "\uFEFF- 中文 **粗体**\r\n+ 加号\n* 星号\n\n3. third\n8. eighth\n\n7) seventh";
  const state = away(source);
  const decos = values(state);
  expect(
    decos.filter((v) => v.spec.widget instanceof ListBullet).map((v) => v.text)
  ).toEqual(["-", "+", "*"]);
  expect(
    decos.filter((v) => v.spec.class === "cm-live-marker").map((v) => v.text)
  ).toEqual(["3.", "8.", "7)"]);
  expect(state.field(rawText)).toBe(source + "\n\nend");
  expect(state.sliceDoc(0, state.doc.length)).toContain("3. third\n8. eighth");
});

test("caret and selection touching the marker's physical line restore original markers", () => {
  const source = "- one\n- two";
  const initial = away(source);
  for (const selection of [
    EditorSelection.cursor(0),
    EditorSelection.cursor(5),
    EditorSelection.range(2, 4),
  ]) {
    const state = initial.update({ selection }).state;
    expect(
      values(state)
        .filter((v) => v.spec.widget instanceof ListBullet)
        .map((v) => v.from)
    ).toEqual([6]);
    expect(state.field(rawText)).toBe(source + "\n\nend");
  }
  const selected = initial.update({
    selection: EditorSelection.range(0, source.length),
  }).state;
  expect(
    values(selected).filter((v) => v.spec.widget instanceof ListBullet)
  ).toEqual([]);
  expect(
    selected.sliceDoc(selected.selection.main.from, selected.selection.main.to)
  ).toBe(source);
});

test("nested rows, visual wrapping and physical continuations retain source indentation", () => {
  const source =
    "- parent\n  - child\n    1. numbered\n       continued\n\n- item\n  physical\nlazy";
  const state = away(source);
  const rows = values(state).filter(
    (v) => v.spec.class === "cm-live-list-line"
  );
  expect(
    rows.map((v) => [state.doc.lineAt(v.from).number, v.spec.attributes?.style])
  ).toEqual([
    [1, "--list-indent: 2ch"],
    [2, "--list-indent: 4ch"],
    [3, "--list-indent: 7ch"],
    [4, "--list-indent: 7ch"],
    [6, "--list-indent: 2ch"],
    [7, "--list-indent: 2ch"],
    [8, "--list-indent: 0ch"],
  ]);
  expect(
    values(away("-\t正文", 8)).find((v) => v.spec.class === "cm-live-list-line")
      ?.spec.attributes?.style
  ).toBe("--list-indent: 8ch");
  expect(state.field(rawText)).toBe(source + "\n\nend");
});

test("visible-range traversal neither duplicates list rows nor loses nested or later paragraph rows", () => {
  const state = away("- parent\n  - child\n    continuation\n- last");
  const start = state.doc.line(2).from,
    end = state.doc.line(3).to;
  const decos = values(state, [
    { from: start, to: end },
    { from: start + 2, to: end },
  ]);
  expect(
    decos.filter((v) => v.spec.class === "cm-live-list-line").map((v) => v.from)
  ).toEqual([start, state.doc.line(3).from]);
  expect(decos.filter((v) => v.spec.widget instanceof ListBullet)).toHaveLength(
    1
  );
});

test("code, HTML, escaped pseudo lists stay raw; task text has no interactive checkbox", () => {
  for (const source of [
    "```\n- code\n1. code\n```",
    "    - code",
    "<script>\n- code\n</script>",
    "\\- escaped",
    "1.no space",
  ]) {
    expect(
      values(away(source)).filter(
        (v) =>
          v.spec.widget instanceof ListBullet ||
          v.spec.class === "cm-live-list-line"
      )
    ).toEqual([]);
  }
  const task = away("- [ ] literal");
  expect(
    values(task).filter((v) => v.spec.widget instanceof ListBullet)
  ).toHaveLength(1);
  expect(task.field(rawText)).toContain("[ ] literal");
});

test("source mode drops list styles while preserving same document and raw markers", () => {
  const editing = away("- one\n  3. nested");
  const source = editing.update({ effects: switchEditorMode("source") }).state;
  const css = (state: EditorState) =>
    state
      .facet(EditorView.styleModule)
      .map((module) => module.getRules())
      .join("\n");
  expect(css(editing)).toContain("cm-live-list-line");
  expect(css(editing)).toContain("calc(6px + var(--list-indent))");
  expect(css(source)).not.toContain("cm-live-list-line");
  expect(css(source)).not.toContain("cm-live-list-bullet");
  expect(source.doc).toBe(editing.doc);
  expect(source.field(rawText)).toBe(editing.field(rawText));
  expect(new ListBullet().eq()).toBe(true);
  expect(new ListBullet().ignoreEvent()).toBe(false);
});

test("bullet widget builds only a fixed inert span and lets the editor handle clicks", () => {
  const attributes: Record<string, string> = {};
  const element = {
    className: "",
    textContent: "",
    setAttribute: (name: string, value: string) => {
      attributes[name] = value;
    },
  };
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
  const widget = new ListBullet();
  expect(widget.toDOM(view) === element).toBe(true);
  expect(element.textContent).toBe("•");
  expect(element.className).toBe("cm-live-list-bullet");
  expect(attributes).toEqual({ "aria-hidden": "true" });
  expect(widget.ignoreEvent()).toBe(false);
});
