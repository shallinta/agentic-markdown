import type { CanonicalResult } from "./current-canonical-protocol";
import type { createDocumentController } from "./documents";
import type { EditorFaultSession } from "./editor-fault";

/** Called at the actual gesture, not only while rendering. No write capability
 * check: copying a readable readonly document is allowed. */
export function readingCodeCurrent(
  controller: Pick<
    ReturnType<typeof createDocumentController>,
    | "getSnapshot"
    | "getEditor"
    | "getEditorFault"
    | "getMode"
    | "isSafeSource"
    | "canChangeReadingTheme"
  >,
  canonical: { isCurrent(result: CanonicalResult): boolean },
  documentId: string,
  session: EditorFaultSession | undefined,
  result: CanonicalResult
): boolean {
  const current = controller.getSnapshot();
  const buffer = controller.getEditor(documentId);
  return (
    current.snapshot?.documentId === documentId &&
    !current.frozen &&
    !current.busy &&
    controller.canChangeReadingTheme() &&
    controller.getMode(documentId) === "reading" &&
    !controller.isSafeSource(documentId) &&
    !!session &&
    controller.getEditorFault(documentId) === session &&
    !session.fault &&
    buffer?.revision === result.revision &&
    result.documentId === documentId &&
    canonical.isCurrent(result)
  );
}
