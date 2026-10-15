/** Private identity registry. DOM attributes never confer search ownership. */
export type ReadingRegistration =
  | { kind: "block"; id: number }
  | { kind: "html"; mode: "sanitized" | "source" }
  | { kind: "image"; alt: HTMLElement | null };

export function createReadingSearchRegistry() {
  const entries = new Map<HTMLElement, ReadingRegistration>();
  const listeners = new Set<() => void>();
  const blockVersions = new WeakMap<HTMLElement, number>();
  let version = 0,
    disposed = false;
  const notify = () => {
    version++;
    for (const listener of listeners) listener();
  };
  const invalidateBlock = (element: HTMLElement) => {
    for (
      let node: HTMLElement | null = element;
      node;
      node = node.parentElement
    ) {
      if (entries.get(node)?.kind === "block") {
        blockVersions.set(node, (blockVersions.get(node) ?? 0) + 1);
        break;
      }
    }
  };
  return {
    get version() {
      return version;
    },
    get: (element: HTMLElement) => entries.get(element),
    blockVersion: (element: HTMLElement) => blockVersions.get(element) ?? 0,
    blocks: () =>
      [...entries]
        .filter(
          (entry): entry is [HTMLElement, { kind: "block"; id: number }] =>
            entry[1].kind === "block"
        )
        .sort((a, b) => a[1].id - b[1].id),
    mount(element: HTMLElement, value: ReadingRegistration) {
      if (disposed) return () => undefined;
      entries.set(element, value);
      invalidateBlock(element);
      notify();
      return () => {
        if (entries.get(element) === value) {
          invalidateBlock(element);
          entries.delete(element);
          notify();
        }
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      entries.clear();
      notify();
      listeners.clear();
    },
  };
}
export type ReadingSearchRegistry = ReturnType<
  typeof createReadingSearchRegistry
>;
