import { EditorView } from "@codemirror/view";

type SelectionView = Pick<
  EditorView,
  "dom" | "contentDOM" | "state" | "compositionStarted"
>;

/** Release only stale editable DOM selection after a real tree focus transfer. */
export function releaseTreeEditorSelection(
  container: HTMLElement,
  target: EventTarget | null,
  findView: (element: HTMLElement) => SelectionView | null = (element) =>
    EditorView.findFromDOM(element)
): boolean {
  try {
    const doc = container.ownerDocument;
    if (
      !target ||
      target !== doc.activeElement ||
      (target as Node).nodeType !== 1
    )
      return false;
    const focused = target as HTMLElement;
    if (
      container.getRootNode() !== doc ||
      focused.getRootNode() !== doc ||
      !container.contains(focused) ||
      focused.shadowRoot ||
      !(
        focused.matches('[role="treeitem"]') ||
        (focused.matches("button") && focused.closest('[role="treeitem"]'))
      )
    )
      return false;
    const selection = doc.getSelection();
    if (selection?.rangeCount !== 1) return false;
    const contentFor = (node: Node | null) => {
      if (node?.getRootNode() !== doc) return null;
      const element =
        node.nodeType === 1 ? (node as Element) : node.parentElement;
      return element?.closest<HTMLElement>(".cm-content") ?? null;
    };
    const content = contentFor(selection.anchorNode);
    if (!content || contentFor(selection.focusNode) !== content) return false;
    const editor = content.closest<HTMLElement>(
      ".cm-editor[data-document-editor]"
    );
    if (!editor) return false;
    const view = findView(editor);
    if (
      view?.dom !== editor ||
      view.contentDOM !== content ||
      !view.contentDOM.isContentEditable ||
      view.compositionStarted ||
      view.state.readOnly ||
      !view.state.facet(EditorView.editable)
    )
      return false;
    selection.removeAllRanges();
    return true;
  } catch {
    // Missing/unsupported DOM or view state must not interfere with focus/input.
    return false;
  }
}
