import {
  createCurrentCanonical,
  type CurrentCanonicalWorker,
} from "./current-canonical";
import type { createDocumentController } from "./documents";
import { rawText } from "./raw-buffer";

/** Bind lifetime to controller sessions, including an unchanged/empty reload. */
export function createDocumentCanonical(
  controller: ReturnType<typeof createDocumentController>,
  factory: () => CurrentCanonicalWorker
) {
  return createCurrentCanonical(() => {
    const state = controller.getSnapshot();
    if (state.frozen || state.busy) return null;
    const snapshot = state.snapshot;
    const editor = snapshot && controller.getEditor(snapshot.documentId);
    const identity = snapshot && controller.getEditorFault(snapshot.documentId);
    return snapshot && editor && identity
      ? {
          documentId: snapshot.documentId,
          revision: editor.revision,
          text: editor.state.field(rawText),
          identity,
        }
      : null;
  }, factory);
}

/** DiscardGuard has one participant; compose derived cancellation with document safety. */
export function canonicalDiscardParticipant(
  controller: Pick<
    ReturnType<typeof createDocumentController>,
    | "beginDiscard"
    | "endDiscard"
    | "hasDirty"
    | "waitForSaves"
    | "reportDiscardFailure"
  >,
  canonical: Pick<ReturnType<typeof createCurrentCanonical>, "cancel">,
  beforeDiscard?: () => Promise<void>,
  hasDiscardable?: () => boolean
) {
  return {
    beginDiscard: controller.beginDiscard,
    endDiscard: controller.endDiscard,
    hasDirty: hasDiscardable ?? controller.hasDirty,
    reportDiscardFailure: controller.reportDiscardFailure,
    waitForSaves: () => {
      canonical.cancel();
      const saved = controller.waitForSaves();
      return beforeDiscard ? saved.then(beforeDiscard) : saved;
    },
  };
}
