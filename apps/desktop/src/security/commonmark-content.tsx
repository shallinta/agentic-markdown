import { createElement, type ReactNode } from "react";

import type { parseCanonicalMarkdown } from "../client/canonical-parser";
import type { LocalImages } from "../client/local-images";
import { ReadingImage } from "../components/reading-image";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "../shared/local-images";

type Tree = ReturnType<typeof parseCanonicalMarkdown>;
type Node = Tree | Tree["children"][number];

/** No HTML input API, arbitrary props, URL attributes or resource-bearing elements. */
export function commonmarkContent(
  tree: Tree,
  source: string,
  images?: LocalImages
): ReactNode {
  let work = 0;
  let definitionWork = 0;
  const definitions = new Map<string, string>();
  function collect(node: Node, depth = 0) {
    if (++definitionWork > 100000 || depth > 128)
      throw Error("Presentation budget");
    if (
      node.type === "definition" &&
      !definitions.has(node.identifier.toUpperCase())
    )
      definitions.set(node.identifier.toUpperCase(), node.url);
    if ("children" in node)
      for (const child of node.children) collect(child, depth + 1);
  }
  const raw = (node: Node) => {
    const from = node.position?.start.offset,
      to = node.position?.end.offset;
    if (
      from === undefined ||
      to === undefined ||
      from < 0 ||
      to < from ||
      to > source.length
    )
      throw Error("Missing source range");
    return source.slice(from, to);
  };
  const render = (node: Node, depth: number, key: number): ReactNode => {
    if (++work > 100000 || depth > 128) throw Error("Presentation budget");
    const children = () =>
      "children" in node
        ? node.children.map((child, index) => render(child, depth + 1, index))
        : [];
    switch (node.type) {
      case "text":
        return node.value;
      case "root":
        return children();
      case "paragraph":
        return (
          <p key={key} className="my-3 leading-7">
            {children()}
          </p>
        );
      case "heading":
        return createElement(
          ["h1", "h2", "h3", "h4", "h5", "h6"][node.depth - 1] ?? "p",
          { key, className: "my-4 text-xl font-semibold leading-relaxed" },
          children()
        );
      case "blockquote":
        return (
          <blockquote
            key={key}
            className="bg-muted/50 text-muted-foreground my-4 border-l-4 px-4 py-1"
          >
            {children()}
          </blockquote>
        );
      case "list":
        return node.ordered ? (
          <ol
            key={key}
            start={Number.isSafeInteger(node.start) ? node.start! : 1}
            className="my-3 list-decimal pl-7"
          >
            {children()}
          </ol>
        ) : (
          <ul key={key} className="my-3 list-disc pl-7">
            {children()}
          </ul>
        );
      case "listItem":
        return <li key={key}>{children()}</li>;
      case "emphasis":
        return <em key={key}>{children()}</em>;
      case "strong":
        return <strong key={key}>{children()}</strong>;
      case "inlineCode":
        return (
          <code key={key} className="bg-muted rounded px-1 font-mono">
            {node.value}
          </code>
        );
      case "break":
        return <br key={key} />;
      case "thematicBreak":
        return <hr key={key} className="my-5 w-full border-t" />;
      case "definition":
        return null;
      case "link":
      case "linkReference":
        return (
          <span
            key={key}
            className="underline decoration-dotted"
            title="链接打开尚未接入"
          >
            {children()}
          </span>
        );
      case "image":
      case "imageReference":
        if (images) {
          const reference =
            node.type === "image"
              ? node.url
              : definitions.get(node.identifier.toUpperCase());
          if (reference !== undefined)
            return (
              <ReadingImage
                key={key}
                reference={reference}
                alt={node.alt || ""}
                images={images}
              />
            );
        }
        return (
          <span key={key} className="text-muted-foreground">
            [图片尚未加载：{node.alt || "无替代文字"}]
          </span>
        );
      case "html":
        return (
          <code
            key={key}
            title="HTML 尚未开放，按原文显示"
            className="bg-muted break-words whitespace-pre-wrap"
          >
            {raw(node)}
          </code>
        );
      case "code":
        return (
          <div key={key} className="bg-muted my-4 rounded p-3">
            <p className="text-muted-foreground text-xs">
              代码块原文（完整代码呈现待后续接入）
            </p>
            <pre className="font-mono break-words whitespace-pre-wrap">
              {raw(node)}
            </pre>
          </div>
        );
      default:
        return (
          <code
            key={key}
            title="未支持结构，按原文显示"
            className="break-words whitespace-pre-wrap"
          >
            {raw(node)}
          </code>
        );
    }
  };
  try {
    if (images) collect(tree);
    return tree.children.map((node, index) => {
      if (node.type === "definition") return null;
      raw(node);
      return (
        <div
          key={index}
          data-reading-from={node.position!.start.offset}
          data-reading-to={node.position!.end.offset}
        >
          {render(node, 0, index)}
        </div>
      );
    });
  } catch {
    return (
      <div>
        <p role="status">阅读结构无法安全呈现，已保留完整原文。</p>
        <pre className="break-words whitespace-pre-wrap">{source}</pre>
      </div>
    );
  }
}

const tags = new Set([
  "div",
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "ol",
  "ul",
  "li",
  "em",
  "strong",
  "code",
  "br",
  "hr",
  "span",
  "pre",
  "img",
]);
const classes: Record<string, readonly string[]> = {
  p: ["my-3 leading-7", "text-muted-foreground text-xs"],
  h1: ["my-4 text-xl font-semibold leading-relaxed"],
  h2: ["my-4 text-xl font-semibold leading-relaxed"],
  h3: ["my-4 text-xl font-semibold leading-relaxed"],
  h4: ["my-4 text-xl font-semibold leading-relaxed"],
  h5: ["my-4 text-xl font-semibold leading-relaxed"],
  h6: ["my-4 text-xl font-semibold leading-relaxed"],
  blockquote: ["bg-muted/50 text-muted-foreground my-4 border-l-4 px-4 py-1"],
  ol: ["my-3 list-decimal pl-7"],
  ul: ["my-3 list-disc pl-7"],
  code: [
    "bg-muted rounded px-1 font-mono",
    "bg-muted break-words whitespace-pre-wrap",
    "break-words whitespace-pre-wrap",
  ],
  hr: ["my-5 w-full border-t"],
  span: [
    "underline decoration-dotted",
    "text-muted-foreground",
    "reading-image",
  ],
  div: ["bg-muted my-4 rounded p-3"],
  pre: [
    "font-mono break-words whitespace-pre-wrap",
    "break-words whitespace-pre-wrap",
  ],
};
export function isControlledReadingElement(element: {
  namespaceURI: string | null;
  localName: string;
  attributes: Iterable<{ name: string; value: string }>;
}): boolean {
  if (element.localName === "img") {
    const attributes = new Map(
      [...element.attributes].map(({ name, value }) => [name, value])
    );
    const width = Number(attributes.get("width")),
      height = Number(attributes.get("height"));
    const src = attributes.get("src") ?? "";
    return (
      element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
      [...attributes.keys()].every((name) =>
        ["src", "alt", "width", "height", "decoding", "draggable"].includes(
          name
        )
      ) &&
      attributes.get("decoding") === "async" &&
      attributes.get("draggable") === "false" &&
      Number.isSafeInteger(width) &&
      width > 0 &&
      Number.isSafeInteger(height) &&
      height > 0 &&
      width * height <= MAX_IMAGE_PIXELS &&
      src.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 23 &&
      /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(src)
    );
  }
  return (
    element.namespaceURI === "http://www.w3.org/1999/xhtml" &&
    tags.has(element.localName) &&
    [...element.attributes].every((attribute) => {
      if (attribute.name === "class")
        return classes[element.localName]?.includes(attribute.value) === true;
      if (attribute.name === "title")
        return (
          (element.localName === "span" &&
            attribute.value === "链接打开尚未接入") ||
          (element.localName === "code" &&
            ["HTML 尚未开放，按原文显示", "未支持结构，按原文显示"].includes(
              attribute.value
            ))
        );
      if (attribute.name === "role")
        return element.localName === "p" && attribute.value === "status";
      if (attribute.name === "start")
        return (
          element.localName === "ol" &&
          /^-?\d+$/.test(attribute.value) &&
          Number.isSafeInteger(Number(attribute.value))
        );
      return (
        element.localName === "div" &&
        ["data-reading-from", "data-reading-to"].includes(attribute.name) &&
        /^\d+$/.test(attribute.value) &&
        Number.isSafeInteger(Number(attribute.value))
      );
    })
  );
}
/** Audit the mounted controlled content, never the surrounding application UI. */
export function auditReadingContent(root: Element): {
  safe: boolean;
  elements: number;
} {
  const elements = [...root.querySelectorAll("*")];
  const safe = elements.every(isControlledReadingElement);
  return { safe, elements: elements.length };
}
