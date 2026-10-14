import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

export interface CodeCopyTarget {
  kind: "FencedCode" | "CodeBlock";
  from: number;
  to: number;
}

export function codeCopyTarget(
  view: EditorView,
  x: number,
  y: number
): CodeCopyTarget | null {
  const position = view.posAtCoords({ x, y });
  if (position === null) return null;
  let node = syntaxTree(view.state).resolveInner(position, 1);
  while (node.name !== "FencedCode" && node.name !== "CodeBlock") {
    if (!node.parent) return null;
    node = node.parent;
  }
  if (!syntaxTreeAvailable(view.state, node.to)) return null;
  return {
    kind: node.name,
    from: node.from,
    to: node.to,
  };
}

/** Map both editor endpoints in one cooperative forward pass, only on prepare. */
export function* rawCodeTarget(
  raw: string,
  target: CodeCopyTarget
): Generator<void, CodeCopyTarget> {
  let editor = 0,
    cursor = 0,
    from = 0,
    units = 0;
  while (editor < target.to && cursor < raw.length) {
    if (editor === target.from) from = cursor;
    if (raw[cursor] === "\r" && raw[cursor + 1] === "\n") cursor++;
    cursor++;
    editor++;
    if (++units === 4096) {
      units = 0;
      yield;
    }
  }
  return { kind: target.kind, from, to: cursor };
}

/** Only preparation uses this cooperative traversal; selection/input never does. */
export function* findCodeCopyValue(
  root: unknown,
  raw: string,
  target: CodeCopyTarget
): Generator<void, string | null> {
  interface Node {
    type?: unknown;
    value?: unknown;
    lang?: unknown;
    meta?: unknown;
    position?: { start?: { offset?: unknown }; end?: { offset?: unknown } };
    children?: unknown;
  }
  const stack: { node: Node; entered: boolean; index: number }[] = [];
  if (!root || typeof root !== "object") return null;
  stack.push({ node: root, entered: false, index: 0 });
  let found: string | null = null,
    count = 0,
    operations = 0,
    characters = 0;
  while (stack.length) {
    if (++operations > 128) {
      operations = 0;
      characters = 0;
      yield;
    }
    const frame = stack[stack.length - 1],
      n = frame.node;
    if (!frame.entered) {
      frame.entered = true;
      const start = n.position?.start?.offset,
        end = n.position?.end?.offset;
      const valid =
        typeof start === "number" &&
        Number.isSafeInteger(start) &&
        typeof end === "number" &&
        Number.isSafeInteger(end) &&
        start >= 0 &&
        end >= start &&
        end <= raw.length;
      if (valid && (start > target.from || end < target.to)) {
        stack.pop();
        continue;
      }
      if (n.type === "code") {
        let matches = valid && end === target.to && typeof n.value === "string";
        if (target.kind === "FencedCode")
          matches = matches && start === target.from;
        else {
          matches =
            matches && !n.lang && !n.meta && (start as number) <= target.from;
          if (matches)
            for (let p = start as number; p < target.from; p++) {
              if (++characters > 4096) {
                operations = 0;
                characters = 0;
                yield;
              }
              if (raw[p] !== " " && raw[p] !== "\t") {
                matches = false;
                break;
              }
            }
        }
        if (matches) {
          found = n.value as string;
          if (++count > 1) return null;
        }
        stack.pop();
        continue;
      }
    }
    if (!Array.isArray(n.children) || frame.index >= n.children.length) {
      stack.pop();
      continue;
    }
    const child: unknown = n.children[frame.index++];
    if (child && typeof child === "object")
      stack.push({ node: child, entered: false, index: 0 });
  }
  return found;
}
