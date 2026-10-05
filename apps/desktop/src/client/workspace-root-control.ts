import type { MouseEvent } from "react";

/** Preserve the button focus through folder busy, not through global disabling. */
export function rootControlHandlers(
  disabled: boolean,
  isBusy: () => boolean,
  action: () => void
) {
  return {
    onMouseDown(event: MouseEvent<HTMLButtonElement>) {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
    },
    onClick(event: MouseEvent<HTMLButtonElement>) {
      if (disabled || event.button !== 0 || isBusy()) return;
      action();
    },
  };
}
