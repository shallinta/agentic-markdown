import { HighlightStyle } from "@codemirror/language";
import { Compartment, Facet, type EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { editorFaultSession, reportEditorFault } from "./editor-fault";
import {
  editingMarkdown,
  createEditingMarkdown,
  livePresentation,
} from "./live-formatting";
import { protectedSourceHighlighting } from "./source-highlighting";

export type EditorMode = "editing" | "source";
const mode = Facet.define<EditorMode, EditorMode>({
  combine: (values) => values[0] ?? "editing",
});
export const sourceHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.heading,
      tags.strong,
      tags.emphasis,
      tags.quote,
      tags.list,
      tags.content,
      tags.string,
    ],
    color: "var(--foreground)",
  },
  {
    tag: [
      tags.processingInstruction,
      tags.punctuation,
      tags.meta,
      tags.contentSeparator,
      tags.escape,
      tags.character,
      tags.labelName,
      tags.comment,
    ],
    color: "var(--muted-foreground)",
  },
  {
    tag: [tags.link, tags.url],
    color: "var(--foreground)",
  },
  {
    tag: tags.monospace,
    color: "var(--muted-foreground)",
  },
]);
const presentation = new Compartment();
const parserLanguage = new Compartment();
const safe = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});
const sourcePresentation = [
  mode.of("source"),
  protectedSourceHighlighting(sourceHighlightStyle),
  lineNumbers(),
  highlightActiveLine(),
  highlightActiveLineGutter(),
  EditorView.theme({
    ".cm-gutters": {
      backgroundColor: "var(--background)",
      color: "var(--muted-foreground)",
      borderRight: "1px solid var(--border)",
    },
    ".cm-activeLine": {
      backgroundColor: "color-mix(in oklab, var(--foreground) 5%, transparent)",
    },
    ".cm-activeLineGutter": {
      backgroundColor:
        "color-mix(in oklab, var(--foreground) 8%, var(--background))",
      color: "var(--foreground)",
    },
  }),
];
export const createEditorModeExtensions = (isolated = false) => [
  editorFaultSession,
  EditorView.exceptionSink.compute([editorFaultSession], (state) => {
    const session = state.field(editorFaultSession);
    return () => reportEditorFault(session, "presentation");
  }),
  parserLanguage.of(isolated ? [] : editingMarkdown),
  presentation.of(
    isolated ? [mode.of("source"), safe.of(true)] : livePresentation
  ),
];
export const editorModeExtensions = createEditorModeExtensions();
export const isSafeSource = (state: EditorState) => state.facet(safe);
/** Release/rebuild derived parsing only; never switch mode or lift fault isolation. */
export const pauseEditorParser = () => parserLanguage.reconfigure([]);
export const resumeEditorParser = (state: EditorState) =>
  parserLanguage.reconfigure(isSafeSource(state) ? [] : editingMarkdown);
export const safeSourceEffects = () => [
  parserLanguage.reconfigure([]),
  presentation.reconfigure([mode.of("source"), safe.of(true)]),
];
export const restartParserForFaultTest = () =>
  parserLanguage.reconfigure(createEditingMarkdown());
export const getEditorMode = (state: EditorState) => state.facet(mode);
export const switchEditorMode = (next: EditorMode) =>
  presentation.reconfigure(
    next === "source" ? sourcePresentation : livePresentation
  );
