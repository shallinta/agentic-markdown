import type { ReadingLeaf } from "./reading-search-projection";
import type { ReadingSearchRegistry } from "./reading-search-registry";

// The reading consumer already limits itself to 100,000 elements. This is a
// separate explicit search allocation limit, not a truncated search result.
export const READING_SEARCH_NODES = 200000;
export const READING_SEARCH_UNITS = 8 * 1024 * 1024;
export interface ReadingDomSnapshot {
  leaves: ReadingLeaf[];
  texts: Map<number, Text>;
  textIds: WeakMap<Text, number>;
  segments: Map<number, string>;
  segmentIds: Map<string, number>;
  blocks: { element: HTMLElement; first: number; last: number }[];
}
export interface ReadingBlockCache {
  version: number;
  first: number;
  nodes: number;
  leaves: ReadingLeaf[];
  texts: Map<number, Text>;
  segments: Map<number, string>;
}
const blockTags = new Set([
  "P",
  "DIV",
  "BLOCKQUOTE",
  "PRE",
  "LI",
  "UL",
  "OL",
  "TABLE",
  "TR",
  "TD",
  "TH",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BR",
  "HR",
]);
const excluded = new Set([
  "reading-callout-icon",
  "reading-task-status",
  "reading-code-language",
  "reading-code-copy",
  "reading-code-status",
]);

/** Walk only privately registered consumer blocks. Each next() has finite node
 * work; Text payloads are charged before being read/copied. Query changes reuse
 * the completed snapshot and never call this walker. */
export function* collectReadingDom(
  root: HTMLElement,
  registry: ReadingSearchRegistry,
  cache = new WeakMap<HTMLElement, ReadingBlockCache>()
): Generator<void, ReadingDomSnapshot> {
  const version = registry.version;
  const leaves: ReadingLeaf[] = [],
    texts = new Map<number, Text>();
  const textIds = new WeakMap<Text, number>();
  const segments = new Map<number, string>(),
    segmentIds = new Map<string, number>();
  const blocks: ReadingDomSnapshot["blocks"] = [];
  let units = 0,
    nodes = 0,
    work = 0,
    id = 0;
  const boundary = () => {
    if (++units > READING_SEARCH_UNITS) throw Error("阅读查找输出超过预算");
    leaves.push({ id: id++, text: "", flow: "boundary" });
  };
  const rootIsBlock = registry.get(root)?.kind === "block";
  for (
    let element = rootIsBlock
      ? root
      : (root.firstElementChild as HTMLElement | null);
    element;
    element = rootIsBlock
      ? null
      : (element.nextElementSibling as HTMLElement | null)
  ) {
    const registration = registry.get(element);
    if (registration?.kind !== "block") throw Error("阅读正文登记尚未就绪");
    if (!root.contains(element)) throw Error("阅读正文已变化");
    const first = id;
    const cached = cache.get(element);
    if (cached?.version === registry.blockVersion(element)) {
      nodes += cached.nodes;
      if (nodes > READING_SEARCH_NODES) throw Error("阅读查找节点超过预算");
      for (const leaf of cached.leaves) {
        units += leaf.text.length + (leaf.flow === "boundary" ? 1 : 0);
        if (units > READING_SEARCH_UNITS) throw Error("阅读查找文字超过预算");
        const nextId = id++;
        leaves.push({ ...leaf, id: nextId });
        const text = cached.texts.get(leaf.id);
        if (text) {
          texts.set(nextId, text);
          textIds.set(text, nextId);
          const segment = cached.segments.get(leaf.id)!;
          segments.set(nextId, segment);
          segmentIds.set(segment, nextId);
        }
        if (++work >= 128) {
          work = 0;
          yield;
          if (registry.version !== version || !root.isConnected)
            throw Error("阅读正文已变化");
        }
      }
      blocks.push({ element, first, last: id });
      continue;
    }
    const startLeaf = leaves.length,
      startNodes = nodes;
    boundary();
    interface Frame {
      node: Node;
      entered: boolean;
      child: Node | null;
      pre: boolean;
      boundary: boolean;
      html: boolean;
      path: string;
      childIndex: number;
    }
    const stack: Frame[] = [
      {
        node: element,
        entered: false,
        child: null,
        pre: false,
        boundary: false,
        html: false,
        path: String(registration.id),
        childIndex: 0,
      },
    ];
    while (stack.length) {
      if (++work >= 128) {
        work = 0;
        yield;
        if (registry.version !== version || !root.isConnected)
          throw Error("阅读正文已变化");
      }
      const frame = stack[stack.length - 1];
      if (!frame.entered) {
        frame.entered = true;
        if (++nodes > READING_SEARCH_NODES) throw Error("阅读查找节点超过预算");
        if (frame.node.nodeType === 3) {
          const text = frame.node as Text;
          units += text.length;
          if (units > READING_SEARCH_UNITS) throw Error("阅读查找文字超过预算");
          texts.set(id, text);
          textIds.set(text, id);
          segments.set(id, frame.path);
          segmentIds.set(frame.path, id);
          leaves.push({
            id: id++,
            text: text.data,
            flow: frame.pre ? "pre" : "normal",
          });
          stack.pop();
          continue;
        }
        if (frame.node.nodeType !== 1) {
          stack.pop();
          continue;
        }
        const e = frame.node as HTMLElement;
        const owned = registry.get(e);
        if (owned?.kind === "image") {
          boundary();
          frame.boundary = true;
          frame.child = owned.alt;
          // The dedicated alt span is the only visible text owned by images.
          if (!frame.child) {
            boundary();
            stack.pop();
          }
          continue;
        }
        if (
          !frame.html &&
          (e.tagName === "BUTTON" ||
            e.getAttribute("role") === "status" ||
            [...excluded].some((name) => e.classList.contains(name)))
        ) {
          stack.pop();
          continue;
        }
        if (
          !frame.html &&
          (e.classList.contains("reading-image") ||
            e.classList.contains("reading-html")) &&
          !owned
        )
          throw Error("阅读动态正文尚未就绪");
        frame.html ||= owned?.kind === "html";
        frame.pre ||=
          e.tagName === "PRE" ||
          (!frame.html && e.classList.contains("whitespace-pre-wrap"));
        frame.boundary = blockTags.has(e.tagName);
        if (frame.boundary) boundary();
        frame.child = e.firstChild;
      } else if (frame.child) {
        const child = frame.child;
        // Image's sole child is an explicitly owned alt, not its next sibling.
        frame.child =
          registry.get(frame.node as HTMLElement)?.kind === "image"
            ? null
            : child.nextSibling;
        stack.push({
          node: child,
          entered: false,
          child: null,
          pre: frame.pre,
          boundary: false,
          html: frame.html,
          path: `${frame.path}/${frame.childIndex++}`,
          childIndex: 0,
        });
      } else {
        if (frame.boundary) boundary();
        stack.pop();
      }
    }
    boundary();
    blocks.push({ element, first, last: id });
    const blockLeaves: ReadingLeaf[] = [],
      blockTexts = new Map<number, Text>();
    const blockSegments = new Map<number, string>();
    for (let i = startLeaf; i < leaves.length; i++) {
      const leaf = leaves[i];
      blockLeaves.push(leaf);
      const text = texts.get(leaf.id);
      if (text) blockTexts.set(leaf.id, text);
      const segment = segments.get(leaf.id);
      if (segment) blockSegments.set(leaf.id, segment);
      if (++work >= 128) {
        work = 0;
        yield;
        if (registry.version !== version) throw Error("阅读正文已变化");
      }
    }
    cache.set(element, {
      version: registry.blockVersion(element),
      first,
      nodes: nodes - startNodes,
      leaves: blockLeaves,
      texts: blockTexts,
      segments: blockSegments,
    });
  }
  if (version !== registry.version) throw Error("阅读正文已变化");
  return { leaves, texts, textIds, segments, segmentIds, blocks };
}
