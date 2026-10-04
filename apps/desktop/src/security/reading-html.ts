import { CONTENT_TAGS, createSafeContent } from "./safe-content";

// Adjustable synchronous-work protection, not a timing or RSS guarantee.
export const MAX_HTML_BLOCK_SOURCE = 32 * 1024;
export const MAX_HTML_DOCUMENT_SOURCE = 128 * 1024;
export const MAX_HTML_DOCUMENT_BLOCKS = 256;
export const MAX_HTML_NODES = 2048;
export const MAX_HTML_DEPTH = 32;
const allowed = new Set(CONTENT_TAGS);
const voidTags = new Set(["br", "hr"]);

/** Pure lexical gate. Rejected resource-bearing input never reaches a DOM parser. */
export function preflightReadingHtml(source: string): string | null {
  if (source.length > MAX_HTML_BLOCK_SOURCE)
    return "HTML 块超过安全源长限制，保留原文";
  const stack: string[] = [];
  let cursor = 0;
  let nodes = 0;
  let tags = 0;
  while (cursor < source.length) {
    if (++nodes > MAX_HTML_NODES) return "HTML 块超过安全节点限制，保留原文";
    if (source[cursor] !== "<") {
      const next = source.indexOf("<", cursor);
      cursor = next === -1 ? source.length : next;
      continue;
    }
    const end = source.indexOf(">", cursor + 1);
    if (end === -1) return "HTML 标签不完整，保留原文";
    const token = source.slice(cursor, end + 1);
    const match = /^<(\/)?([a-z][a-z0-9]*)>$/.exec(token);
    if (!match || !allowed.has(match[2]))
      return "HTML 含不支持的标签、属性或写法，保留原文";
    const [, close, name] = match;
    tags++;
    if (close) {
      if (voidTags.has(name) || stack.pop() !== name)
        return "HTML 标签未完整配对，保留原文";
    } else if (!voidTags.has(name)) {
      stack.push(name);
      if (stack.length > MAX_HTML_DEPTH)
        return "HTML 块超过安全深度限制，保留原文";
    }
    cursor = end + 1;
  }
  return !tags || stack.length ? "HTML 标签未完整配对，保留原文" : null;
}

type Sanitizer = ReturnType<typeof createSafeContent>;
const sanitizers = new WeakMap<Window & typeof globalThis, Sanitizer>();
/** Fixed configuration, synchronous calls, no mutable hooks or user options. */
export function readingHtmlSanitizer(
  window: Window & typeof globalThis
): Sanitizer {
  let sanitizer = sanitizers.get(window);
  if (!sanitizer) {
    sanitizer = createSafeContent(window);
    sanitizers.set(window, sanitizer);
  }
  return sanitizer;
}
export type ReadingHtmlResult =
  | { mode: "sanitized"; fragment: DocumentFragment }
  | { mode: "source"; reason: string };

/** The injected seam verifies parser exclusion without substituting a fake DOM. */
export function prepareReadingHtml(
  source: string,
  sanitize: Sanitizer
): ReadingHtmlResult {
  const reason = preflightReadingHtml(source);
  if (reason) return { mode: "source", reason };
  try {
    const result = sanitize(source);
    if (result.mode === "source")
      return { mode: "source", reason: result.reason };
    let count = 0;
    const pending = [...result.fragment.childNodes].map((node) => ({
      node,
      depth: 1,
    }));
    while (pending.length) {
      const { node, depth } = pending.pop()!;
      if (++count > MAX_HTML_NODES || depth > MAX_HTML_DEPTH + 1)
        return {
          mode: "source",
          reason: "HTML 输出超过安全结构限制，保留原文",
        };
      for (const child of node.childNodes)
        pending.push({ node: child, depth: depth + 1 });
    }
    return { mode: "sanitized", fragment: result.fragment };
  } catch {
    return { mode: "source", reason: "HTML 净化失败，保留原文" };
  }
}
