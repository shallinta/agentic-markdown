/** Diagnostic only: include text nodes as well as elements, in tree order. */
export function captureReadingNodes(
  root: HTMLElement,
  excludeImageDescendants = false
): readonly Node[] {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    0xffffffff,
    excludeImageDescendants
      ? {
          acceptNode: (node) =>
            node.parentElement?.closest(".reading-image") ? 2 : 1,
        }
      : null
  );
  const nodes: Node[] = [root];
  let node: Node | null;
  while ((node = walker.nextNode())) nodes.push(node);
  return nodes;
}

export function sameReadingNodes(
  before: readonly unknown[],
  after: readonly unknown[]
): boolean {
  return (
    before.length === after.length &&
    before.every((node, index) => node === after[index])
  );
}

/** Owned by the diagnostic lifecycle, not the geometry effect or React memo. */
export function createReadingDomReuseAudit() {
  let baseline:
    | {
        documentId: string;
        revision: number;
        generation: number;
        theme: string;
        nodes: readonly unknown[];
      }
    | undefined;
  let result: { status: "pending" | "passed" | "failed"; count: number } = {
    status: "pending",
    count: 0,
  };
  return {
    observe(
      identity: { documentId: string; revision: number; generation: number },
      theme: string,
      capture: () => readonly unknown[]
    ) {
      if (
        baseline?.documentId !== identity.documentId ||
        baseline.revision !== identity.revision ||
        baseline.generation !== identity.generation
      ) {
        baseline = { ...identity, theme, nodes: capture() };
        result = { status: "pending", count: baseline.nodes.length };
      } else if (baseline.theme !== theme) {
        const nodes = capture();
        result = {
          status: sameReadingNodes(baseline.nodes, nodes) ? "passed" : "failed",
          count: nodes.length,
        };
        // Retain the original refs even after a failed comparison. Only a real
        // content generation can establish a new baseline, not a style commit.
        baseline.theme = theme;
      }
      return result;
    },
  };
}
