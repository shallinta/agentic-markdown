import createDOMPurify from "dompurify";

export const CONTENT_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "span",
];
/** Inspect the entire generated subtree, never authorize input via removed[]. */
export function auditContentDOM(root: Node): boolean {
  for (const node of root.childNodes) {
    if (node.nodeType === 3) continue;
    if (node.nodeType !== 1) return false;
    const element = node as Element;
    if (
      element.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      !CONTENT_TAGS.includes(element.localName) ||
      element.attributes.length ||
      !auditContentDOM(element)
    )
      return false;
  }
  return true;
}
export function createSafeContent(window: Window & typeof globalThis) {
  const purify = createDOMPurify(window);
  return (
    source: string
  ): {
    fragment: DocumentFragment;
    mode: "sanitized" | "source";
    reason: string;
  } => {
    const fallback = (reason: string) => {
      const fragment = window.document.createDocumentFragment();
      fragment.append(window.document.createTextNode(source));
      return { fragment, mode: "source" as const, reason };
    };
    if (!purify.isSupported) return fallback("净化器不受支持，完整保留源码");
    try {
      const fragment = purify.sanitize(source, {
        ALLOWED_TAGS: CONTENT_TAGS,
        ALLOWED_ATTR: [],
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: false,
        RETURN_DOM_FRAGMENT: true,
      });
      if (!auditContentDOM(fragment))
        return fallback("输出结构不满足有限白名单，完整保留源码");
      const container = window.document.createElement("div");
      container.append(fragment.cloneNode(true));
      // Extra conservative fidelity policy for this slice only. No reparsing,
      // no input insertion, and equality never replaces the audit above.
      if (container.innerHTML !== source)
        return fallback("净化或格式规范化改变了输入，本片保守显示完整源码");
      return {
        fragment,
        mode: "sanitized",
        reason: "有限结构净化与零属性审计通过",
      };
    } catch {
      return fallback("净化失败，完整保留源码");
    }
  };
}
export function blockContentDefaults(host: HTMLElement): () => void {
  const stop = (event: Event) => {
    event.preventDefault();
  };
  const events = ["click", "auxclick", "submit", "dragstart"];
  for (const name of events) host.addEventListener(name, stop, true);
  return () => {
    for (const name of events) host.removeEventListener(name, stop, true);
  };
}
