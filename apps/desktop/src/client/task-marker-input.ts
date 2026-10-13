import { isolateHistory } from "@codemirror/commands";
import type { EditorState, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import { taskMarkers, type TaskMarker } from "./task-marker";

interface Ticket {
  state: EditorState;
  marker: TaskMarker;
  epoch: number;
}

/** One local gesture, invalidated synchronously; never a last-editor target. */
export function createTaskGesture(
  current: () => EditorState | undefined,
  dispatch: (transaction: Transaction) => boolean
) {
  let epoch = 0,
    pending: Ticket | undefined;
  const cancel = () => {
    epoch++;
    pending = undefined;
  };
  return {
    cancel,
    revoke(ticket: Ticket | undefined) {
      if (ticket && pending === ticket) cancel();
    },
    begin(state: EditorState, marker: TaskMarker) {
      cancel();
      if (
        current() !== state ||
        state.readOnly ||
        !taskMarkers(state, [marker]).some(
          (m) =>
            m.from === marker.from &&
            m.to === marker.to &&
            m.checked === marker.checked
        )
      )
        return undefined;
      pending = { state, marker, epoch };
      return pending;
    },
    complete(ticket: Ticket | undefined) {
      const valid = ticket && pending === ticket && ticket.epoch === epoch;
      cancel();
      if (!valid || current() !== ticket.state || ticket.state.readOnly)
        return false;
      const marker = taskMarkers(ticket.state, [ticket.marker]).find(
        (m) =>
          m.from === ticket.marker.from &&
          m.to === ticket.marker.to &&
          m.checked === ticket.marker.checked
      );
      if (!marker) return false;
      return dispatch(
        ticket.state.update({
          changes: {
            from: marker.from + 1,
            to: marker.from + 2,
            insert: marker.checked ? " " : "x",
          },
          annotations: isolateHistory.of("full"),
          userEvent: "input.task",
        })
      );
    },
  };
}

const registrations = new WeakMap<
  EditorView,
  ReturnType<typeof createTaskGesture>
>();
export function registerTaskView(
  view: EditorView,
  current: () => EditorState | undefined,
  dispatch: (transaction: Transaction) => boolean,
  subscribe: (listener: () => void) => () => void
) {
  const gesture = createTaskGesture(current, dispatch);
  registrations.set(view, gesture);
  const unsubscribe = subscribe(gesture.cancel);
  view.contentDOM.addEventListener("compositionstart", gesture.cancel, true);
  const window = view.dom.ownerDocument.defaultView;
  window?.addEventListener("blur", gesture.cancel);
  return () => {
    gesture.cancel();
    unsubscribe();
    window?.removeEventListener("blur", gesture.cancel);
    view.contentDOM.removeEventListener(
      "compositionstart",
      gesture.cancel,
      true
    );
    if (registrations.get(view) === gesture) registrations.delete(view);
  };
}
export const taskGesture = (view: EditorView) => registrations.get(view);
export const invalidateTaskGesture = (view: EditorView) =>
  registrations.get(view)?.cancel();
