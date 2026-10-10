import { commonmarkLanguage } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { LONG_LINE_UNITS, longLineProtection } from "./long-line-protection";

export type InlineFormat = "bold" | "italic" | "code";
const names = {
  bold: "StrongEmphasis",
  italic: "Emphasis",
  code: "InlineCode",
};
const markers = { bold: "**", italic: "*", code: "`" };
export const FORMAT_UNAVAILABLE = "当前位置或选区不支持此行内格式";

interface Plan {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
  validate?: { from: number; to: number; name: string; codeText?: string };
  container?: { from: number; to: number; name: string };
}

function ancestors(node: SyntaxNode | null) {
  const result: SyntaxNode[] = [];
  for (; node; node = node.parent) result.push(node);
  return result;
}

/** Plans only the current selections; it never advances EditorState or history. */
function computeInlineFormat(state: EditorState, kind: InlineFormat) {
  if (state.readOnly) return undefined;
  const tree = syntaxTree(state),
    plans: Plan[] = [];
  const protectedSpans = state.field(longLineProtection);
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.from);
    if (
      range.to > line.to ||
      tree.length < line.to ||
      protectedSpans.some((s) => s.from <= line.to && s.to >= line.from)
    )
      return undefined;
    let path = ancestors(tree.resolveInner(range.from, 1));
    // At an exclusive text-block end, right-biased resolution returns the
    // outside container. Borrow only that ending text block, never its ending
    // emphasis/code descendant (which would incorrectly unwrap outside it).
    if (
      range.empty &&
      !path.some(
        (n) =>
          n.name === "Paragraph" ||
          /^(ATXHeading[1-6]|SetextHeading[12])$/.test(n.name)
      )
    ) {
      const left = ancestors(tree.resolveInner(range.from, -1));
      if (left.some((n) => n.name === "HeaderMark")) return undefined;
      const text = left.find(
        (n) =>
          (n.name === "Paragraph" ||
            /^(ATXHeading[1-6]|SetextHeading[12])$/.test(n.name)) &&
          n.to === range.from
      );
      if (text && state.doc.lineAt(range.from).from < range.from)
        path = ancestors(text);
    }
    if (
      path.some((n) =>
        /^(FencedCode|CodeBlock|HTMLBlock|HTMLTag|Link|Image|Autolink)$/.test(
          n.name
        )
      )
    )
      return undefined;
    const block = path.find((n) => n.parent?.name === "Document");
    const container = {
      from: state.doc.lineAt(block?.from ?? line.from).from,
      to: state.doc.lineAt(block?.to ?? line.to).to,
      name: block?.name ?? "Paragraph",
    };
    if (
      tree.length < container.to ||
      (tree.length < state.doc.length && container.to >= tree.length) ||
      protectedSpans.some((s) => s.from < container.to && s.to > container.from)
    )
      return undefined;
    const same = path.find((n) => n.name === names[kind] && range.to <= n.to);
    if (same) {
      const first = same.firstChild,
        last = same.lastChild;
      const mark = kind === "code" ? "CodeMark" : "EmphasisMark";
      if (
        !first ||
        !last ||
        first.name !== mark ||
        last.name !== mark ||
        first === last ||
        same.from < line.from ||
        same.to > line.to
      )
        return undefined;
      const contentFrom = first.to,
        contentTo = last.from;
      if (
        !(
          range.empty &&
          range.from >= contentFrom &&
          range.from <= contentTo
        ) &&
        !(range.from === contentFrom && range.to === contentTo) &&
        !(range.from === same.from && range.to === same.to)
      )
        return undefined;
      const content = state.sliceDoc(contentFrom, contentTo);
      const position = (p: number) =>
        Math.max(0, Math.min(content.length, p - contentFrom));
      plans.push({
        from: same.from,
        to: same.to,
        insert: content,
        anchor: position(range.anchor),
        head: position(range.head),
        container,
      });
      continue;
    }
    const paragraph = path.find(
      (n) =>
        n.name === "Paragraph" ||
        /^ATXHeading[1-6]$/.test(n.name) ||
        /^SetextHeading[12]$/.test(n.name)
    );
    const emptyLine =
      !line.text.trim() && path.every((n) => n.name === "Document");
    if (!paragraph && !emptyLine) return undefined;
    if (paragraph && (range.from < paragraph.from || range.to > paragraph.to))
      return undefined;
    // This slice does not split or rewrite existing syntax, even a partial span.
    let structural = false;
    tree.iterate({
      from: range.from,
      to: range.to,
      enter(node) {
        if (
          /^(Emphasis|StrongEmphasis|InlineCode|Link|Image|Autolink|Escape|Entity|HTMLTag|HeaderMark|ListMark|QuoteMark)$/.test(
            node.name
          ) &&
          node.from < range.to &&
          node.to > range.from
        )
          structural = true;
      },
    });
    if (
      structural ||
      path.some((n) =>
        /^(Emphasis|StrongEmphasis|InlineCode|HeaderMark|ListMark|QuoteMark)$/.test(
          n.name
        )
      )
    )
      return undefined;
    const text = range.empty ? "文本" : state.sliceDoc(range.from, range.to);
    const before = state.sliceDoc(
      Math.max(line.from, range.from - 1),
      range.from
    );
    const after = state.sliceDoc(range.to, Math.min(line.to, range.to + 1));
    if (/[\\*_`]/.test(before + after)) return undefined;
    let delimiter = markers[kind],
      padding = "";
    if (kind === "code") {
      let max = 0;
      for (const match of text.matchAll(/`+/g))
        max = Math.max(max, match[0].length);
      delimiter = "`".repeat(max + 1);
      if (/^`|`$/.test(text) || (/^ .* $/.test(text) && /[^ ]/.test(text)))
        padding = " ";
    } else if (/^\s|\s$|[*_\\`]/u.test(text)) return undefined;
    const prefix = delimiter + padding,
      insert = prefix + text + padding + delimiter;
    const a = prefix.length,
      b = a + text.length;
    plans.push({
      from: range.from,
      to: range.to,
      insert,
      anchor: range.empty || range.anchor <= range.head ? a : b,
      head: range.empty || range.anchor <= range.head ? b : a,
      container,
      validate: {
        from: range.from,
        to: range.from + insert.length,
        name: names[kind],
        codeText: kind === "code" ? text : undefined,
      },
    });
  }
  const unique = new Map<string, Plan>();
  for (const p of plans) {
    const key = `${p.from}:${p.to}`;
    if (unique.has(key) && unique.get(key)!.insert !== p.insert)
      return undefined;
    unique.set(key, p);
  }
  const edits = [...unique.values()].sort((a, b) => a.from - b.from);
  for (let i = 1; i < edits.length; i++)
    if (edits[i].from < edits[i - 1].to) return undefined;
  const changes = state.changes(edits);
  const affected = new Map(
    plans
      .filter((p) => p.container)
      .map((p) => [`${p.container!.from}:${p.container!.to}`, p.container!])
  );
  // Aggregate synchronous work guard, not a document limit or performance SLO.
  if (
    [...affected.values()].reduce((sum, c) => sum + c.to - c.from, 0) +
      edits.reduce((sum, p) => sum + p.insert.length, 0) >
    LONG_LINE_UNITS
  )
    return undefined;
  const nextDoc = changes.apply(state.doc);
  for (const container of affected.values()) {
    const start = changes.mapPos(container.from, -1),
      end = changes.mapPos(container.to, 1);
    const local = nextDoc.sliceString(start, end);
    const parsed = commonmarkLanguage.parser.parse(local);
    if (
      parsed.topNode.firstChild?.name !== container.name ||
      parsed.topNode.firstChild?.nextSibling
    )
      return undefined;
    for (const p of plans)
      if (
        p.validate &&
        p.container?.from === container.from &&
        p.container.to === container.to
      ) {
        const from = changes.mapPos(p.from, -1) - start,
          to = from + p.insert.length;
        let found = false;
        parsed.iterate({
          from,
          to,
          enter(node) {
            if (
              node.name !== p.validate!.name ||
              node.from !== from ||
              node.to !== to
            )
              return;
            if (p.validate!.codeText !== undefined) {
              const first = node.node.firstChild,
                last = node.node.lastChild;
              if (first?.name !== "CodeMark" || last?.name !== "CodeMark")
                return;
              let decoded = local
                .slice(first.to, last.from)
                .replace(/\n/g, " ");
              if (
                decoded.startsWith(" ") &&
                decoded.endsWith(" ") &&
                /[^ ]/.test(decoded)
              )
                decoded = decoded.slice(1, -1);
              if (decoded !== p.validate!.codeText) return;
            }
            found = true;
          },
        });
        if (!found) return undefined;
      }
  }
  return {
    changes,
    selection: EditorSelection.create(
      plans.map((p) => {
        const from = changes.mapPos(p.from, -1);
        return EditorSelection.range(from + p.anchor, from + p.head);
      }),
      state.selection.mainIndex
    ),
  };
}

type FormatPlan = ReturnType<typeof computeInlineFormat>;
const cache = new WeakMap<
  EditorState,
  { tree: ReturnType<typeof syntaxTree>; plans: Map<InlineFormat, FormatPlan> }
>();
export function planInlineFormat(
  state: EditorState,
  kind: InlineFormat
): FormatPlan {
  const tree = syntaxTree(state);
  let entry = cache.get(state);
  if (entry?.tree !== tree) {
    entry = { tree, plans: new Map() };
    cache.set(state, entry);
  }
  if (!entry.plans.has(kind))
    entry.plans.set(kind, computeInlineFormat(state, kind));
  return entry.plans.get(kind);
}

export function inlineFormatTransaction(
  state: EditorState,
  kind: InlineFormat
) {
  const plan = planInlineFormat(state, kind);
  return (
    plan &&
    state.update({ ...plan, userEvent: "input.format", scrollIntoView: true })
  );
}
