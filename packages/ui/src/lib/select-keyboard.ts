/** Runs in SelectContent's bubble handler, after Radix's item selection. */
export function preventSelectEnterDefault(event: {
  key: string;
  nativeEvent: { isComposing: boolean; keyCode: number };
  preventDefault: () => void;
}) {
  if (
    event.key === "Enter" &&
    !event.nativeEvent.isComposing &&
    event.nativeEvent.keyCode !== 229
  )
    event.preventDefault();
}
