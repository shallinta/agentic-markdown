import { expect, test } from "bun:test";

import { isolateHistory, redo, undo, undoDepth } from "@codemirror/commands";
import {
  ensureSyntaxTree,
  syntaxTree,
  syntaxTreeAvailable,
} from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { switchEditorMode } from "./editor-mode";
import { planListIndentation } from "./list-indentation";
import { longLineProtection } from "./long-line-protection";
import { markdownGrammar } from "./markdown-grammar";
import { createRawEditorState, editorText, rawText } from "./raw-buffer";
import { planSourceIndentation } from "./source-indentation";
import { paragraphTaskPrefix, paragraphTaskPrefixIn } from "./task-marker";

interface Case {
  name: string;
  raw: string;
  targets: string[];
  more: boolean;
  output?: string;
  parents?: (number | null)[];
  reject?: boolean;
  reverse?: boolean;
  editing?: boolean;
}
const cases: Case[] = [
  {
    name: "plain-parent",
    raw: "- A\n- [x] B",
    targets: ["B"],
    more: true,
    output: "- A\n  - [x] B",
    parents: [null, 0],
  },
  {
    name: "task-parent",
    raw: "- [X] A\n- B\n  - [ ] b",
    targets: ["B", "b"],
    more: true,
    output: "- [X] A\n  - B\n    - [ ] b",
    parents: [null, 0, 1],
  },
  {
    name: "user-b",
    raw: "- [ ] A\n  - [X] B\n    - [x] b\n  - [ ] C\n    - [X] c",
    targets: ["B"],
    more: false,
    output: "- [ ] A\n- [X] B\n  - [x] b\n  - [ ] C\n    - [X] c",
    parents: [null, null, 1, 1, 3],
  },
  {
    name: "consecutive",
    raw: "- [ ] A\n- [x] B\n- [X] C",
    targets: ["B", "C"],
    more: true,
    output: "- [ ] A\n  - [x] B\n  - [X] C",
    parents: [null, 0, 0],
  },
  {
    name: "ordered",
    raw: "1. [ ] A\n10. [X] B",
    targets: ["B"],
    more: true,
    output: "1. [ ] A\n\n   10. [X] B",
    parents: [null, 0],
  },
  {
    name: "empty",
    raw: "- A\n- [ ] ",
    targets: ["[ ]"],
    more: true,
    output: "- A\n  - [ ] ",
    parents: [null, 0],
  },
  {
    name: "newline-body",
    raw: "- A\n- [x]\n  B",
    targets: ["[x]"],
    more: true,
    output: "- A\n  - [x]\n    B",
    parents: [null, 0],
  },
  {
    name: "later-paragraph",
    raw: "- A\n- B\n\n  [x] later",
    targets: ["B"],
    more: true,
    output: "- A\n  - B\n\n    [x] later",
    parents: [null, 0],
  },
  {
    name: "code-link",
    raw: "- A\n- [x] [B](https://example.com)\n\n  ```js\n  x\n  ```",
    targets: ["[B]"],
    more: true,
    output:
      "- A\n  - [x] [B](https://example.com)\n\n    ```js\n    x\n    ```",
    parents: [null, 0],
  },
  {
    name: "bom-eol",
    raw: "\ufeff- A\r\n- [X] B\n  - [ ] b",
    targets: ["B"],
    more: true,
    output: "\ufeff- A\r\n  - [X] B\n    - [ ] b",
    parents: [null, 0, 1],
    reverse: true,
  },
  {
    name: "editing",
    raw: "- A\n- [x] B",
    targets: ["B"],
    more: true,
    output: "- A\n  - [x] B",
    parents: [null, 0],
    editing: true,
  },
  {
    name: "first-noop",
    raw: "- [x] A\n- B",
    targets: ["A"],
    more: true,
    output: "- [x] A\n- B",
    parents: [null, null],
  },
  {
    name: "top-noop",
    raw: "- [x] A",
    targets: ["A"],
    more: false,
    output: "- [x] A",
    parents: [null],
  },
  {
    name: "mixed",
    raw: "- A\n- [x] B\n\nPLAIN",
    targets: ["B", "PLAIN"],
    more: true,
    reject: true,
  },
  {
    name: "tab-prefix",
    raw: "- A\n\t- [x] B",
    targets: ["B"],
    more: false,
    reject: true,
  },
  {
    name: "ordinary",
    raw: "- A\n  - B\n    - b\n  - C\n    - c",
    targets: ["B"],
    more: false,
    output: "- A\n- B\n  - b\n  - C\n    - c",
    parents: [null, null, 1, 1, 3],
  },
];
type Node =
  | ReturnType<typeof parseCanonicalMarkdown>
  | ReturnType<typeof parseCanonicalMarkdown>["children"][number];
function items(raw: string) {
  const result: {
    from: number;
    parent: number | null;
    checked: boolean | null;
    body: string;
  }[] = [];
  function visit(node: Node, parent: number | null) {
    if (node.type === "listItem") {
      const index = result.length;
      result.push({
        from: node.position!.start.offset!,
        parent,
        checked: node.checked ?? null,
        body: JSON.stringify(
          node.children.filter((c) => c.type !== "list"),
          (key, value: unknown) =>
            key === "position" || key === "spread" ? undefined : value
        ),
      });
      parent = index;
    }
    if ("children" in node)
      for (const child of node.children) visit(child, parent);
  }
  visit(parseCanonicalMarkdown(raw), null);
  return result;
}
function prepare(c: Case) {
  let state = createRawEditorState(c.raw);
  if (!c.editing)
    state = state.update({ effects: switchEditorMode("source") }).state;
  const logical = editorText(c.raw);
  state = state.update({
    selection: EditorSelection.create(
      c.targets.map((target) => {
        const pos = logical.indexOf(target);
        expect(pos).toBeGreaterThanOrEqual(0);
        return c.reverse
          ? EditorSelection.range(pos + target.length, pos)
          : EditorSelection.cursor(pos + target.length);
      }),
      c.targets.length - 1
    ),
  }).state;
  expect(ensureSyntaxTree(state, state.doc.length, 1000)).not.toBeNull();
  return state.update({}).state;
}
function apply(state: EditorState, more: boolean) {
  const plan = planSourceIndentation(state, more);
  expect(plan.reason).toBeUndefined();
  return state.update({
    changes: plan.changes,
    annotations: isolateHistory.of("full"),
  });
}
for (const c of cases)
  test("task structure: " + c.name, () => {
    const before = prepare(c),
      plan = planSourceIndentation(before, c.more);
    if (c.reject) {
      expect(plan.reason).toBeDefined();
      expect(before.field(rawText)).toBe(c.raw);
      expect(undoDepth(before)).toBe(0);
      return;
    }
    const tx = apply(before, c.more);
    let current = tx.state;
    const output = current.field(rawText),
      old = items(c.raw),
      next = items(output);
    if (c.output === undefined || c.parents === undefined)
      throw new Error("Successful fixture requires exact raw and parents");
    expect(output).toBe(c.output);
    expect(next.map((x) => x.parent)).toEqual(c.parents);
    expect(next.length).toBe(old.length);
    old.forEach((item, i) => {
      expect(editorText(output.slice(0, next[i].from)).length).toBe(
        tx.changes.mapPos(editorText(c.raw.slice(0, item.from)).length, 1)
      );
      expect(next[i].checked).toBe(item.checked);
      expect(next[i].body).toBe(item.body);
    });
    expect(current.selection.eq(before.selection.map(tx.changes))).toBe(true);
    expect(current.selection.mainIndex).toBe(before.selection.mainIndex);
    const completed = current,
      target = {
        get state() {
          return current;
        },
        dispatch(t: typeof tx) {
          current = t.state;
        },
      };
    if (tx.docChanged) {
      expect(undoDepth(current)).toBe(1);
      expect(undo(target)).toBe(true);
      expect(current.field(rawText)).toBe(c.raw);
      expect(current.selection.eq(before.selection)).toBe(true);
      expect(redo(target)).toBe(true);
      expect(current.field(rawText)).toBe(output);
      expect(current.selection.eq(completed.selection)).toBe(true);
    } else expect(undoDepth(current)).toBe(0);
  });
test("typed prefix binds a local tree to next Text and leaves the state wrapper compatible", () => {
  const raw = "INTRO\n\n- [X] B\n\n  [ ] later",
    state = prepare({ name: "helper", raw, targets: ["B"], more: false });
  let paragraph = syntaxTree(state).resolveInner(raw.indexOf("B"), -1);
  while (paragraph.name !== "Paragraph" && paragraph.parent)
    paragraph = paragraph.parent;
  expect(paragraphTaskPrefix(state, paragraph)).toEqual({
    from: 9,
    to: 12,
    checked: true,
  });
  const local = markdownGrammar.parse(state.doc.sliceString(7));
  const first = local.topNode
    .getChild("BulletList")!
    .getChild("ListItem")!
    .getChild("Paragraph");
  expect(paragraphTaskPrefixIn(state.doc, first, 7)).toEqual(
    paragraphTaskPrefix(state, paragraph)
  );
  const empty = prepare({
    name: "empty",
    raw: "- [ ] ",
    targets: ["[ ]"],
    more: false,
  });
  const p = syntaxTree(empty)
    .topNode.getChild("BulletList")!
    .getChild("ListItem")!
    .getChild("Paragraph");
  expect(paragraphTaskPrefix(empty, p)).toEqual({
    from: 2,
    to: 5,
    checked: false,
  });
  expect(items("- [ ] ")[0].checked).toBeNull();
});
test("independent task windows validate all items and preserve primary reverse selection", () => {
  const raw = "- A\n- [X] B\n\np1\n\np2\n\np3\n\n- C\n- [ ] D";
  const before = prepare({
    name: "windows",
    raw,
    targets: ["B", "D"],
    reverse: true,
    more: true,
  });
  const tx = apply(before, true);
  expect(tx.state.field(rawText)).toBe(
    "- A\n  - [X] B\n\np1\n\np2\n\np3\n\n- C\n  - [ ] D"
  );
  expect(
    items(tx.state.field(rawText)).map((x) => [x.parent, x.checked])
  ).toEqual([
    [null, null],
    [0, true],
    [null, null],
    [2, false],
  ]);
  expect(tx.state.selection.eq(before.selection.map(tx.changes))).toBe(true);
  expect(tx.state.selection.mainIndex).toBe(1);
});
test("task indentation remains one history event between ordinary input events", () => {
  let current = prepare({
    name: "history",
    raw: "- A\n- [x] B",
    targets: ["B"],
    more: true,
  });
  current = current.update({
    changes: { from: current.doc.length, insert: "!" },
    selection: EditorSelection.cursor(current.doc.length + 1),
    userEvent: "input.type",
  }).state;
  const first = current.field(rawText);
  current = apply(current, true).state;
  const indented = current.field(rawText);
  current = current.update({
    changes: { from: current.doc.length, insert: "?" },
    selection: EditorSelection.cursor(current.doc.length + 1),
    userEvent: "input.type",
  }).state;
  const target = {
    get state() {
      return current;
    },
    dispatch(tx: ReturnType<EditorState["update"]>) {
      current = tx.state;
    },
  };
  expect(undo(target)).toBe(true);
  expect(current.field(rawText)).toBe(indented);
  expect(undo(target)).toBe(true);
  expect(current.field(rawText)).toBe(first);
  expect(undo(target)).toBe(true);
  expect(current.field(rawText)).toBe("- A\n- [x] B");
  expect(redo(target)).toBe(true);
  expect(current.field(rawText)).toBe(first);
  expect(redo(target)).toBe(true);
  expect(current.field(rawText)).toBe(indented);
  expect(redo(target)).toBe(true);
  expect(current.field(rawText)).toBe(indented + "?");
});
test("protected related tasks and unavailable trees cannot create partial plans", () => {
  let state = createRawEditorState(
    "- A\n- [x] B",
    longLineProtection.init(() => [{ from: 4, to: 11 }])
  );
  state = state.update({ selection: EditorSelection.cursor(11) }).state;
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({}).state;
  expect(state.field(longLineProtection)).toEqual([{ from: 4, to: 11 }]);
  expect(planSourceIndentation(state, true).reason).toBeDefined();
  expect(undoDepth(state)).toBe(0);
  const raw = "- [x] A\n".repeat(20000);
  let partial = createRawEditorState(raw);
  partial = partial.update({
    selection: EditorSelection.cursor(partial.doc.length - 1),
  }).state;
  expect(syntaxTreeAvailable(partial, partial.doc.length)).toBe(false);
  expect(planListIndentation(partial, true)?.changes).toBeUndefined();
  expect(planSourceIndentation(partial, true).reason).toBeDefined();
  expect(syntaxTreeAvailable(partial, partial.doc.length)).toBe(false);
  expect(partial.field(rawText)).toBe(raw);
  expect(undoDepth(partial)).toBe(0);
});
