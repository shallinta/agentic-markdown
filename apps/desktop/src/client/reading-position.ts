/** First monotonic match, or length; used for ordered source ranges/DOM blocks. */
export function firstReadingBlock(
  length: number,
  matches: (index: number) => boolean
) {
  let low = 0,
    high = length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (matches(mid)) high = mid;
    else low = mid + 1;
  }
  return low;
}
