import { expect, test } from "bun:test";

import { ensureSyntaxTree, syntaxTree, foldEffect } from "@codemirror/language";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import type { Tree } from "@lezer/common";
import type { Nodes } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

import { generatedEmojiMap } from "../../scripts/generate-emoji-map";

import { calloutInlineBody } from "./callout-inline";
import { parseEditingMarkdown, parseReadingMarkdown } from "./canonical-parser";
import { switchEditorMode, safeSourceEffects } from "./editor-mode";
import { EmojiExtension, emojiQualified } from "./emoji-extension";
import { emojiNames, EMOJI_MAX_NAME } from "./emoji-map";
import { emojiBudget, emojiPresentation } from "./emoji-presentation";
import { summarizeImages } from "./image-summary";
import { planInlineFormat } from "./inline-format";
import { liveDecorations, LiveFormatting } from "./live-formatting";
import { encodeMarkdownTree, decodeMarkdownTree } from "./markdown-tree-wire";
import {
  createRawEditorState,
  rawText,
  writePermission,
  editorOffset,
} from "./raw-buffer";
import { TextCharacterWidget } from "./text-character-presentation";

// Frozen, hand-selected ranges from the approved 12 documents.
const fixtures: readonly [string, number[][]][] = [
  [":smile:", [[0, 7]]],
  [
    "(:smile:) :+1: :unknown_app_name:",
    [
      [1, 8],
      [10, 14],
    ],
  ],
  ["a:smile:b 中文:smile:词 :SMILE:", []],
  ["\\:smile: &#58;smile: :smile&#58;\n\n\\\\:smile:", [[36, 43]]],
  [
    "12:30 https://x.test/:smile: <https://x.test/:smile:> https://x.test/?q=:smile:",
    [],
  ],
  ["`:smile:`\n\n```txt\n:smile:\n```", []],
  [
    "**:smile:** ==:smile:== ^:smile:^",
    [
      [2, 9],
      [14, 21],
      [25, 32],
    ],
  ],
  ['[:smile:](https://x/:smile: ":smile:")', [[1, 8]]],
  ["![:smile:](x)\n\n[r]: /:smile:", [[2, 9]]],
  [
    "---\na: :smile:\n---\n# :smile:\n> :smile:\n- :smile:",
    [
      [21, 28],
      [31, 38],
      [41, 48],
    ],
  ],
  [
    "😀 :smile:\r\n:+1:\r末尾",
    [
      [3, 10],
      [12, 16],
    ],
  ],
  ['::smile:: /:smile: :smile:/ <b title=":smile:">:smile:</b>', [[47, 54]]],
];
function all(node: Nodes): Nodes[] {
  return [node, ...("children" in node ? node.children.flatMap(all) : [])];
}
function spans(tree: Tree) {
  const found: number[][] = [];
  tree.iterate({
    enter(n) {
      if (n.name === "EmojiShortcode") found.push([n.from, n.to]);
    },
  });
  return found;
}
function ready(raw: string) {
  let s = createRawEditorState(raw);
  ensureSyntaxTree(s, s.doc.length, 1000);
  s = s.update({ selection: { anchor: s.doc.length } }).state;
  return s;
}
function widgets(s: EditorState, views = [{ from: 0, to: s.doc.length }]) {
  const found: { from: number; to: number; value: string }[] = [];
  liveDecorations(s, views).between(0, s.doc.length, (from, to, d) => {
    const widget: unknown = (d.spec as { widget?: unknown }).widget;
    if (widget instanceof TextCharacterWidget)
      found.push({ from, to, value: widget.text });
  });
  return found;
}
for (const [i, [raw, expected]] of fixtures.entries())
  test(`Emoji fixed ${i + 1}: real factory, canonical, wire, source fidelity`, () => {
    const s = ready(raw),
      tree = syntaxTree(s),
      cm = expected.map((pair) => pair.map((p) => editorOffset(raw, p)));
    expect(spans(tree)).toEqual(cm);
    expect(spans(decodeMarkdownTree(encodeMarkdownTree(tree)))).toEqual(cm);
    expect(s.field(rawText)).toBe(raw);
    const ast = all(parseEditingMarkdown(raw));
    expect(
      ast
        .filter((n) => n.type === "emoji")
        .map((n) => [n.position!.start.offset, n.position!.end.offset])
    ).toEqual(i === 8 ? [] : expected);
    expect(all(parseReadingMarkdown(raw)).some((n) => n.type === "emoji")).toBe(
      false
    );
    for (const n of ast)
      if (n.type === "emoji")
        expect(n.value).toBe(
          raw.slice(n.position!.start.offset, n.position!.end.offset) === ":+1:"
            ? "👍"
            : "😄"
        );
  });
test("fixed map reproduces without runtime metadata; combined Unicode survives", async () => {
  expect(
    await Bun.file(new URL("./emoji-map.ts", import.meta.url)).text()
  ).toBe(generatedEmojiMap());
  expect(emojiNames.smile).toBe("😄");
  expect(emojiNames["+1"]).toBe("👍");
  expect(Object.values(emojiNames).some((x) => x.includes("\u200d"))).toBe(
    true
  );
});
test("GFM URL trailing punctuation remains exact baseline topology", () => {
  const raw = fixtures[4][0],
    actual = parseEditingMarkdown(raw),
    baseline = parseReadingMarkdown(raw);
  expect(actual).toEqual(baseline);
  const children =
    "children" in actual.children[0] ? actual.children[0].children : [];
  expect(children.map((n) => n.type)).toEqual([
    "text",
    "link",
    "text",
    "link",
    "text",
    "link",
    "text",
  ]);
  expect(children.filter((n) => n.type === "link").map((n) => n.url)).toEqual([
    "https://x.test/:smile",
    "https://x.test/:smile:",
    "https://x.test/?q=:smile",
  ]);
  expect(children.filter((n) => n.type === "text").map((n) => n.value)).toEqual(
    ["12:30 ", ": ", " ", ":"]
  );
  expect(
    children.map((n) => [n.position!.start.offset, n.position!.end.offset])
  ).toEqual([
    [0, 6],
    [6, 27],
    [27, 29],
    [29, 53],
    [53, 54],
    [54, 78],
    [78, 79],
  ]);
});
test("inline parents, image alt, HTML and destinations stay distinct", () => {
  const s = ready(fixtures[6][0]),
    parents: string[] = [];
  syntaxTree(s).iterate({
    enter(n) {
      if (n.name === "EmojiShortcode") {
        parents.push(n.node.parent!.name);
        expect(n.node.parent!.parent!.name).toBe("Paragraph");
      }
    },
  });
  expect(parents).toEqual(["StrongEmphasis", "Highlight", "Superscript"]);
  const ast = all(parseEditingMarkdown(fixtures[6][0]));
  for (const n of ast)
    if (
      ["strong", "highlight", "superscript"].includes(n.type) &&
      "children" in n
    )
      expect(n.children.map((c) => c.type)).toEqual(["emoji"]);
  const image = all(parseEditingMarkdown(fixtures[8][0])).find(
    (n) => n.type === "image"
  );
  expect(image?.alt).toBe("😄");
  expect(image?.url).toBe("x");
  const link = all(parseEditingMarkdown(fixtures[7][0])).find(
    (n) => n.type === "link"
  );
  expect(link?.url).toBe("https://x/:smile:");
  expect(link?.title).toBe(":smile:");
});
test("new implementation bounded qualification rejects locally; BOM and containers", () => {
  for (const count of [255, 256]) {
    const raw = "!".repeat(count) + ":smile:";
    expect(spans(syntaxTree(ready(raw)))).toEqual(
      count === 255 ? [[255, 262]] : []
    );
    const ast = all(parseEditingMarkdown(raw));
    expect(ast.filter((n) => n.type === "emoji").length).toBe(
      count === 255 ? 1 : 0
    );
    if (count === 256)
      expect(
        ast
          .filter((n) => n.type === "text")
          .map((n) => n.value)
          .join("")
      ).toBe(raw);
  }
  for (const raw of [
    "\uFEFF:smile:\r\nend",
    "> first\n> :smile:\n> last",
    "- first\r  :smile:\r  last",
  ]) {
    const ast = all(parseEditingMarkdown(raw)).filter(
      (n) => n.type === "emoji"
    );
    expect(ast).toHaveLength(1);
    expect(spans(syntaxTree(ready(raw)))).toEqual(
      ast.map((n) => [
        editorOffset(raw, n.position!.start.offset!),
        editorOffset(raw, n.position!.end.offset!),
      ])
    );
  }
  const raw = ":smile:";
  expect(
    emojiQualified(0, 7, { lower: NaN, limit: 7, read: (p) => raw[p] })
  ).toBe(false);
});
test("stream right codes, non-BMP and fixed maximum name termination", () => {
  for (const [raw, count] of [
    [":smile:😀", 1],
    [":smile:𐐀", 0],
    [":smile:\nend", 1],
    [":smile:", 1],
    [":smile:\r\nend", 1],
    [":smile:\ud800", 1],
  ] as const) {
    expect(spans(syntaxTree(ready(raw)))).toHaveLength(count);
    expect(
      all(parseEditingMarkdown(raw)).filter((n) => n.type === "emoji")
    ).toHaveLength(count);
  }
  const longest = Object.keys(emojiNames).find(
    (n) => n.length === EMOJI_MAX_NAME
  )!;
  for (const [raw, count] of [
    [`:${longest}:`, 1],
    [`:${longest}x:`, 0],
    [":not_present_app:", 0],
    [":smile", 0],
  ] as const) {
    expect(spans(syntaxTree(ready(raw)))).toHaveLength(count);
    expect(
      all(parseEditingMarkdown(raw)).filter((n) => n.type === "emoji")
    ).toHaveLength(count);
  }
});
test("presentation is whole, selected/ancestor raw and shared-budget bounded", () => {
  let s = ready("**:smile:**\n\nend");
  expect(widgets(s)).toEqual([{ from: 2, to: 9, value: "😄" }]);
  s = s.update({ selection: { anchor: 1 } }).state;
  expect(widgets(s)).toEqual([]);
  for (const count of [200, 512]) {
    const raw = ":smile: ".repeat(count) + "\n\nend",
      state = ready(raw),
      out = widgets(state);
    if (count === 200) expect(out).toHaveLength(200);
    else {
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThan(count);
    }
    for (const w of out) {
      expect(raw.slice(w.from, w.to)).toBe(":smile:");
      expect(w.value).toBe("😄");
    }
  }
  const state = ready(":smile:\n\nend"),
    tree = syntaxTree(state);
  const node = tree.topNode.firstChild!.firstChild!;
  const budget = emojiBudget();
  budget.units = 1;
  expect(emojiPresentation(state, tree, node, budget)).toBeNull();
  expect(
    widgets(state, [
      { from: 0, to: 4 },
      { from: 3, to: 7 },
    ])
  ).toHaveLength(1);
});
test("all selections, fold, readonly, source and safe preserve source", () => {
  const raw = ":smile:\n\nend";
  let s = ready(raw);
  s = s.update({
    effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
  }).state;
  expect(s.readOnly).toBe(true);
  expect(widgets(s)).toHaveLength(1);
  s = s.update({ effects: foldEffect.of({ from: 0, to: 7 }) }).state;
  expect(widgets(s)).toHaveLength(0);
  let e = ready(raw);
  e = e.update({ effects: switchEditorMode("source") }).state;
  e = e.update({
    selection: EditorSelection.create([
      EditorSelection.cursor(e.doc.length),
      EditorSelection.cursor(2),
    ]),
  }).state;
  expect(e.selection.ranges).toHaveLength(2);
  expect(widgets(e)).toHaveLength(0);
  expect(e.field(rawText)).toBe(raw);
  const safe = ready(raw).update({ effects: safeSourceEffects() }).state;
  expect(widgets(safe)).toHaveLength(0);
  for (const range of [
    { anchor: 1, head: 3 },
    { anchor: 0, head: 7 },
  ]) {
    const edit = ready(raw).update({ selection: range }).state;
    expect(planInlineFormat(edit, "bold")).toBeUndefined();
    expect(edit.field(rawText)).toBe(raw);
  }
});
test("actual image summary and Callout visible generator accept Emoji leaves", () => {
  const summary = summarizeImages("![:smile:][r]\n\n[r]: local.png");
  expect(summary.images).toHaveLength(1);
  expect(summary.images[0].alt).toBe("😄");
  expect(summary.sources[summary.images[0].source].url).toBe("local.png");
  const s = ready("> :smile:"),
    quote = syntaxTree(s).topNode.firstChild!;
  const work = calloutInlineBody(s.doc, quote, quote.from, new Set());
  let step = work.next();
  while (!step.done) step = work.next();
  expect(step.value).toBe(true);
});
test("source compartment excludes display styles and wire rejects an old profile", () => {
  const state = ready(":smile:\n\nend");
  const rules = (s: EditorState) =>
    s
      .facet(EditorView.styleModule)
      .map((m) => m.getRules())
      .join("\n");
  expect(rules(state)).toContain("cm-live-character");
  const source = state.update({ effects: switchEditorMode("source") }).state;
  expect(rules(source)).not.toContain("cm-live-character");
  expect(source.field(rawText)).toBe(state.field(rawText));
  const wire = encodeMarkdownTree(syntaxTree(state));
  expect(() =>
    decodeMarkdownTree({
      ...wire,
      config:
        "commonmark-gfm-strike-task-table-frontmatter-highlight-subsup-6" as typeof wire.config,
    })
  ).toThrow("grammar");
});
test("composition class seam freezes Emoji display then refreshes current selection", async () => {
  let state = ready(":smile:\n\nend"),
    dispatched = 0;
  const view = {
    get state() {
      return state;
    },
    get visibleRanges() {
      return [{ from: 0, to: state.doc.length }];
    },
    compositionStarted: false,
    dispatch() {
      dispatched++;
    },
  } as unknown as EditorView;
  const plugin = new LiveFormatting(view),
    before = plugin.decorations;
  plugin.compositionStart();
  const startState = state,
    tr = state.update({ selection: { anchor: 2 } });
  state = tr.state;
  const update = {
    state,
    startState,
    view,
    changes: tr.changes,
    transactions: [tr],
    selectionSet: true,
    docChanged: false,
    viewportChanged: false,
  } as unknown as ViewUpdate;
  plugin.update(update);
  expect(plugin.decorations).toBe(before);
  expect(dispatched).toBe(0);
  plugin.compositionEnd(view);
  await new Promise((r) => setTimeout(r, 5));
  expect(dispatched).toBe(1);
  plugin.update(update);
  expect(widgets(state)).toEqual([]);
  expect(state.field(rawText)).toBe(":smile:\n\nend");
  plugin.destroy();
});
test("table cell Emoji and destination retain real factory and canonical ownership", () => {
  const raw =
    "| a | b |\n| - | - |\n| :smile: | [x](https://x/:smile:) |\n\nend";
  const state = ready(raw),
    tree = syntaxTree(state),
    nodes = all(parseEditingMarkdown(raw));
  expect(spans(tree)).toEqual([
    [raw.indexOf(":smile:"), raw.indexOf(":smile:") + 7],
  ]);
  expect(nodes.filter((n) => n.type === "emoji").map((n) => n.value)).toEqual([
    "😄",
  ]);
  expect(nodes.filter((n) => n.type === "link").map((n) => n.url)).toEqual([
    "https://x/:smile:",
  ]);
  const cell = nodes.find(
    (n) => n.type === "tableCell" && n.children.some((c) => c.type === "emoji")
  );
  expect(cell?.type).toBe("tableCell");
  expect(widgets(state)).toHaveLength(1);
});
test("canonical rejects malformed temporary identity instead of swallowing faults", () => {
  const ext = EmojiExtension.canonical(":smile:");
  const rules = ext.micromark.text![58]!;
  const rule = Array.isArray(rules) ? rules[0] : rules;
  expect(() => rule.resolveTo!([], {} as never)).toThrow("identity");
});
test("real tokenizer unknown content lower bound falls back to data without parse failure", () => {
  const raw = "before :smile: after",
    ext = EmojiExtension.canonical(raw);
  const rules = ext.micromark.text![58]!,
    rule = Array.isArray(rules) ? rules[0] : rules,
    resolve = rule.resolveTo!;
  rule.resolveTo = (events, context) => {
    const first = events[0][1].start,
      offset = first.offset;
    first.offset = NaN;
    try {
      return resolve(events, context);
    } finally {
      first.offset = offset;
    }
  };
  const ast = fromMarkdown(raw, {
    extensions: [ext.micromark],
    mdastExtensions: [ext.mdast],
  });
  expect(all(ast).some((n) => n.type === "emoji")).toBe(false);
  expect(
    all(ast)
      .filter((n) => n.type === "text")
      .map((n) => n.value)
      .join("")
  ).toBe(raw);
});
