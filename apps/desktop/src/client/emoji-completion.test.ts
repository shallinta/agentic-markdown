import { expect, test } from "bun:test";

import {
  CompletionContext,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { undo, redo, undoDepth } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import {
  EditorState,
  EditorSelection,
  StateEffect,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView, ViewUpdate } from "@codemirror/view";

import { generatedEmojiIndex } from "../../scripts/generate-emoji-map";

import { switchEditorMode, safeSourceEffects } from "./editor-mode";
import {
  EmojiCompletionSession,
  registerEmojiCompletion,
  emojiMatches,
  type EmojiIndex,
} from "./emoji-completion";
import { emojiPrefix } from "./emoji-completion-context";
import { names, version } from "./emoji-completion-index";
import { emojiNames } from "./emoji-map";
import {
  createRawEditorState,
  editorOffset,
  rawText,
  writePermission,
} from "./raw-buffer";

function stateAt(marked: string) {
  const raw = marked.replace("|", ""),
    at = marked.indexOf("|");
  let state = createRawEditorState(raw);
  ensureSyntaxTree(state, state.doc.length, 1000);
  state = state.update({ selection: { anchor: editorOffset(raw, at) } }).state;
  return state;
}
const fixtures: [string, boolean][] = [
  [":smi|", true],
  [":smi|:", true],
  [":smile|:", false],
  [":smile:|", false],
  [":|", false],
  [":+|", true],
  ["a:sm|", false],
  ["12:3|", false],
  ["https://x/?q=:sm|", false],
  ["\\:sm|", false],
  ["\\\\:sm|", true],
  ["`:sm|`", false],
  ["```\n:sm|\n```", false],
  ["---\nx: :sm|\n---", false],
  ["[:sm|](x)", true],
  ["![:sm|](x)", true],
  ["[x](https://x/:sm|)", false],
  ['[x](x ":sm|")', false],
  ["> :sm|", true],
  ["- :sm|", true],
  ["\uFEFF:sm|\r\nend", true],
  ["😀:sm|", true],
  ["𐐀:sm|", false],
  [":sm|word", false],
];
for (const [raw, expected] of fixtures)
  test(`prefix eligibility ${JSON.stringify(raw)}`, () => {
    expect(emojiPrefix(stateAt(raw)) !== null).toBe(expected);
  });
test("real table cell and source readonly selection guards", () => {
  const raw = "| a |\n| - |\n| :sm |",
    s = createRawEditorState(raw);
  ensureSyntaxTree(s, s.doc.length, 1000);
  expect(
    emojiPrefix(
      s.update({ selection: { anchor: raw.indexOf(":sm") + 3 } }).state
    )
  ).not.toBeNull();
  const state = stateAt(":smi|");
  const multi = state
    .update({
      effects: StateEffect.appendConfig.of(
        EditorState.allowMultipleSelections.of(true)
      ),
    })
    .state.update({
      selection: EditorSelection.create([
        EditorSelection.cursor(1),
        EditorSelection.cursor(4),
      ]),
    }).state;
  expect(multi.selection.ranges).toHaveLength(2);
  expect(emojiPrefix(multi)).toBeNull();
  expect(
    emojiPrefix(
      state.update({
        effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
      }).state
    )
  ).toBeNull();
  expect(
    emojiPrefix(state.update({ effects: switchEditorMode("source") }).state)
  ).toBeNull();
  expect(
    emojiPrefix(state.update({ effects: safeSourceEffects() }).state)
  ).toBeNull();
  expect(
    emojiPrefix(state.update({ selection: { anchor: 1, head: 3 } }).state)
  ).toBeNull();
});
test("generated lazy index same fixed names and strict binary prefix", async () => {
  expect(names).toEqual(Object.keys(emojiNames).sort());
  expect(
    await Bun.file(
      new URL("./emoji-completion-index.ts", import.meta.url)
    ).text()
  ).toBe(generatedEmojiIndex());
  expect(emojiMatches(names, "smi")).toContain("smile");
  expect(emojiMatches(names, "SMI")).toEqual([]);
  expect(emojiMatches(names, "not_app_")).toEqual([]);
});
function harness(
  marked = ":smi|",
  loader: () => Promise<EmojiIndex> = () => Promise.resolve({ names, version })
) {
  let state = stateAt(marked),
    allowed = true;
  const view = {
    get state() {
      return state;
    },
    compositionStarted: false,
    composing: false,
    dispatch(spec: TransactionSpec) {
      const startState = state,
        tr = state.update(spec);
      state = tr.state;
      session.update({
        state,
        startState,
        docChanged: tr.docChanged,
        selectionSet: !!tr.selection,
      } as ViewUpdate);
    },
  } as unknown as EditorView;
  const session = new EmojiCompletionSession(view, loader);
  const remove = registerEmojiCompletion(view, () => allowed);
  return {
    view,
    session,
    query: () =>
      session.query(
        new CompletionContext(state, state.selection.main.head, false, view)
      ),
    block() {
      allowed = false;
      session.invalidate();
    },
    dispose() {
      remove();
      session.destroy();
    },
  };
}
test("accept inserts shortcode once, preserves raw EOL and isolated undo redo", async () => {
  for (const marked of [":smi|", ":smi|:", "\uFEFFfirst\r\n:smi|\r\nend"]) {
    const h = harness(marked);
    try {
      const before = h.view.state.field(rawText),
        r = await h.query();
      expect(r).not.toBeNull();
      const c = r!.options.find((c) => c.label === ":smile:")!;
      expect(typeof c.apply).toBe("function");
      if (typeof c.apply === "function") c.apply(h.view, c, r!.from, r!.to!);
      expect(h.view.state.field(rawText)).toBe(
        before.replace(/:smi:?/, ":smile:")
      );
      expect(undoDepth(h.view.state)).toBe(1);
      expect(undo(h.view)).toBe(true);
      expect(h.view.state.field(rawText)).toBe(before);
      expect(redo(h.view)).toBe(true);
    } finally {
      h.dispose();
    }
  }
});
test("loader only for eligible input; failure and late completion do not mutate", async () => {
  let calls = 0;
  for (const raw of [":|", "`:smi|`", "https://x/?q=:sm|"]) {
    const h = harness(raw, () => {
      calls++;
      return Promise.resolve({ names, version });
    });
    expect(await h.query()).toBeNull();
    h.dispose();
  }
  expect(calls).toBe(0);
  for (const action of [
    "edit",
    "selection",
    "blocked",
    "dispose",
    "composition",
    "source",
    "safe",
    "readonly",
  ] as const) {
    let resolve!: (value: EmojiIndex) => void;
    const h = harness(
      ":smi|",
      () =>
        new Promise((r) => {
          resolve = r;
        })
    );
    const pending = h.query();
    if (action === "edit")
      h.view.dispatch({ changes: { from: 4, insert: "x" } });
    if (action === "selection") h.view.dispatch({ selection: { anchor: 0 } });
    if (action === "blocked") h.block();
    if (action === "dispose") h.dispose();
    if (action === "composition") h.session.compositionStart();
    if (action === "source")
      h.view.dispatch({ effects: switchEditorMode("source") });
    if (action === "safe") h.view.dispatch({ effects: safeSourceEffects() });
    if (action === "readonly")
      h.view.dispatch({
        effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
      });
    resolve({ names, version });
    expect(await pending).toBeNull();
    h.dispose();
  }
  const h = harness(":smi|", () => Promise.reject(new Error("test load")));
  expect(await h.query()).toBeNull();
  expect(h.view.state.field(rawText)).toBe(":smi");
  h.dispose();
});
test("composition invalidates pending then resumes latest committed prefix without extra selection event", async () => {
  const h = harness(":sm|");
  try {
    startCompletion(h.view);
    expect(completionStatus(h.view.state)).toBe("pending");
    h.session.compositionStart();
    expect(await h.query()).toBeNull();
    await new Promise((r) => setTimeout(r, 2));
    expect(completionStatus(h.view.state)).toBeNull();
    h.session.compositionEnd();
    h.view.dispatch({
      changes: { from: 3, insert: "i" },
      selection: { anchor: 4 },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(completionStatus(h.view.state)).toBe("pending");
    const r = await h.query();
    expect(r?.options.some((c) => c.label === ":smile:")).toBe(true);
    expect(h.view.state.field(rawText)).toBe(":smi");
  } finally {
    h.dispose();
  }
});
test("explicit cancel revokes returned apply and scheduled composition restart", async () => {
  const h = harness();
  try {
    const result = (await h.query())!,
      completion = result.options[0];
    h.session.cancel();
    if (typeof completion.apply === "function")
      completion.apply(h.view, completion, result.from, result.to!);
    expect(h.view.state.field(rawText)).toBe(":smi");
    expect(undoDepth(h.view.state)).toBe(0);
    h.session.compositionEnd();
    h.session.cancel();
    await new Promise((r) => setTimeout(r, 30));
    expect(completionStatus(h.view.state)).toBeNull();
  } finally {
    h.dispose();
  }
});
test("stale apply cannot write after new selection/readonly/source and direct closed session", async () => {
  for (const action of [
    "selection",
    "readonly",
    "source",
    "dispose",
  ] as const) {
    const h = harness();
    const r = (await h.query())!,
      c = r.options[0];
    if (action === "selection") h.view.dispatch({ selection: { anchor: 0 } });
    if (action === "readonly")
      h.view.dispatch({
        effects: writePermission.reconfigure(EditorState.readOnly.of(true)),
      });
    if (action === "source")
      h.view.dispatch({ effects: switchEditorMode("source") });
    if (action === "dispose") h.dispose();
    if (typeof c.apply === "function") c.apply(h.view, c, r.from, r.to!);
    expect(h.view.state.field(rawText)).toBe(":smi");
    expect(undoDepth(h.view.state)).toBe(0);
    h.dispose();
  }
});
