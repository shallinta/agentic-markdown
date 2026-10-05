import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

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
