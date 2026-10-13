import { expect, test } from "bun:test";

import { ensureSyntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

import { createRawEditorState, rawText } from "./raw-buffer";
import { taskMarkers } from "./task-marker";
import { registerTaskView, taskGesture } from "./task-marker-input";
import { TaskMarkerWidget } from "./task-marker-widget";

class Button extends EventTarget {
  type = "";
  className = "";
  textContent = "";
  attributes = new Map<string, string>();
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}
function event(type: string, properties: Record<string, unknown> = {}) {
  const result = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(properties))
    Object.defineProperty(result, key, { value });
  return result;
}
function setup() {
  let state = createRawEditorState("- [ ] task"),
    allowed = true,
    calls = 0,
    focused = 0;
  ensureSyntaxTree(state, state.doc.length, 1000);
  const listeners = new Set<() => void>();
  const contentDOM = new EventTarget();
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    defaultView: window,
    createElement: () => new Button(),
  });
  const view = {
    contentDOM,
    dom: { ownerDocument: document },
    focus() {
      focused++;
    },
  } as unknown as EditorView;
  const register = () =>
    registerTaskView(
      view,
      () => (allowed ? state : undefined),
      (transaction) => {
        calls++;
        state = transaction.state;
        return true;
      },
      (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }
    );
  const remove = register(),
    marker = taskMarkers(state, [{ from: 0, to: state.doc.length }])[0];
  const widget = new TaskMarkerWidget(state, marker),
    button = widget.toDOM(view) as unknown as Button;
  return {
    view,
    button,
    widget,
    remove,
    register,
    marker,
    contentDOM,
    window,
    document,
    notify: () => {
      for (const listener of listeners) listener();
    },
    block: () => {
      allowed = false;
    },
    allow: () => {
      allowed = true;
    },
    state: () => state,
    calls: () => calls,
    focused: () => focused,
  };
}
test("widget pointer and keyboard activate only an issued local gesture and remove listeners", () => {
  const x = setup();
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(0);
  const down = event("pointerdown", { button: 0, isPrimary: true });
  x.button.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  x.button.dispatchEvent(event("click"));
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(1);
  expect(x.state().field(rawText)).toBe("- [x] task");
  expect(x.focused()).toBe(1);
  x.remove();
  const y = setup();
  y.button.dispatchEvent(
    event("keydown", { key: " ", repeat: false, isComposing: false })
  );
  y.button.dispatchEvent(event("keyup", { key: " ", isComposing: false }));
  y.button.dispatchEvent(event("click"));
  expect(y.calls()).toBe(1);
  y.remove();
  const z = setup();
  z.button.dispatchEvent(event("pointerdown", { button: 0, isPrimary: true }));
  // Equal widget instances may inherit existing DOM in CM's public lifecycle.
  new TaskMarkerWidget(z.state(), z.marker).destroy(
    z.button as unknown as HTMLElement
  );
  z.button.dispatchEvent(event("click"));
  expect(z.calls()).toBe(0);
  z.remove();
});
test("composition and permission ABA cancel before tail click, old registration cleanup preserves new", () => {
  const x = setup();
  x.block();
  x.button.dispatchEvent(event("pointerdown", { button: 0, isPrimary: true }));
  x.allow();
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(0);
  x.button.dispatchEvent(event("pointerdown", { button: 0, isPrimary: true }));
  x.contentDOM.dispatchEvent(event("compositionstart"));
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(0);
  x.button.dispatchEvent(event("pointerdown", { button: 0, isPrimary: true }));
  x.block();
  x.notify();
  x.allow();
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(0);
  const removeNew = x.register();
  x.remove();
  expect(taskGesture(x.view)).toBeDefined();
  const ticket = taskGesture(x.view)?.begin(x.state(), x.marker);
  expect(taskGesture(x.view)?.complete(ticket)).toBe(true);
  removeNew();
  expect(taskGesture(x.view)).toBeUndefined();
});

test("window blur and outside release revoke only that pointer gesture", () => {
  const down = () =>
    event("pointerdown", { button: 0, isPrimary: true, pointerId: 1 });
  const x = setup();
  x.button.dispatchEvent(down());
  x.window.dispatchEvent(event("blur"));
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(0);
  x.button.dispatchEvent(down());
  x.document.dispatchEvent(event("pointerup", { pointerId: 1 }));
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(0);
  x.button.dispatchEvent(down());
  x.document.dispatchEvent(event("pointerup", { pointerId: 2 }));
  x.document.dispatchEvent(
    event("pointerup", { pointerId: 1, target: x.button })
  );
  x.button.dispatchEvent(event("click"));
  expect(x.calls()).toBe(1);
  x.remove();
});
