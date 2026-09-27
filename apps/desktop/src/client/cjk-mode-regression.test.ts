import { expect, test } from "bun:test";

import { isolateHistory } from "@codemirror/commands";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController, type DocumentTransport } from "./documents";
import { editorFaultSession, reportEditorFault } from "./editor-fault";
import { rawText } from "./raw-buffer";
import { requestText, savedReply } from "./save-test-helper";

type Presentation = "editing" | "source" | "safe";
const original = "\uFEFF# 输入\r\n- 起点\n尾🙂";
async function setup(mode: Presentation, writable = true) {
  const make = (text: string): DocumentSnapshot => ({
    documentId: crypto.randomUUID(),
    handle: crypto.randomUUID(),
    fileName: "temporary-cjk.md",
    revision: 1,
    hash: "a".repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: writable
      ? { writable: true, reason: "writable" }
      : { writable: false, reason: "readonly" },
  });
  const a = make(original),
    b = make("第二文档");
  let selected = a,
    saves = 0,
    saved = "",
    confirmations = 0;
  const transport: DocumentTransport = {
    selectDocument: (request) =>
      Promise.resolve({ ...request, ok: true, snapshot: selected }),
    readDocument: (request) =>
      Promise.resolve({ ...request, ok: true, snapshot: selected }),
    cancelDocument: () => Promise.resolve(),
    releaseDocument: () => Promise.resolve(),
    waitForDocumentSaves: (request) =>
      Promise.resolve({ ...request, settled: true }),
    saveDocument: (request) => {
      saves++;
      saved = requestText(request, a);
      return Promise.resolve(savedReply(request, a));
    },
  };
  const c = createDocumentController(transport, () => {
    confirmations++;
    return Promise.resolve(false);
  });
  await c.select();
  selected = b;
  await c.select();
  c.activateTab(a.documentId);
  if (mode === "source") expect(c.toggleSourceMode()).toBe(true);
  if (mode === "safe") {
    const session = c.getEditor(a.documentId)!.state.field(editorFaultSession);
    reportEditorFault(session, "presentation");
    expect(c.enterSafeSource(a.documentId, session)).toBe(true);
  }
  const state = () => c.getEditor(a.documentId)!.state;
  return { c, a, b, state, results: () => ({ saves, saved, confirmations }) };
}

// These are synthetic CM transactions and explicit composition gates, not OS IME events.
for (const mode of ["editing", "source", "safe"] as const) {
  for (const [language, candidates] of [
    ["Japanese", ["に", "にほん", "日本語"]],
    ["Korean", ["ㅎ", "하", "한", "한국어"]],
  ] as const) {
    test(`synthetic ${language} composition in ${mode} preserves source/history and gates commands`, async () => {
      const { c, a, b, state, results } = await setup(mode);
      const from = state().doc.toString().indexOf("起点") + 2;
      let previous = "";
      c.setInteractionCheck(() => false);
      for (let index = 0; index < candidates.length; index++) {
        const value = candidates[index];
        expect(
          c.updateEditor(
            a.documentId,
            state().update({
              changes: { from, to: from + previous.length, insert: value },
              selection: { anchor: from + value.length },
              userEvent: "input.type.compose",
              annotations: index === 0 ? isolateHistory.of("before") : [],
            })
          )
        ).toBe(true);
        previous = value;
        expect(c.canSave()).toBe(false);
        expect(c.runHistory("undo")).toBe(false);
        expect(c.runHistory("redo")).toBe(false);
        expect(c.toggleSourceMode()).toBe(false);
        c.activateTab(b.documentId);
        await c.closeActive();
        await c.save();
        expect(c.getSnapshot().snapshot?.documentId).toBe(a.documentId);
        expect(c.getSnapshot().tabs).toHaveLength(2);
      }
      expect(results().saves).toBe(0);
      expect(results().confirmations).toBe(0);
      c.setInteractionCheck(() => true);
      const expected = original.replace("起点", "起点" + previous);
      expect(state().field(rawText)).toBe(expected);
      expect(c.isDirty(a.documentId)).toBe(true);
      const selection = state().selection;
      if (mode !== "safe") {
        expect(c.toggleSourceMode()).toBe(true);
        expect(c.toggleSourceMode()).toBe(true);
      } else expect(c.toggleSourceMode()).toBe(false);
      expect(state().selection).toBe(selection);
      c.activateTab(b.documentId);
      expect(c.runHistory("undo")).toBe(false);
      c.activateTab(a.documentId);
      expect(state().selection).toBe(selection);
      expect(c.runHistory("undo")).toBe(true);
      expect(state().field(rawText)).toBe(original);
      expect(c.runHistory("redo")).toBe(true);
      expect(state().field(rawText)).toBe(expected);
      await c.save();
      expect(results().saves).toBe(1);
      expect(results().saved).toBe(expected);
      expect(analyzeTextFidelity(results().saved)).toEqual(
        analyzeTextFidelity(original)
      );
      expect(c.isDirty(a.documentId)).toBe(false);
      expect(c.runHistory("undo")).toBe(true);
      expect(c.isDirty(a.documentId)).toBe(true);
      expect(c.getEditor(b.documentId)!.state.field(rawText)).toBe("第二文档");
    });
  }

  test(`synthetic cancelled composition and readonly ${mode} do not corrupt raw text`, async () => {
    const { c, a, state } = await setup(mode);
    const from = state().doc.length;
    c.setInteractionCheck(() => false);
    for (const value of ["かな한🙂", ""]) {
      const oldLength = state().doc.length;
      c.updateEditor(
        a.documentId,
        state().update({
          changes: { from, to: oldLength, insert: value },
          userEvent: "input.type.compose",
        })
      );
    }
    c.setInteractionCheck(() => true);
    expect(state().field(rawText)).toBe(original);
    expect(c.isDirty(a.documentId)).toBe(false);
    const readonly = await setup(mode, false);
    expect(
      readonly.c.updateEditor(
        readonly.a.documentId,
        readonly.state().update({
          changes: { from: 0, insert: "拒绝" },
          userEvent: "input.type.compose",
        })
      )
    ).toBe(false);
    expect(readonly.c.canSave()).toBe(false);
    expect(readonly.c.runHistory("undo")).toBe(false);
    expect(readonly.state().field(rawText)).toBe(original);
  });
}
