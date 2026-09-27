import { ParseContext } from "@codemirror/language";
import { StateField } from "@codemirror/state";
import {
  NodeType,
  Parser,
  Tree,
  type Input,
  type PartialParse,
  type TreeFragment,
} from "@lezer/common";

export type EditorFaultKind = "parser" | "presentation";
export interface EditorFaultSession {
  fault: EditorFaultKind | null;
  inject: EditorFaultKind | null;
  notify?: () => void;
  recoveryFailed: boolean;
}
export const editorFaultSession = StateField.define<EditorFaultSession>({
  create: () => ({ fault: null, inject: null, recoveryFailed: false }),
  update: (value) => value,
});
export function reportEditorFault(
  session: EditorFaultSession,
  kind: EditorFaultKind
) {
  if (session.fault) return;
  session.fault = kind;
  session.inject = null;
  queueMicrotask(() => session.notify?.());
}

/** Catch only our parser boundary, including idle advance calls outside view.update. */
export class GuardedParser extends Parser {
  constructor(private readonly parser: Parser) {
    super();
  }
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ): PartialParse {
    const session = ParseContext.get()?.state.field(editorFaultSession, false);
    let delegate: PartialParse | undefined;
    let stopped: number | null = null;
    let parsed = 0;
    const failed = () => {
      if (session) reportEditorFault(session, "parser");
      delegate = undefined;
    };
    try {
      if (session?.inject === "parser") throw new Error("editor-parser-test");
      if (!session?.fault)
        delegate = this.parser.startParse(input, fragments, ranges);
    } catch {
      failed();
    }
    return {
      advance() {
        if (session?.fault) delegate = undefined;
        if (delegate) {
          try {
            const result = delegate.advance();
            parsed = delegate.parsedPos;
            return result;
          } catch {
            failed();
          }
        }
        parsed = stopped ?? input.length;
        return new Tree(NodeType.none, [], [], parsed);
      },
      get parsedPos() {
        return parsed;
      },
      get stoppedAt() {
        return stopped;
      },
      stopAt(position) {
        stopped = position;
        if (delegate) {
          try {
            delegate.stopAt(position);
          } catch {
            failed();
          }
        }
      },
    };
  }
}
