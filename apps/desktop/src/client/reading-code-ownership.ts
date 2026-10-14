/** Ownership is granted only by the controlled React component, never Markdown. */
const roots = new WeakSet<Element>();
export const isOwnedReadingCode = (element: Element) => roots.has(element);
export function retainReadingCode(element: Element | null) {
  if (element) roots.add(element);
  return () => {
    if (element) roots.delete(element);
  };
}
