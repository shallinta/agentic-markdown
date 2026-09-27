import { expect, test } from "bun:test";

import { redo, undo } from "@codemirror/commands";
import {
  Language,
  defineLanguageFacet,
  ensureSyntaxTree,
} from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { Parser, Tree, NodeType, type Input } from "@lezer/common";

import {
  GuardedParser,
  editorFaultSession,
  reportEditorFault,
} from "./editor-fault";
import { safeSourceEffects, isSafeSource } from "./editor-mode";
import { createRawEditorState, rawText } from "./raw-buffer";

test("parser creation/advance/stop failures become inert syntax and latch one notification", async () => {
  for (const step of ["create", "advance", "stop"]) {
    let calls = 0;
    class Broken extends Parser {
      createParse(input: Input) {
        calls++;
        if (step === "create") throw new Error("private text must not escape");
        return {
          parsedPos: 0,
          stoppedAt: null,
          stopAt() {
            if (step === "stop") throw new Error("private");
          },
          advance() {
            if (step === "advance") throw new Error("private");
            return new Tree(NodeType.none, [], [], input.length);
          },
        };
      }
    }
    const language = new Language(
      defineLanguageFacet(),
      new GuardedParser(new Broken())
    );
    const state = EditorState.create({
      doc: "text",
      extensions: [editorFaultSession, language],
    });
    if (step !== "stop") {
      const session = state.field(editorFaultSession);
      expect(session.fault).toBe("parser");
      let notices = 0;
      session.notify = () => {
        notices++;
      };
      reportEditorFault(session, "presentation");
      await Promise.resolve();
      expect(notices).toBe(1);
      const next = state.update({ changes: { from: 0, insert: "x" } }).state;
      ensureSyntaxTree(next, next.doc.length, 100);
      expect(calls).toBe(1);
      expect(next.doc.toString()).toBe("xtext");
    } else {
      const parse = new GuardedParser(new Broken()).startParse("text");
      expect(() => parse.stopAt(2)).not.toThrow();
      expect(parse.advance()?.length).toBe(2);
    }
  }
});

test("safe source removes parsing but retains source, selection and history", () => {
  let state = createRawEditorState("\uFEFF# 中文\r\n- item");
  state = state.update({
    changes: { from: state.doc.length, insert: "!" },
  }).state;
  const raw = state.field(rawText),
    doc = state.doc,
    selection = state.selection;
  state = state.update({ effects: safeSourceEffects() }).state;
  expect(isSafeSource(state)).toBe(true);
  expect(state.doc).toBe(doc);
  expect(state.selection).toBe(selection);
  expect(state.field(rawText)).toBe(raw);
  const dispatch = (transaction: ReturnType<EditorState["update"]>) => {
    state = transaction.state;
  };
  expect(undo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe("\uFEFF# 中文\r\n- item");
  expect(redo({ state, dispatch })).toBe(true);
  expect(state.field(rawText)).toBe(raw);
});

test("a delayed parser advance failure retains its captured document session outside ParseContext", async () => {
  let fail = false;
  class Delayed extends Parser {
    createParse(input: Input) {
      return {
        parsedPos: input.length,
        stoppedAt: null,
        stopAt() {
          /* completed fixture parse */
        },
        advance() {
          if (fail) throw new Error("private parser details");
          return new Tree(NodeType.none, [], [], input.length);
        },
      };
    }
  }
  let pending: ReturnType<GuardedParser["createParse"]> | undefined;
  class Capture extends GuardedParser {
    override createParse(...args: Parameters<GuardedParser["createParse"]>) {
      pending = super.createParse(...args);
      return pending;
    }
  }
  const language = new Language(
    defineLanguageFacet(),
    new Capture(new Delayed())
  );
  const state = EditorState.create({
    doc: "unsaved",
    extensions: [editorFaultSession, language],
  });
  const session = state.field(editorFaultSession);
  let notices = 0;
  session.notify = () => {
    notices++;
  };
  fail = true;
  expect(() => pending?.advance()).not.toThrow();
  await Promise.resolve();
  expect(session.fault).toBe("parser");
  expect(notices).toBe(1);
  expect(state.doc.toString()).toBe("unsaved");
});

test("stopAt failure locks the captured session and does not restart the parser", async () => {
  let calls = 0;
  class StopsBadly extends Parser {
    createParse(input: Input) {
      calls++;
      return {
        parsedPos: input.length,
        stoppedAt: null,
        stopAt() {
          throw new Error("private stop details");
        },
        advance: () => new Tree(NodeType.none, [], [], input.length),
      };
    }
  }
  let pending: ReturnType<GuardedParser["createParse"]> | undefined;
  class Capture extends GuardedParser {
    override createParse(...args: Parameters<GuardedParser["createParse"]>) {
      pending = super.createParse(...args);
      return pending;
    }
  }
  const state = EditorState.create({
    doc: "unsaved",
    extensions: [
      editorFaultSession,
      new Language(defineLanguageFacet(), new Capture(new StopsBadly())),
    ],
  });
  const session = state.field(editorFaultSession);
  let notices = 0;
  session.notify = () => notices++;
  expect(pending).toBeDefined();
  expect(() => pending!.stopAt(3)).not.toThrow();
  expect(pending!.advance()?.length).toBe(3);
  await Promise.resolve();
  expect(session.fault).toBe("parser");
  expect(notices).toBe(1);
  const next = state.update({ changes: { from: 0, insert: "x" } }).state;
  ensureSyntaxTree(next, next.doc.length, 100);
  expect(next.field(editorFaultSession)).toBe(session);
  expect(next.doc.toString()).toBe("xunsaved");
  expect(calls).toBe(1);
});
