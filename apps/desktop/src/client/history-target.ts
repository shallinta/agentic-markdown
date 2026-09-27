/** Ordinary fields own native undo; toolbar/tab focus retains document context. */
export function isExternalTextTarget(target: Element | null): boolean {
  return (
    !!target &&
    !target.closest("[data-document-editor]") &&
    (!!target.closest("input, textarea, select") ||
      !!target.closest('[contenteditable="true"]'))
  );
}

export function captureHistoryTarget(): string | undefined {
  if (isExternalTextTarget(document.activeElement)) return undefined;
  return document.querySelector<HTMLElement>("[data-document-editor]")?.dataset
    .documentEditor;
}
