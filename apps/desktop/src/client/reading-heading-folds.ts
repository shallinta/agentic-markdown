import type { ReadingHeadingProjection } from "./reading-heading-structure";
import type { ReadingSearchRegistry } from "./reading-search-registry";

const ownedBlocks = new WeakSet<object>();
const ownedButtons = new WeakSet<object>();
export const isOwnedReadingFoldBlock = (element: object) =>
  ownedBlocks.has(element);
export const isOwnedReadingFoldButton = (element: object) =>
  ownedButtons.has(element);

/** Window-local presentation only. Never changes the search registry or document. */
export function createReadingHeadingFolds(
  projection: ReadingHeadingProjection,
  registry: ReadingSearchRegistry
) {
  const blocks = new Map<number, HTMLElement>();
  const buttons = new Map<number, HTMLButtonElement>();
  const collapsed = new Set<number>();
  const listeners = new Set<() => void>();
  let article: HTMLElement | null = null;
  let ordered: HTMLElement[] = [];
  let visibleBlocks: HTMLElement[] = [];
  let revision = 0;
  let ordinals = new WeakMap<HTMLElement, number>();
  let sections = new Map(
    projection.sections.map((section) => [section.headingId, section])
  );
  const live = () => !!article?.isConnected;
  const apply = () => {
    const changes = new Int32Array(ordered.length + 1);
    for (const section of projection.sections) {
      const folded = collapsed.has(section.headingId);
      const button = buttons.get(section.headingId)!;
      if (button.getAttribute("aria-expanded") !== String(!folded))
        button.setAttribute("aria-expanded", String(!folded));
      const label = folded ? "展开章节" : "折叠章节";
      if (button.getAttribute("aria-label") !== label)
        button.setAttribute("aria-label", label);
      if (folded) {
        changes[section.bodyStart]++;
        changes[section.end]--;
      }
    }
    visibleBlocks = [];
    let depth = 0;
    for (let index = 0; index < ordered.length; index++) {
      depth += changes[index];
      if (ordered[index].hidden !== depth > 0)
        ordered[index].hidden = depth > 0;
      if (!depth) visibleBlocks.push(ordered[index]);
    }
    revision++;
    for (const listener of listeners) listener();
  };
  const ordinal = (node: Node): number => {
    let element =
      node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
    while (element && element.parentElement !== article)
      element = element.parentElement;
    if (element?.parentElement !== article) return -1;
    const index = ordinals.get(element);
    const registration = registry.get(element);
    return index !== undefined &&
      registration?.kind === "block" &&
      registration.id === projection.blocks[index].id
      ? index
      : -1;
  };
  return {
    registerBlock(id: number, element: HTMLElement) {
      blocks.set(id, element);
      ownedBlocks.add(element);
      return () => {
        if (blocks.get(id) === element) {
          blocks.delete(id);
          article = null;
        }
        ownedBlocks.delete(element);
      };
    },
    registerButton(id: number, element: HTMLButtonElement) {
      buttons.set(id, element);
      ownedButtons.add(element);
      return () => {
        if (buttons.get(id) === element) {
          buttons.delete(id);
          article = null;
        }
        ownedButtons.delete(element);
      };
    },
    bind(element: HTMLElement | null): boolean {
      article = null;
      ordered = [];
      visibleBlocks = [];
      ordinals = new WeakMap();
      sections.clear();
      revision++;
      if (!element) return true;
      if (element.children.length !== projection.blocks.length) return false;
      const next = projection.blocks.map((block) => blocks.get(block.id));
      if (
        next.some(
          (block, index) =>
            !block ||
            block !== element.children[index] ||
            block.getAttribute("data-reading-from") !==
              String(projection.blocks[index].from) ||
            block.getAttribute("data-reading-to") !==
              String(projection.blocks[index].to) ||
            registry.get(block)?.kind !== "block" ||
            (registry.get(block) as { id: number }).id !==
              projection.blocks[index].id
        )
      )
        return false;
      if (
        projection.sections.some((section) => {
          const block = next[section.headingBlock];
          const button = buttons.get(section.headingId);
          return (
            !block ||
            button?.parentElement !== block ||
            block.firstElementChild !== button ||
            block.children.length !== 2 ||
            block.lastElementChild?.localName !== `h${section.depth}`
          );
        })
      )
        return false;
      article = element;
      ordered = next as HTMLElement[];
      ordered.forEach((block, index) => ordinals.set(block, index));
      sections = new Map(
        projection.sections.map((section) => [section.headingId, section])
      );
      apply();
      return true;
    },
    toggle(id: number) {
      if (!live() || !buttons.has(id) || !sections.has(id)) return;
      if (collapsed.has(id)) collapsed.delete(id);
      else collapsed.add(id);
      apply();
    },
    presentation(): { revision: number; visible?: readonly HTMLElement[] } {
      return {
        revision,
        ...(live() && collapsed.size ? { visible: visibleBlocks } : {}),
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reveal(range: Range) {
      if (!live() || !collapsed.size) return;
      const start = ordinal(range.startContainer),
        end = ordinal(range.endContainer);
      if (start < 0 || end < 0) return;
      let changed = false;
      for (const id of collapsed) {
        const section = sections.get(id)!;
        if (
          (start >= section.bodyStart && start < section.end) ||
          (end >= section.bodyStart && end < section.end)
        )
          changed = collapsed.delete(section.headingId) || changed;
      }
      if (changed) apply();
    },
    visible(range: Range): boolean {
      if (!live()) return false;
      const start = ordinal(range.startContainer),
        end = ordinal(range.endContainer);
      return (
        start >= 0 && end >= 0 && !ordered[start].hidden && !ordered[end].hidden
      );
    },
  };
}
export type ReadingHeadingFolds = ReturnType<typeof createReadingHeadingFolds>;
