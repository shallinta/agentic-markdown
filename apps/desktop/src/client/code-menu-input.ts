/** Protect only this open menu's background editor. Never reinterpret text as keys. */
export function guardCodeMenuInput(
  event: Pick<InputEvent, "cancelable" | "target" | "preventDefault">,
  context: {
    open: boolean;
    current: boolean;
    menu: Pick<HTMLElement, "contains"> | null;
    editor: Pick<HTMLElement, "contains"> | null;
    activeElement: Element | null;
  }
) {
  if (
    !event.cancelable ||
    !context.open ||
    !context.current ||
    !event.target ||
    !context.activeElement ||
    !context.menu?.contains(context.activeElement) ||
    !context.editor?.contains(event.target as Node)
  )
    return false;
  event.preventDefault();
  return true;
}
