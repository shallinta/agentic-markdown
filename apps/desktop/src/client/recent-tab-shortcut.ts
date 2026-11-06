type RecentTabKey = Pick<KeyboardEvent,
  "key" | "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "isComposing" | "keyCode" | "preventDefault" | "stopPropagation"
>;

export function routeRecentTabKey(
  event: RecentTabKey,
  phase: "keydown" | "keyup",
  actions: {
    canCycle: () => boolean;
    hasCandidate: () => boolean;
    advance: () => void;
    finish: () => void;
    cancel: () => void;
  }
): boolean {
  const allowed = () => !event.isComposing && event.keyCode !== 229 && actions.canCycle();
  if (phase === "keyup") {
    if (event.key === "Control" && !event.ctrlKey && actions.hasCandidate()) {
      if (allowed() && !event.shiftKey && !event.altKey && !event.metaKey) actions.finish();
      else actions.cancel();
    }
    return false;
  }
  if (event.key === "Escape" && actions.hasCandidate()) {
    const owned = allowed();
    actions.cancel();
    if (!owned) return false;
  } else if (event.key === "Tab" && event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey) {
    if (!allowed()) {
      actions.cancel();
      return false;
    }
    actions.advance();
  } else return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}
