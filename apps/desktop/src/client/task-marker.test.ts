import { expect, spyOn, test } from "bun:test";

import { redo, undo, undoDepth } from "@codemirror/commands";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  type Transaction,
} from "@codemirror/state";
import { Tree } from "@lezer/common";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "./canonical-parser";
import { createDocumentController } from "./documents";
import { planInlineFormat } from "./inline-format";
import { listContinuationTransaction } from "./list-continuation";
import { planListIndentation } from "./list-indentation";
import { liveDecorations } from "./live-formatting";
import { markdownGrammar } from "./markdown-grammar";
import {
  createRawEditorState,
  rawOffset,
  rawText,
  writePermission,
} from "./raw-buffer";
import { taskMarkers } from "./task-marker";
import { createTaskGesture } from "./task-marker-input";
import { TaskMarkerWidget } from "./task-marker-widget";

function stateFor(raw: string) {
  const state = createRawEditorState(raw);
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}
const all = (state: EditorState) =>
  taskMarkers(state, [{ from: 0, to: state.doc.length }]);

test("public tree seam refuses an inline node crossing a task marker", () => {
  const state = stateFor("- [x] body"),
    tree = syntaxTree(state);
  expect(all(state)).toHaveLength(1);
  const node = (
    name: string,
    length: number,
    children: Tree[] = [],
    positions: number[] = []
  ) =>
    new Tree(
      markdownGrammar.nodeSet.types.find((type) => type.name === name)!,
      children,
      positions,
      length
    );
  // Deliberately synthetic public Tree, not a claimed naturally parsed counterexample.
  const crossing = node(
    "Document",
    10,
    [
      node(
        "BulletList",
        10,
        [
          node(
            "ListItem",
            10,
            [node("ListMark", 1), node("Paragraph", 8, [node("Link", 8)], [0])],
            [0, 2]
          ),
        ],
        [0]
      ),
    ],
    [0]
  );
  const seam = spyOn(tree, "iterate").mockImplementation(
    crossing.iterate.bind(crossing)
  );
  try {
    expect(all(state)).toEqual([]);
  } finally {
    seam.mockRestore();
  }
});

test("real controller refuses stale task transaction without raw or history changes", async () => {
  const text = "- [ ] task";
  const snapshot: DocumentSnapshot = {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "task.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
  const controller = createDocumentController({
    selectDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    readDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
  });
  await controller.select();
  const id = snapshot.documentId,
    state = controller.getEditor(id)!.state;
  ensureSyntaxTree(state, state.doc.length, 1000);
  let transaction: Transaction | undefined;
  const gesture = createTaskGesture(
    () => state,
    (tx) => {
      transaction = tx;
      return true;
    }
  );
  expect(gesture.complete(gesture.begin(state, all(state)[0]))).toBe(true);
  expect(
    controller.updateEditor(id, state.update({ selection: { anchor: 8 } }))
  ).toBe(true);
  const before = controller.getEditor(id)!.state;
  expect(controller.updateEditor(id, transaction!)).toBe(false);
  expect(controller.getEditor(id)!.state).toBe(before);
  expect(before.field(rawText)).toBe(text);
  expect(undoDepth(before)).toBe(0);
  expect(controller.isDirty(id)).toBe(false);
  controller.dispose();
});

test("task indentation and continuation preserve their independent task semantics", () => {
  let state = stateFor("- A\n- [ ] task");
  state = state.update({
    selection: EditorSelection.cursor(state.doc.length),
  }).state;
  const plan = planListIndentation(state, true);
  expect(plan?.reason).toBeUndefined();
  expect(state.update({ changes: plan?.changes }).state.field(rawText)).toBe(
    "- A\n  - [ ] task"
  );
  const after = listContinuationTransaction(state, false).state.field(rawText);
  expect(after).toBe("- A\n- [ ] task\n- [ ] ");
});

test("first content Paragraph projection preserves raw tree and task oracle", () => {
  for (const raw of [
    "- [ ] task",
    "10. [X] 中文",
    "> - [x] ref",
    "\ufeff- [ ] 中文\r\n- [X] two",
    "- [ ] \u00a0",
  ]) {
    const state = stateFor(raw),
      tree = syntaxTree(state);
    const markers = all(state);
    expect(markers.length).toBeGreaterThan(0);
    for (const marker of markers)
      expect(state.sliceDoc(marker.from, marker.to)).toMatch(/^\[[ xX]\]$/);
    const items: { from: number; checked: boolean }[] = [];
    const visit = (
      node:
        | ReturnType<typeof parseCanonicalMarkdown>["children"][number]
        | ReturnType<typeof parseCanonicalMarkdown>
    ) => {
      if (node.type === "listItem" && typeof node.checked === "boolean")
        items.push({
          from: node.position!.start.offset!,
          checked: node.checked,
        });
      if ("children" in node) for (const child of node.children) visit(child);
    };
    visit(parseCanonicalMarkdown(raw));
    for (const marker of markers) {
      let item = tree.resolveInner(marker.from, 1);
      while (item.parent && item.name !== "ListItem") item = item.parent;
      expect(item.name).toBe("ListItem");
      expect(items).toContainEqual({
        from: rawOffset(raw, item.from),
        checked: marker.checked,
      });
    }
    expect(syntaxTree(state)).toBe(tree);
    tree.iterate({
      enter(node) {
        expect(node.name).not.toBe("Task");
      },
    });
  }
  for (const raw of [
    "- [ ]",
    "- [ ] ",
    "- [ ]\n  body",
    "- [x](url)",
    "- first\n\n  [x] second",
    "- ```\n  x\n  ```\n\n  [x] second",
  ])
    expect(all(stateFor(raw))).toEqual([]);
});

test("projection bounds markers to visible ranges and protected syntax", () => {
  const state = stateFor("- [ ] item with body\n- [x] other");
  expect(taskMarkers(state, [{ from: 10, to: 15 }])).toEqual([]);
  expect(taskMarkers(state, [{ from: 2, to: 5 }]).map((m) => m.from)).toEqual([
    2,
  ]);
  expect(all(stateFor("- [ ] " + "x".repeat(10000)))).toEqual([]);
  const incomplete = createRawEditorState("- [ ] one\n".repeat(3000));
  expect(
    taskMarkers(incomplete, [
      { from: incomplete.doc.length - 8, to: incomplete.doc.length },
    ])
  ).toEqual([]);
});

test("exact marker decorations leave subsequent ordinary reference and body formats intact", () => {
  let state = stateFor("- [x] [ref]\n\n  [x] ordinary\n\n[ref]: /target");
  const ranges: { from: number; to: number; widget: boolean }[] = [];
  liveDecorations(state, [{ from: 0, to: state.doc.length }]).between(
    0,
    state.doc.length,
    (from, to, value) => {
      if (
        (value.spec as { widget?: unknown }).widget instanceof TaskMarkerWidget
      )
        ranges.push({ from, to, widget: true });
    }
  );
  expect(ranges).toEqual([{ from: 2, to: 5, widget: true }]);
  state = state.update({ selection: EditorSelection.range(2, 5) }).state;
  expect(planInlineFormat(state, "bold")).toBeUndefined();
  state = state.update({ selection: EditorSelection.range(6, 11) }).state;
  // Existing reference-link restriction remains; not claimed as new task body support.
  expect(planInlineFormat(state, "bold")).toBeUndefined();
  state = stateFor("- [ ] plain");
  state = state.update({ selection: EditorSelection.range(6, 11) }).state;
  expect(planInlineFormat(state, "bold")).toBeDefined();
});

test("gesture consumes once, maps selection and restores exact X/BOM/EOL through history", () => {
  for (const raw of [
    "- [X] item",
    "\ufeff- [ ] a\r\n- [x] b",
    "- [ ] a\r- [x] b",
  ]) {
    let state = stateFor(raw);
    state = state.update({
      selection: EditorSelection.create(
        [EditorSelection.range(9, 7), EditorSelection.cursor(0)],
        0
      ),
    }).state;
    const before = state.selection,
      marker = all(state)[0];
    let calls = 0;
    const gesture = createTaskGesture(
      () => state,
      (transaction) => {
        calls++;
        state = transaction.state;
        return true;
      }
    );
    const ticket = gesture.begin(state, marker);
    expect(ticket).toBeDefined();
    expect(gesture.complete(ticket)).toBe(true);
    expect(gesture.complete(ticket)).toBe(false);
    expect(calls).toBe(1);
    const target = () => ({
      state,
      dispatch(transaction: Transaction) {
        state = transaction.state;
      },
    });
    expect(undo(target())).toBe(true);
    expect(state.field(rawText)).toBe(raw);
    expect(state.selection.eq(before)).toBe(true);
    expect(redo(target())).toBe(true);
    expect(state.field(rawText)).not.toBe(raw);
  }
});

test("blocked begin, state changes and cancelled permission/IME ABA cannot revive a ticket", () => {
  let state = stateFor("- [ ] item"),
    allowed = true,
    calls = 0;
  const gesture = createTaskGesture(
    () => (allowed ? state : undefined),
    () => {
      calls++;
      return true;
    }
  );
  const marker = all(state)[0],
    ticket = gesture.begin(state, marker);
  allowed = false;
  gesture.cancel();
  allowed = true;
  expect(gesture.complete(ticket)).toBe(false);
  allowed = false;
  const missing = gesture.begin(state, marker);
  allowed = true;
  expect(gesture.complete(missing)).toBe(false);
  const old = gesture.begin(state, marker);
  state = state.update({ selection: EditorSelection.cursor(8) }).state;
  expect(gesture.complete(old)).toBe(false);
  const destroyed = gesture.begin(state, marker);
  gesture.revoke(destroyed);
  expect(gesture.complete(destroyed)).toBe(false);
  const replaced = gesture.begin(state, marker),
    newer = gesture.begin(state, marker);
  gesture.revoke(replaced);
  expect(gesture.complete(newer)).toBe(true);
  calls = 0;
  const stale = state;
  state = stateFor("- [ ] item");
  expect(gesture.begin(stale, marker)).toBeUndefined();
  state = state.update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(gesture.begin(state, marker)).toBeUndefined();
  expect(calls).toBe(0);
});
