import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import type { ReadingSearchRegistry } from "./reading-search-registry";

const richBytes = 256 * 1024;
const maxNodes = 32768;
const htmlNamespace = "http://www.w3.org/1999/xhtml";
const richTags = new Set("p h1 h2 h3 h4 h5 h6 blockquote ol ul li em strong del code pre br hr table thead tbody tr th td".split(" "));
const blocks = new Set("div p h1 h2 h3 h4 h5 h6 blockquote ol ul li pre table tr".split(" "));
const excludedClasses = "reading-code-language reading-code-copy reading-code-status reading-callout-icon reading-task-status".split(" ");
const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

type SelectionRange = Pick<Range, "startContainer" | "startOffset" | "endContainer" | "endOffset" | "intersectsNode">;
type ReadingCopyRegistry = Pick<ReadingSearchRegistry, "get">;

function topChild(root: Node, endpoint: Node, offset: number, end: boolean): Node | null {
  if (root === endpoint) return root.childNodes.item(offset);
  let child: Node | null = endpoint;
  while (child?.parentNode && child.parentNode !== root) child = child.parentNode;
  return end ? child?.nextSibling ?? null : child;
}

/** Project only the clipped, audited range. Nothing from the page is serialized as markup. */
export function projectReadingSelection(root: HTMLElement, range: SelectionRange, registry?: ReadingCopyRegistry): { text: string; html?: string } | undefined {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined;
  const start = topChild(root, range.startContainer, range.startOffset, false);
  const stop = topChild(root, range.endContainer, range.endOffset, true);
  const textParts: string[] = [];
  let htmlParts: string[] | undefined = [];
  let nodes = 0, units = 0, htmlUnits = 0;
  let pending: "" | " " | "\t" | "\n" = "";
  const rich = (value: string) => {
    if (!htmlParts) return;
    htmlUnits += value.length;
    if (htmlUnits > richBytes) htmlParts = undefined;
    else htmlParts.push(value);
  };
  const separator = (value: " " | "\t" | "\n") => {
    if (textParts.length && (!pending || value === "\n" || pending === " ")) pending = value;
  };
  const plain = (value: string) => {
    if (!value) return;
    units += pending.length + value.length;
    if (units > MAX_DOCUMENT_BYTES) throw Error("copy text budget");
    if (pending) textParts.push(pending);
    pending = "";
    textParts.push(value);
  };
  const visit = (node: Node, literal: boolean, depth: number): void => {
    if (++nodes > maxNodes || depth > 128)
      throw Error("copy traversal budget");
    if (!range.intersectsNode(node)) return;
    if (node.nodeType === 3) {
      const leaf = node as Text;
      const from = node === range.startContainer ? range.startOffset : 0;
      const to = node === range.endContainer ? range.endOffset : leaf.length;
      if (to - from > MAX_DOCUMENT_BYTES) throw Error("copy leaf budget");
      const value = leaf.substringData(from, Math.max(0, to - from));
      if (htmlParts && value.length <= richBytes - htmlUnits)
        rich(value.replace(/[&<>]/g, (character) => entities[character]));
      else if (value) htmlParts = undefined;
      if (literal) plain(value);
      else {
        const visible = value.replace(/[\t\n\f\r ]+/g, " ");
        if (visible.startsWith(" ")) separator(" ");
        plain(visible.replace(/^ | $/g, ""));
        if (visible.endsWith(" ")) separator(" ");
      }
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as HTMLElement;
    const tag = element.localName;
    const markup = richTags.has(tag);
    if (element.namespaceURI !== htmlNamespace || (!markup && tag !== "div" && tag !== "span") ||
        element.hidden || element.getAttribute("role") === "status" ||
        excludedClasses.some(name => element.classList.contains(name))) return;
    const image = registry?.get(element);
    if (image?.kind === "image") {
      if (image.alt) visit(image.alt, literal, depth + 1);
      return;
    }
    if (tag === "br" || tag === "hr") {
      plain("\n");
      rich(`<${tag}>`);
      return;
    }
    if (blocks.has(tag)) separator("\n");
    if (markup) rich(`<${tag}>`);
    const preserve = literal || tag === "pre" || element.classList.contains("whitespace-pre-wrap");
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, preserve, depth + 1);
    if (markup) rich(`</${tag}>`);
    if (blocks.has(tag)) separator("\n");
    else if (tag === "td" || tag === "th") separator("\t");
  };
  try {
    for (let node = start; node && node !== stop; node = node.nextSibling) visit(node, false, 0);
    const text = textParts.join("");
    const bytes = new TextEncoder();
    if (!text || bytes.encode(text).length > MAX_DOCUMENT_BYTES) return undefined;
    const html = htmlParts?.join("");
    return html && bytes.encode(html).length <= richBytes ? { text, html } : { text };
  } catch {
    return undefined;
  }
}

function nativeTextTarget(target: EventTarget | null): boolean {
  return target !== null && target instanceof Element && !!target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])");
}

/** Intercept only an actual system copy of the audited reading article. */
export function copyReadingSelection(event: ClipboardEvent, article: HTMLElement, registry?: ReadingCopyRegistry): "ignored" | "rich" | "plain" | "failed" {
  const document = article.ownerDocument;
  if (!event.isTrusted || event.defaultPrevented || !article.isConnected || article.hidden ||
      nativeTextTarget(event.target) || nativeTextTarget(document.activeElement)) return "ignored";
  const selection = document.getSelection();
  if (selection?.rangeCount !== 1 || selection.isCollapsed) return "ignored";
  const original = selection.getRangeAt(0);
  if (!original.intersectsNode(article)) return "ignored";
  const range = original.cloneRange();
  if (!article.contains(range.startContainer)) range.setStart(article, 0);
  if (!article.contains(range.endContainer)) range.setEnd(article, article.childNodes.length);
  if (range.collapsed) return "ignored";

  event.preventDefault();
  const data = event.clipboardData;
  const selected = data && projectReadingSelection(article, range, registry);
  if (!data || !selected) return "failed";
  try {
    data.clearData();
    data.setData("text/plain", selected.text);
  } catch {
    return "failed";
  }
  if (selected.html === undefined) return "plain";
  try {
    data.setData("text/html", selected.html);
    return "rich";
  } catch {
    try {
      data.clearData("text/html");
      return "plain";
    } catch {
      return "failed";
    }
  }
}
