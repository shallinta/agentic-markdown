import type { Text } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { ReferenceNormalizer } from "./reference-normalizer";
import { decodeTextCharacter } from "./text-character-presentation";

type Work<T> = Generator<number, T>;
export function* calloutNonblank(
  doc: Text,
  from: number,
  to: number
): Work<boolean> {
  for (let at = from; at < to;) {
    const end = Math.min(to, at + 4096),
      value = doc.sliceString(at, end);
    yield end - at;
    if (/\S/.test(value)) return true;
    at = end;
  }
  return false;
}
function* labelText(
  doc: Text,
  node: SyntaxNode,
  from: number,
  to: number
): Work<string> {
  let value = "",
    at = from;
  yield 0;
  for (let child = node.firstChild; child;) {
    if (child.name === "QuoteMark" && child.from >= from && child.to <= to) {
      for (; at < child.from;) {
        const end = Math.min(child.from, at + 4096);
        value += doc.sliceString(at, end);
        yield end - at;
        at = end;
      }
      at = child.to;
    }
    yield 0;
    child = child.nextSibling;
  }
  for (; at < to;) {
    const end = Math.min(to, at + 4096);
    value += doc.sliceString(at, end);
    yield end - at;
    at = end;
  }
  return value;
}
const longestLabels = new WeakMap<ReadonlySet<string>, number>();
function* referenceMatches(
  doc: Text,
  node: SyntaxNode,
  from: number,
  to: number,
  definitions: ReadonlySet<string>
): Work<boolean> {
  let maximum = longestLabels.get(definitions);
  if (maximum === undefined) {
    maximum = 0;
    for (const label of definitions) {
      maximum = Math.max(maximum, label.length);
      yield 0;
    }
    longestLabels.set(definitions, maximum);
  }
  if (!maximum) return false;
  const normalizer = new ReferenceNormalizer(maximum);
  let at = from;
  function* consume(end: number): Work<boolean> {
    while (at < end) {
      const unit = doc.sliceString(at, ++at);
      yield 1;
      const cost = normalizer.push(unit);
      if (cost) yield cost;
      if (normalizer.overflow) return false;
    }
    return true;
  }
  yield 0;
  for (let child = node.firstChild; child;) {
    if (child.name === "QuoteMark" && child.from >= from && child.to <= to) {
      if (!(yield* consume(child.from))) return false;
      at = child.to;
    }
    yield 0;
    child = child.nextSibling;
  }
  if (!(yield* consume(to))) return false;
  yield normalizer.finish();
  return !normalizer.overflow && definitions.has(normalizer.value);
}
function* linkLabel(
  doc: Text,
  node: SyntaxNode,
  definitions: ReadonlySet<string>
): Work<{ from: number; to: number } | null> {
  let close: number | undefined,
    reference: SyntaxNode | undefined,
    inline = false;
  yield 0;
  for (let child = node.firstChild; child;) {
    if (child.name === "LinkMark") {
      const mark = doc.sliceString(child.from, child.to);
      yield child.to - child.from;
      if (mark === "]" && close === undefined) close = child.from;
      if (mark === "(") inline = true;
    }
    if (child.name === "LinkLabel") reference = child;
    yield 0;
    child = child.nextSibling;
  }
  if (close === undefined) return null;
  const from = node.from + 1,
    to = close;
  if (inline) return { from, to };
  const matched =
    reference && reference.to - reference.from > 2
      ? yield* referenceMatches(
          doc,
          reference,
          reference.from + 1,
          reference.to - 1,
          definitions
        )
      : yield* referenceMatches(doc, node, from, to, definitions);
  return matched ? { from, to } : null;
}
interface Frame {
  child: SyntaxNode | null;
  at: number;
  to: number;
  subsup: boolean;
}
/** Visible whitespace in confirmed SubSup gaps, yielded through the existing owner budget. */
function* visibleGap(
  doc: Text,
  from: number,
  to: number,
  subsup: boolean
): Work<boolean> {
  if (!subsup) return yield* calloutNonblank(doc, from, to);
  for (let at = from; at < to;) {
    const char = doc.sliceString(at, ++at);
    yield 1;
    if (char === "\\" && at < to) {
      const next = doc.sliceString(at, ++at);
      yield 1;
      if (next === " " || next === "\t") continue;
      return true;
    }
    if (/\S/.test(char)) return true;
  }
  return false;
}
/** Iterative semantic inline traversal; syntax shells are not visible content. */
export function* calloutInlineBody(
  doc: Text,
  root: SyntaxNode,
  start: number,
  definitions: ReadonlySet<string>
): Work<boolean> {
  yield 0;
  const frames: Frame[] = [
    { child: root.firstChild, at: start, to: root.to, subsup: false },
  ];
  while (frames.length) {
    const frame = frames[frames.length - 1],
      child = frame.child;
    if (!child || child.from >= frame.to) {
      if (yield* visibleGap(doc, frame.at, frame.to, frame.subsup)) return true;
      frames.pop();
      yield 0;
      continue;
    }
    yield 0;
    frame.child = child.nextSibling;
    if (child.to <= frame.at) continue;
    if (
      yield* visibleGap(
        doc,
        frame.at,
        Math.min(child.from, frame.to),
        frame.subsup
      )
    )
      return true;
    frame.at = Math.max(frame.at, child.to);
    if (
      [
        "InlineCode",
        "QuoteMark",
        "LinkMark",
        "LinkLabel",
        "URL",
        "LinkTitle",
        "EmphasisMark",
        "StrikethroughMark",
        "HighlightMark",
        "SubscriptMark",
        "SuperscriptMark",
        "HardBreak",
        "HeaderMark",
      ].includes(child.name)
    )
      continue;
    if (["Image", "HTMLTag", "Autolink"].includes(child.name)) return true;
    if (child.name === "Entity" || child.name === "Escape") {
      const raw = yield* labelText(doc, child, child.from, child.to);
      if (decodeTextCharacter(child.name, raw)?.trim()) return true;
      continue;
    }
    let from = child.from,
      to = child.to;
    if (child.name === "Link") {
      const label = yield* linkLabel(doc, child, definitions);
      if (!label) return true;
      from = label.from;
      to = label.to;
    }
    yield 0;
    frames.push({
      child: child.firstChild,
      at: from,
      to,
      subsup:
        frame.subsup ||
        child.name === "Subscript" ||
        child.name === "Superscript",
    });
  }
  return false;
}
