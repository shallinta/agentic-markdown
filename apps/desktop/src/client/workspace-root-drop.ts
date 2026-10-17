import type { RootPlacement } from "./workspace-root-order";

interface RejectedTreeDragEvent {
  preventDefault: () => void;
  dataTransfer: { dropEffect: string };
}

/** Attached only to the tree container; valid headers stop bubbling here. */
export function rejectedTreeDragHandlers(
  clearIndicator: () => void,
  cancel: () => void
) {
  const reject = (event: RejectedTreeDragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
    clearIndicator();
  };
  return {
    onDragOver: reject,
    onDrop: (event: RejectedTreeDragEvent) => {
      reject(event);
      cancel();
    },
  };
}

/** Only the header's narrow outer edges are insertion targets, never its center. */
export function rootDropPlacement(
  y: number,
  height: number
): RootPlacement | null {
  if (
    !Number.isFinite(y) ||
    !Number.isFinite(height) ||
    height <= 0 ||
    y < 0 ||
    y > height
  )
    return null;
  const edge = Math.min(8, height / 4);
  return y <= edge ? "before" : y >= height - edge ? "after" : null;
}
