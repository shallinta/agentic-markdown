import { SECONDARY_MIN_HEIGHT } from "./secondary-pane-height";

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

/** Model heights only. Positive delta moves the divider down, preserving other slots. */
export function resizeSecondaryPaneDivider(
  current: readonly number[],
  beforeIndex: number,
  delta: number
): readonly number[] | undefined {
  if (
    !isArray(current) ||
    !Number.isSafeInteger(beforeIndex) ||
    beforeIndex < 0 ||
    beforeIndex >= current.length - 1 ||
    !Number.isFinite(delta)
  )
    return undefined;
  for (const height of current)
    if (!Number.isFinite(height) || height < SECONDARY_MIN_HEIGHT)
      return undefined;

  const before = current[beforeIndex],
    after = current[beforeIndex + 1];
  if (!Number.isFinite(before + after)) return undefined;
  const up = before - SECONDARY_MIN_HEIGHT;
  const down = after - SECONDARY_MIN_HEIGHT;
  const movement = Math.max(-up, Math.min(down, delta));
  if (movement === 0) return current;

  // Explicit endpoints avoid subtraction cancellation below the minimum.
  const nextBefore =
    movement === -up ? SECONDARY_MIN_HEIGHT : before + movement;
  const nextAfter = movement === down ? SECONDARY_MIN_HEIGHT : after - movement;
  if (
    !Number.isFinite(nextBefore) ||
    !Number.isFinite(nextAfter) ||
    nextBefore < SECONDARY_MIN_HEIGHT ||
    nextAfter < SECONDARY_MIN_HEIGHT
  )
    return undefined;
  if (nextBefore === before && nextAfter === after) return current;
  const result = current.slice();
  result[beforeIndex] = nextBefore;
  result[beforeIndex + 1] = nextAfter;
  return result;
}
