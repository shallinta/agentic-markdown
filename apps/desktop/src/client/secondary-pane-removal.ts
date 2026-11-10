import { SECONDARY_MIN_HEIGHT } from "./secondary-pane-height";

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

/** Transfer the removed slot to its next neighbor, or previous if it was last. */
export function removeSecondaryPaneHeight(
  current: readonly number[],
  index: number
): readonly number[] | undefined {
  if (
    !isArray(current) ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= current.length
  )
    return undefined;
  for (const height of current)
    if (!Number.isFinite(height) || height < SECONDARY_MIN_HEIGHT)
      return undefined;
  if (current.length === 1) return [];

  const receiver = index < current.length - 1 ? index + 1 : index - 1;
  const combined = current[receiver] + current[index];
  if (!Number.isFinite(combined)) return undefined;
  const result = current.slice();
  result[receiver] = combined;
  result.splice(index, 1);
  return result;
}
