import { EditorState, type Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

import { writePermission } from "./raw-buffer";

export function editorPermissionEffect(readOnly: boolean) {
  return writePermission.reconfigure([
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({ tabindex: "0" }),
  ]);
}

/** Only the controller's accepted state may become the initial view state. */
export function prepareEditorViewState(
  controller: {
    getEditor: (id: string) => { state: EditorState } | undefined;
    canWrite: (id: string) => boolean;
    updateEditor: (id: string, transaction: Transaction) => boolean;
  },
  documentId: string
) {
  const before = controller.getEditor(documentId)?.state;
  if (!before) return undefined;
  const transaction = before.update({
    effects: editorPermissionEffect(!controller.canWrite(documentId)),
  });
  if (!controller.updateEditor(documentId, transaction)) return undefined;
  const accepted = controller.getEditor(documentId)?.state;
  return accepted === transaction.state ? accepted : undefined;
}

export function editorSurfaceEditable(
  readOnly: boolean,
  frozen: boolean,
  inputBlocked: boolean
) {
  return !readOnly && !frozen && !inputBlocked;
}

/** Layout effects may have advanced the controller since React captured its render. */
export function syncCurrentEditorState(
  view: Pick<EditorView, "state" | "setState">,
  controller: { getEditor: (id: string) => { state: EditorState } | undefined },
  documentId: string
) {
  const current = controller.getEditor(documentId);
  if (!current) return undefined;
  if (view.state !== current.state) view.setState(current.state);
  return current.state;
}
