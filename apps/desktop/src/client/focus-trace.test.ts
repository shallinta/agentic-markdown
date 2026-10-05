import { expect, spyOn, test } from "bun:test";

import { createFocusTrace } from "./focus-trace";

test("focusin selection summary classifies endpoints without sensitive reads or mutations", () => {
  const f = fixture();
  let reads = 0;
  let selection: object | null = null;
  Object.assign(f.target, {
    nodeType: 9,
    getSelection: () => {
      reads++;
      return selection;
    },
  });
  const editorA = {};
  const editorB = {};
  const endpoint = (editor: object | null, root: object = f.doc) => ({
    nodeType: 3,
    getRootNode: () => root,
    parentElement: {
      closest: (selector: string) =>
        selector === ".cm-content" && editor
          ? {
              closest: (owner: string) =>
                owner === ".cm-editor[data-document-editor]" ? editor : null,
            }
          : null,
    },
    get textContent(): never {
      throw Error("private text");
    },
  });
  const set = (anchor: object | null, focus: object | null) => {
    selection = { rangeCount: 1, anchorNode: anchor, focusNode: focus };
    for (const key of [
      "anchorOffset",
      "focusOffset",
      "toString",
      "removeAllRanges",
      "collapse",
      "getRangeAt",
    ])
      Object.defineProperty(selection, key, {
        get() {
          throw Error("private or mutating selection API");
        },
      });
  };
  const trace = createFocusTrace(f.doc);
  f.dispatch("focusin");
  expect(reads).toBe(0);
  trace.start();
  f.dispatch("click");
  expect(reads).toBe(0);
  f.dispatch("focusin");
  set(endpoint(editorA), endpoint(editorA));
  f.dispatch("focusin");
  set(endpoint(editorA), endpoint(editorB));
  f.dispatch("focusin");
  set(endpoint(editorA), endpoint(null));
  f.dispatch("focusin");
  set(null, endpoint(editorA));
  f.dispatch("focusin");
  set(endpoint(null), endpoint(null));
  f.dispatch("focusin");
  set(endpoint(editorA, {}), endpoint(editorA));
  f.dispatch("focusin");
  const rows = trace.stop();
  expect(
    rows
      .slice(1, 7)
      .map((row) => [
        row.selectionRangeCount,
        row.selectionAnchor,
        row.selectionFocus,
        row.selectionSameEditor,
      ])
  ).toEqual([
    [0, "none", "none", false],
    [1, "editor", "editor", true],
    [1, "editor", "editor", false],
    [1, "editor", "other", false],
    [1, "none", "editor", false],
    [1, "other", "other", false],
  ]);
  expect(rows[7]).not.toHaveProperty("selectionRangeCount");
  expect(rows.every((row) => !row.prevented)).toBe(true);
  expect(JSON.stringify(rows)).not.toMatch(
    /anchorOffset|focusOffset|parentElement|anchorNode/
  );
  f.dispatch("focusin");
  expect(reads).toBe(7);
});

test("unavailable or exposed shadow selection is omitted without disrupting trace", () => {
  const f = fixture();
  Object.assign(f.target, {
    nodeType: 9,
    getSelection() {
      throw Error("unavailable");
    },
  });
  const trace = createFocusTrace(f.doc);
  trace.start();
  f.dispatch("focusin");
  Object.assign(f.target.activeElement!, { shadowRoot: {} });
  f.dispatch("focusin");
  expect(trace.stop().map((row) => row.type)).toEqual(["focusin", "focusin"]);
  expect(
    trace.stop().every((row) => row.selectionRangeCount === undefined)
  ).toBe(true);
});

function fixture() {
  const windowTarget = new EventTarget();
  const target = Object.assign(new EventTarget(), {
    activeElement: null as Element | null,
    defaultView: windowTarget,
    hasFocus: () => true,
  });
  const doc = target as unknown as Document;
  const element = {
    nodeType: 1,
    closest: (selector: string) =>
      selector === ".cm-content" ? element : null,
    get textContent(): never {
      throw Error("sensitive text read");
    },
    getAttribute(): never {
      throw Error("attribute read");
    },
  } as unknown as Element;
  target.activeElement = element;
  const dispatch = (
    type: string,
    extra: Record<string, unknown> = {},
    guardedProperties: string[] = []
  ) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperties(event, {
      target: { value: element },
      data: {
        get() {
          throw Error("sensitive input data read");
        },
      },
    });
    Object.assign(event, extra);
    for (const property of guardedProperties) {
      Object.defineProperty(event, property, {
        get(): never {
          throw Error(`sensitive pointer property read: ${property}`);
        },
      });
    }
    target.dispatchEvent(event);
    return event;
  };
  return { target, windowTarget, doc, dispatch };
}

test("trace is idle by default, bounded, idempotent, and detaches on stop/dispose", () => {
  const f = fixture();
  const trace = createFocusTrace(f.doc, () => 10);
  f.dispatch("keydown", { key: " " });
  expect(trace.stop()).toEqual([]);
  trace.start();
  trace.start();
  for (let n = 0; n < 140; n++) f.dispatch("keydown", { key: " " });
  const rows = trace.stop();
  expect(rows).toHaveLength(128);
  expect(rows[0].sequence).toBe(13);
  expect(rows[127].sequence).toBe(140);
  f.dispatch("keydown", { key: "Enter" });
  expect(trace.stop()).toEqual(rows);
  rows[0].type = "mutated";
  expect(trace.stop()[0].type).toBe("keydown");
  trace.start();
  f.windowTarget.dispatchEvent(new Event("focus"));
  expect(trace.stop()[0].target).toBe("window");
  trace.start();
  trace.dispose();
  f.dispatch("input", { inputType: "insertText" });
  expect(trace.stop()).toEqual([]);
});

test("listener installation is explicit and teardown removes each installed listener", () => {
  const f = fixture();
  const add = spyOn(f.target, "addEventListener");
  const remove = spyOn(f.target, "removeEventListener");
  const windowAdd = spyOn(f.windowTarget, "addEventListener");
  const windowRemove = spyOn(f.windowTarget, "removeEventListener");
  const trace = createFocusTrace(f.doc);
  expect(add).not.toHaveBeenCalled();
  expect(windowAdd).not.toHaveBeenCalled();
  trace.start();
  trace.start();
  expect(add).toHaveBeenCalledTimes(9);
  expect(windowAdd).toHaveBeenCalledTimes(2);
  trace.dispose();
  expect(remove.mock.calls).toEqual(add.mock.calls);
  expect(windowRemove.mock.calls).toEqual(windowAdd.mock.calls);
  add.mockRestore();
  remove.mockRestore();
  windowAdd.mockRestore();
  windowRemove.mockRestore();
});

test("trace reads only whitelisted metadata without cancelling events or retaining sensitive strings", () => {
  const f = fixture();
  const trace = createFocusTrace(f.doc);
  trace.start();
  const event = f.dispatch("keydown", { key: "SECRET/path.md", altKey: true });
  f.dispatch("beforeinput", { inputType: "insertText", isComposing: false });
  f.dispatch("input", { inputType: "SECRET/input" });
  const rows = trace.stop();
  expect(event.defaultPrevented).toBe(false);
  expect(rows.map((row) => row.type)).toEqual([
    "keydown",
    "beforeinput",
    "input",
  ]);
  expect(rows[0].key).toBe("Other");
  expect(rows[0].target).toBe("editor");
  expect(rows[0].targetId).toBe(rows[0].activeId);
  expect(rows[0].hasFocus).toBe(true);
  expect(rows[1].inputType).toBe("insertText");
  expect(rows[2].inputType).toBe("Other");
  expect(JSON.stringify(rows)).not.toContain("SECRET");
  expect(rows[1]).not.toHaveProperty("data");
  trace.clear();
  expect(trace.stop()).toEqual([]);
});

test("pointer observations preserve order without reading pointer details or cancelling defaults", () => {
  const f = fixture();
  const trace = createFocusTrace(f.doc);
  const guarded = [
    "clientX",
    "clientY",
    "screenX",
    "screenY",
    "pageX",
    "pageY",
    "offsetX",
    "offsetY",
    "pointerId",
    "pointerType",
    "pressure",
    "button",
    "buttons",
    "relatedTarget",
    "altKey",
    "ctrlKey",
    "metaKey",
    "shiftKey",
  ];
  f.dispatch("pointerdown", {}, guarded);
  expect(trace.stop()).toEqual([]);
  trace.start();
  const events = [
    f.dispatch("pointerdown", {}, guarded),
    f.dispatch("mousedown", {}, guarded),
    f.dispatch("focusin"),
    f.dispatch("click", {}, guarded),
  ];
  const rows = trace.stop();
  expect(rows.map((row) => row.type)).toEqual([
    "pointerdown",
    "mousedown",
    "focusin",
    "click",
  ]);
  expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4]);
  expect(events.every((event) => !event.defaultPrevented)).toBe(true);
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual(
      [
        "sequence",
        "milliseconds",
        "type",
        "target",
        "targetId",
        "active",
        "activeId",
        "hasFocus",
        "trusted",
        "prevented",
      ].sort()
    );
    expect(row.target).toBe("editor");
    expect(row.activeId).toBe(row.targetId);
  }
  f.dispatch("pointerdown", {}, guarded);
  f.dispatch("mousedown", {}, guarded);
  expect(trace.stop()).toEqual(rows);
});
