import { expect, mock, test } from "bun:test";

import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { releaseTreeEditorSelection } from "./tree-editor-selection";

function fixture(button = false) {
  const removeAllRanges = mock(() => undefined);
  const selection = {
    rangeCount: 1,
    anchorNode: null as unknown,
    focusNode: null as unknown,
    removeAllRanges,
  };
  const doc = { activeElement: null as unknown, getSelection: () => selection };
  const target = {
    nodeType: 1,
    getRootNode: () => doc,
    shadowRoot: null as unknown,
    matches: (s: string) => s === (button ? "button" : '[role="treeitem"]'),
    closest: () => target,
  };
  doc.activeElement = target;
  const container = {
    ownerDocument: doc,
    getRootNode: () => doc,
    contains: (n: unknown) => n === target,
  };
  const editor = {};
  const content = { closest: () => editor, isContentEditable: true };
  const node = {
    nodeType: 3,
    getRootNode: () => doc,
    parentElement: { closest: () => content },
  };
  selection.anchorNode = node;
  selection.focusNode = node;
  const state = EditorState.create({
    doc: "unchanged",
    selection: { anchor: 2, head: 5 },
  });
  const view = {
    dom: editor,
    contentDOM: content,
    compositionStarted: false,
    state,
  };
  const resolve = mock(() => view);
  const run = () =>
    releaseTreeEditorSelection(
      container as unknown as HTMLElement,
      target as unknown as EventTarget,
      resolve as unknown as NonNullable<
        Parameters<typeof releaseTreeEditorSelection>[2]
      >
    );
  return {
    run,
    removeAllRanges,
    doc,
    container,
    target,
    selection,
    editor,
    content,
    node,
    view,
    resolve,
    state,
  };
}

test("tree rows and root buttons release only DOM selection, preserving model state", () => {
  for (const button of [false, true]) {
    const f = fixture(button);
    expect(f.run()).toBe(true);
    expect(f.removeAllRanges).toHaveBeenCalledTimes(1);
    expect(f.resolve).toHaveBeenCalledWith(f.editor);
    expect(f.view.state).toBe(f.state);
    expect(f.view.state.doc.toString()).toBe("unchanged");
    expect(f.view.state.selection.main.toJSON()).toEqual({
      anchor: 2,
      head: 5,
    });
  }
});

test("composition, readonly and editable barriers are read from the actual view", () => {
  for (const barrier of ["composition", "readonly", "editable"] as const) {
    const f = fixture();
    if (barrier === "composition") f.view.compositionStarted = true;
    else
      f.view.state = EditorState.create({
        extensions:
          barrier === "readonly"
            ? EditorState.readOnly.of(true)
            : EditorView.editable.of(false),
      });
    expect(f.run()).toBe(false);
    expect(f.removeAllRanges).not.toHaveBeenCalled();
  }
});

test("mixed, ordinary, shadow, stale and multi-range selections remain untouched", () => {
  const changes: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.doc.activeElement = {};
    },
    (f) => {
      f.container.contains = () => false;
    },
    (f) => {
      f.target.shadowRoot = {};
    },
    (f) => {
      f.target.matches = () => false;
    },
    (f) => {
      f.selection.rangeCount = 0;
    },
    (f) => {
      f.selection.rangeCount = 2;
    },
    (f) => {
      f.selection.focusNode = null;
    },
    (f) => {
      f.selection.focusNode = {
        ...f.node,
        parentElement: { closest: () => ({}) },
      };
    },
    (f) => {
      f.selection.focusNode = { ...f.node, getRootNode: () => ({}) };
    },
    (f) => {
      f.view.dom = {};
    },
    (f) => {
      f.view.contentDOM = { closest: () => ({}), isContentEditable: true };
    },
    (f) => {
      f.content.isContentEditable = false;
    },
    (f) => {
      f.doc.getSelection = () => {
        throw Error("unavailable");
      };
    },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    expect(f.run()).toBe(false);
    expect(f.removeAllRanges).not.toHaveBeenCalled();
  }
});
