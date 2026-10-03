/** Restore the command target before the queued command is dispatched. */
export function restorePaletteFocus(
  previous: Pick<HTMLElement, "isConnected" | "focus"> | null
) {
  // A command may capture the viewport immediately afterward. Restoring focus
  // must not scroll to an offscreen caret and replace the user's reading anchor.
  if (previous?.isConnected) previous.focus({ preventScroll: true });
}
