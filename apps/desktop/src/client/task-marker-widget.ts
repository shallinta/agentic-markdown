import type { EditorState } from "@codemirror/state";
import { WidgetType, type EditorView } from "@codemirror/view";

import type { TaskMarker } from "./task-marker";
import { taskGesture } from "./task-marker-input";

// CM may reuse DOM between equal widget values; cleanup belongs to that DOM.
const cleanups = new WeakMap<HTMLElement, () => void>();

/** Controlled presentation. DOM state is never a source of document edits. */
export class TaskMarkerWidget extends WidgetType {
  constructor(
    readonly state: EditorState,
    readonly marker: TaskMarker
  ) {
    super();
  }
  eq(other: TaskMarkerWidget) {
    return this.state === other.state && this.marker.from === other.marker.from;
  }
  toDOM(view: EditorView) {
    const element = view.dom.ownerDocument.createElement("button");
    element.type = "button";
    element.className = "cm-live-task";
    element.setAttribute("role", "checkbox");
    element.setAttribute("aria-checked", String(this.marker.checked));
    element.setAttribute(
      "aria-label",
      this.marker.checked ? "标记为未完成" : "标记为已完成"
    );
    element.setAttribute("aria-disabled", String(this.state.readOnly));
    element.textContent = this.marker.checked ? "☑" : "☐";
    let ticket: ReturnType<
      NonNullable<ReturnType<typeof taskGesture>>["begin"]
    >;
    let key: string | undefined;
    let pointer: number | undefined;
    const abort = new AbortController();
    cleanups.set(element, () => {
      taskGesture(view)?.revoke(ticket);
      ticket = undefined;
      key = undefined;
      pointer = undefined;
      abort.abort();
    });
    const cancel = () => {
      taskGesture(view)?.revoke(ticket);
      ticket = undefined;
      key = undefined;
      pointer = undefined;
    };
    element.addEventListener(
      "pointerdown",
      (event) => {
        cancel();
        if (event.button !== 0 || !event.isPrimary) return;
        // Capture before default focus can end an editor composition.
        event.preventDefault();
        pointer = event.pointerId;
        ticket = taskGesture(view)?.begin(this.state, this.marker);
      },
      { capture: true, signal: abort.signal }
    );
    element.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = ticket;
        ticket = undefined;
        if (taskGesture(view)?.complete(current)) view.focus();
      },
      { signal: abort.signal }
    );
    element.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat || event.isComposing) {
          cancel();
          return;
        }
        cancel();
        key = event.key;
        ticket = taskGesture(view)?.begin(this.state, this.marker);
      },
      { capture: true, signal: abort.signal }
    );
    element.addEventListener(
      "keyup",
      (event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        const current =
          key === event.key && !event.isComposing ? ticket : undefined;
        ticket = undefined;
        key = undefined;
        if (taskGesture(view)?.complete(current)) view.focus();
      },
      { capture: true, signal: abort.signal }
    );
    element.addEventListener("pointercancel", cancel, { signal: abort.signal });
    view.dom.ownerDocument.addEventListener(
      "pointerup",
      (event) => {
        if (pointer === event.pointerId && event.target !== element) cancel();
      },
      { capture: true, signal: abort.signal }
    );
    view.dom.ownerDocument.addEventListener(
      "pointercancel",
      (event) => {
        if (pointer === event.pointerId) cancel();
      },
      { capture: true, signal: abort.signal }
    );
    element.addEventListener("blur", cancel, { signal: abort.signal });
    element.addEventListener("compositionstart", cancel, {
      capture: true,
      signal: abort.signal,
    });
    return element;
  }
  ignoreEvent() {
    return true;
  }
  destroy(dom: HTMLElement) {
    cleanups.get(dom)?.();
    cleanups.delete(dom);
  }
}
