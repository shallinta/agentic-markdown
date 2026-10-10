import { insertNewlineAndIndent } from "@codemirror/commands";
import {
  getIndentation,
  IndentContext,
  indentString,
  syntaxTree,
} from "@codemirror/language";
import {
  countColumn,
  EditorSelection,
  type EditorState,
  type Transaction,
} from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import { longLineProtection } from "./long-line-protection";

interface Item {
  node: SyntaxNode;
  from: number;
  to: number;
  prefix: string;
  marker: string;
  gap: string;
  number?: number;
  content: number;
}
interface Group {
  node: SyntaxNode;
  items: Item[];
  byStart: Map<number, Item>;
  loose: boolean;
  delta: Map<number, number>;
}
interface Edit {
  from: number;
  to: number;
  insert: string;
  group?: number;
  caret?: number;
}
interface Plan {
  edit: Edit;
  group?: number;
  item?: Item;
  create?: boolean;
  loose?: boolean;
  marker?: string;
}

/** Public CommonMark nodes, never source guesses when the tree is incomplete. */
function itemAt(state: EditorState, node: SyntaxNode): Item | undefined {
  const mark = node.getChild("ListMark");
  if (!mark) return;
  const line = state.doc.lineAt(mark.from);
  const prefix = state.sliceDoc(line.from, mark.from);
  // Composite quote containers are left to the unchanged ordinary input path.
  if (!/^[\t ]*$/.test(prefix.replace(/^\ufeff/, ""))) return;
  const match = /^(\d{1,9}[.)]|[-+*])([\t ]*)/.exec(
    state.sliceDoc(mark.from, line.to)
  );
  if (!match) return;
  const number = /^\d/.test(match[1])
    ? Number(match[1].slice(0, -1))
    : undefined;
  return {
    node,
    from: line.from,
    to: mark.to,
    prefix,
    marker: match[1],
    gap: match[2] || " ",
    number,
    content: mark.from + match[0].length,
  };
}

function ancestor(node: SyntaxNode | null): SyntaxNode | undefined {
  for (; node; node = node.parent) if (node.name === "ListItem") return node;
}

/** One original-state plan and one transaction, including mixed plain ranges. */
export function listContinuationTransaction(
  state: EditorState,
  soft: boolean,
  excluded = new Set<number>()
) {
  const tree = syntaxTree(state);
  const protectedSpans = state.field(longLineProtection);
  const groups = new Map<number, Group>();
  const invalid = new Set<number>();
  const getGroup = (node: SyntaxNode): Group | undefined => {
    if (excluded.has(node.from)) return;
    const existing = groups.get(node.from);
    if (existing) return existing;
    // A truncated list may hide later siblings/continuations: do not renumber it.
    if (node.to >= tree.length && tree.length < state.doc.length) return;
    if (protectedSpans.some((s) => s.from < node.to && s.to > node.from))
      return;
    const children = node.getChildren("ListItem");
    const items = children.map((item) => itemAt(state, item));
    if (items.some((item) => !item)) return;
    const entries = items as Item[];
    const group = {
      node,
      items: entries,
      byStart: new Map(entries.map((i) => [i.node.from, i])),
      loose: entries.some(
        (entry, i) =>
          i > 0 &&
          state.doc.lineAt(entry.from).number >
            state.doc.lineAt(entries[i - 1].node.to).number + 1
      ),
      delta: new Map<number, number>(),
    };
    groups.set(node.from, group);
    return group;
  };
  const plain = (from: number, to: number): Plan => {
    const line = state.doc.lineAt(from),
      leading = /^\s*/.exec(line.text)![0];
    const pair =
      from === to &&
      ["()", "[]", "{}"].includes(
        state.sliceDoc(Math.max(0, from - 1), from + 1)
      );
    const context = new IndentContext(state, {
      simulateBreak: from,
      simulateDoubleBreak: pair,
    });
    const indent = indentString(
      state,
      getIndentation(context, from) ?? countColumn(leading, state.tabSize)
    );
    const tail = /^\s*/.exec(state.sliceDoc(to, line.to))![0];
    to += tail.length;
    if (!pair && !line.text.trim() && from - line.from < 100) from = line.from;
    const insert = state.lineBreak + indent;
    return {
      edit: {
        from,
        to,
        insert:
          insert +
          (pair
            ? state.lineBreak +
              indentString(state, context.lineIndent(line.from, -1))
            : ""),
        caret: insert.length,
      },
    };
  };
  const plans: Plan[] = state.selection.ranges.map((range) => {
    const fallback = plain(range.from, range.to);
    if (range.to > tree.length) return fallback;
    const resolved = tree.resolveInner(range.from, -1);
    for (
      let inner: SyntaxNode | null = resolved;
      inner && inner.name !== "ListItem";
      inner = inner.parent
    )
      if (["FencedCode", "CodeBlock", "HTMLBlock"].includes(inner.name))
        return fallback;
    const node =
      ancestor(resolved) ?? ancestor(tree.resolveInner(range.from, 1));
    if (!node?.parent || range.to > node.to) return fallback;
    const group = getGroup(node.parent);
    const item = group?.byStart.get(node.from);
    if (!group || !item || range.from < item.content) return fallback;
    const line = state.doc.lineAt(range.from);
    // Tasks belong to the later GFM consumer, not this CommonMark slice.
    if (
      /^\[[ xX]\](?:\s|$)/.test(
        state.sliceDoc(item.content, state.doc.lineAt(item.content).to)
      )
    )
      return fallback;
    const id = group.node.from;
    const contentColumn = countColumn(
      item.prefix.replace(/^\ufeff/, "") + item.marker + item.gap,
      state.tabSize
    );
    // A selection spanning structural lines is ordinary replacement, not a rewrite.
    if (state.doc.lineAt(range.to).number !== line.number) return fallback;
    if (soft)
      return {
        group: id,
        item,
        edit: {
          from: range.from,
          to: range.to,
          insert: state.lineBreak + " ".repeat(contentColumn),
        },
      };
    const empty =
      range.empty &&
      line.from === item.from &&
      !state.sliceDoc(item.content, line.to).trim() &&
      node.to <= line.to;
    if (empty) {
      const parentItemNode = ancestor(group.node.parent);
      let insert = item.prefix.startsWith("\ufeff") ? "\ufeff" : "",
        parentGroup: Group | undefined,
        parentItem: Item | undefined;
      if (parentItemNode?.parent) {
        parentGroup = getGroup(parentItemNode.parent);
        parentItem = parentGroup?.byStart.get(parentItemNode.from);
        if (!parentGroup || !parentItem) return fallback;
        insert = parentItem.prefix + parentItem.marker + parentItem.gap;
      }
      group.delta.set(node.from, (group.delta.get(node.from) ?? 0) - 1);
      if (parentGroup && parentItem) {
        parentGroup.delta.set(
          parentItem.node.from,
          (parentGroup.delta.get(parentItem.node.from) ?? 0) + 1
        );
        return {
          group: parentGroup.node.from,
          item: parentItem,
          create: true,
          edit: { from: line.from, to: range.to, insert, group: id },
        };
      }
      return {
        group: id,
        item,
        edit: { from: line.from, to: range.to, insert },
      };
    }
    group.delta.set(node.from, (group.delta.get(node.from) ?? 0) + 1);
    return {
      group: id,
      item,
      create: true,
      loose: group.loose,
      edit: { from: range.from, to: range.to, insert: "" },
    };
  });
  if (plans.every((plan) => plan.group === undefined)) {
    let transaction: Transaction | undefined;
    insertNewlineAndIndent({
      state,
      dispatch: (tx) => {
        transaction = tx;
      },
    });
    return transaction ?? state.update({});
  }
  // A plain cross-structure deletion can invalidate the old list's numbering.
  // Retire that list, while preserving unrelated groups in the same input.
  for (let i = 0; i < plans.length; i++)
    if (plans[i].group === undefined && !state.selection.ranges[i].empty) {
      const range = state.selection.ranges[i];
      for (const [id, group] of groups)
        if (range.from < group.node.to && range.to > group.node.from)
          invalid.add(id);
    }
  if (invalid.size)
    return listContinuationTransaction(
      state,
      soft,
      new Set([...excluded, ...invalid])
    );

  // Each group is scanned once; all cursor deltas are already aggregated.
  const numeric: Edit[] = [];
  const itemNumbers = new Map<number, number>();
  const lineShifts = new Map<number, { amount: number; groups: Set<number> }>();
  for (const [id, group] of groups) {
    let shift = 0,
      previous: number | undefined;
    for (const item of group.items) {
      if (item.number === undefined) continue;
      if (previous === undefined || item.number !== previous + 1) shift = 0;
      const value = item.number + shift;
      itemNumbers.set(item.node.from, value);
      const delta = group.delta.get(item.node.from) ?? 0;
      if (
        value < 0 ||
        value > 999999999 ||
        value + Math.max(0, delta) > 999999999
      )
        invalid.add(id);
      if (shift) {
        const from = item.from + item.prefix.length;
        const digits = String(value).padStart(item.marker.length - 1, "0");
        numeric.push({
          from,
          to: from + item.marker.length - 1,
          insert: digits,
          group: id,
        });
        const start = item.prefix.replace(/^\ufeff/, "");
        const width =
          countColumn(
            start + digits + item.marker[item.marker.length - 1] + item.gap,
            state.tabSize
          ) - countColumn(start + item.marker + item.gap, state.tabSize);
        if (width) {
          const column = countColumn(
            item.prefix.replace(/^\ufeff/, "") + item.marker + item.gap,
            state.tabSize
          );
          for (
            let n = state.doc.lineAt(item.from).number + 1;
            n <= state.doc.lineAt(item.node.to).number;
            n++
          ) {
            const line = state.doc.line(n),
              indent = /^[\t ]*/.exec(line.text)![0];
            if (
              !line.text.trim() ||
              countColumn(indent, state.tabSize) < column
            )
              continue;
            const entry = lineShifts.get(line.from) ?? {
              amount: 0,
              groups: new Set<number>(),
            };
            entry.amount += width;
            entry.groups.add(id);
            lineShifts.set(line.from, entry);
          }
        }
      }
      shift += delta;
      previous = item.number;
    }
  }
  const created = new Map<number, number>();
  const splitWidths = new Map<
    number,
    { item: Item; group: number; events: { at: number; width: number }[] }
  >();
  for (const plan of plans) {
    if (!plan.create || !plan.item) continue;
    const item = plan.item,
      count = (created.get(item.node.from) ?? 0) + 1;
    created.set(item.node.from, count);
    const marker =
      item.number === undefined
        ? item.marker
        : String(
            (itemNumbers.get(item.node.from) ?? item.number) + count
          ).padStart(item.marker.length - 1, "0") +
          item.marker[item.marker.length - 1];
    const isLift = plan.edit.group !== undefined;
    plan.marker = marker;
    const inherited = lineShifts.get(item.from)?.amount ?? 0;
    const prefix = inherited
      ? " ".repeat(
          Math.max(0, countColumn(item.prefix, state.tabSize) + inherited)
        )
      : item.prefix.replace(/^\ufeff/, "");
    plan.edit.insert =
      (isLift ? "" : state.lineBreak + (plan.loose ? state.lineBreak : "")) +
      prefix +
      marker +
      item.gap;
    if (item.number !== undefined) {
      const base =
        String(itemNumbers.get(item.node.from) ?? item.number).padStart(
          item.marker.length - 1,
          "0"
        ) + item.marker[item.marker.length - 1];
      const splits = splitWidths.get(item.node.from) ?? {
        item,
        group: plan.group!,
        events: [],
      };
      splits.events.push({
        at: plan.edit.from,
        width:
          countColumn(item.prefix + marker + item.gap, state.tabSize) -
          countColumn(item.prefix + base + item.gap, state.tabSize),
      });
      splitWidths.set(item.node.from, splits);
    }
  }
  for (const { item, group, events } of splitWidths.values()) {
    let index = 0,
      width = 0;
    const column = countColumn(
      item.prefix.replace(/^\ufeff/, "") + item.marker + item.gap,
      state.tabSize
    );
    for (
      let n = state.doc.lineAt(item.from).number + 1;
      n <= state.doc.lineAt(item.node.to).number;
      n++
    ) {
      const line = state.doc.line(n);
      while (index < events.length && events[index].at < line.from)
        width = events[index++].width;
      const indent = /^[\t ]*/.exec(line.text)![0];
      if (
        !width ||
        !line.text.trim() ||
        countColumn(indent, state.tabSize) < column
      )
        continue;
      const entry = lineShifts.get(line.from) ?? {
        amount: 0,
        groups: new Set<number>(),
      };
      entry.amount += width;
      entry.groups.add(group);
      lineShifts.set(line.from, entry);
    }
  }
  for (const plan of plans)
    if (plan.marker && plan.item) {
      const item = plan.item,
        inherited = lineShifts.get(item.from)?.amount ?? 0;
      const prefix = inherited
        ? " ".repeat(
            Math.max(
              0,
              countColumn(item.prefix.replace(/^\ufeff/, ""), state.tabSize) +
                inherited
            )
          )
        : item.prefix.replace(/^\ufeff/, "");
      plan.edit.insert =
        (plan.edit.group !== undefined
          ? ""
          : state.lineBreak + (plan.loose ? state.lineBreak : "")) +
        prefix +
        plan.marker +
        item.gap;
    }
  const indentation: Edit[] = [];
  for (const [from, entry] of lineShifts) {
    const line = state.doc.lineAt(from),
      indent = /^[\t ]*/.exec(line.text)![0];
    // Overlapping parent/child prefix changes need a single final replacement.
    indentation.push({
      from,
      to: from + indent.length,
      insert: " ".repeat(
        Math.max(0, countColumn(indent, state.tabSize) + entry.amount)
      ),
      group: [...entry.groups][0],
    });
  }
  if (invalid.size)
    return listContinuationTransaction(
      state,
      soft,
      new Set([...excluded, ...invalid])
    );
  const edits = plans.map((p) => ({ ...p.edit, group: p.group }));
  const deleted = edits
    .filter((e) => e.to > e.from)
    .sort((a, b) => a.from - b.from);
  let deletion = 0;
  const additions = [...numeric, ...indentation]
    .sort((a, b) => a.from - b.from)
    .filter((e) => {
      while (deletion < deleted.length && deleted[deletion].to < e.from)
        deletion++;
      const range = deleted[deletion];
      return !range || range.from > e.from || range.to < e.to;
    });
  const all = [...edits, ...additions].sort(
    (a, b) => a.from - b.from || a.to - b.to
  );
  // Structural conflicts retire their group. Ordinary overlapping replacements
  // retain CM's changeByRange mapping, including separate inserted cursors.
  for (let i = 1; i < all.length; i++)
    if (all[i].from < all[i - 1].to)
      for (const edit of [all[i], all[i - 1]])
        if (edit.group !== undefined) invalid.add(edit.group);
  if (invalid.size) {
    // A lift affects both child and parent; retire its dependency group together.
    for (const plan of plans)
      if (invalid.has(plan.group ?? -1) || invalid.has(plan.edit.group ?? -1)) {
        if (plan.group !== undefined) invalid.add(plan.group);
        if (plan.edit.group !== undefined) invalid.add(plan.edit.group);
      }
    return listContinuationTransaction(
      state,
      soft,
      new Set([...excluded, ...invalid])
    );
  }
  let index=0;
  const input=state.changeByRange(()=>{
    const edit=edits[index++];
    return {changes:edit,range:EditorSelection.cursor(edit.from+(edit.caret??edit.insert.length))};
  });
  const adjustment=state.changes(additions).map(input.changes);
  return state.update({
    changes:input.changes.compose(adjustment),
    selection:input.selection.map(adjustment),
    userEvent: "input",
    scrollIntoView: true,
  });
}
