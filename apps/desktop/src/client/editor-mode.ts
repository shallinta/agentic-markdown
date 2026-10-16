import { HighlightStyle } from "@codemirror/language";
import { Compartment, Facet, EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { editorFaultSession, reportEditorFault } from "./editor-fault";
import {
  mode,
  safe,
  getEditorMode,
  isSafeSource,
  type EditorMode,
} from "./editor-mode-state";
export {
  getEditorMode,
  isSafeSource,
  type EditorMode,
} from "./editor-mode-state";
import {
  frontmatterPresentation,
  frontmatterTheme,
} from "./frontmatter-presentation";
import { frontmatterEditing, unfoldFrontmatter } from "./frontmatter-structure";
import { clearHeadingFolds, headingFolding } from "./heading-folding";
import {
  editingMarkdown,
  createEditingMarkdown,
  livePresentation,
} from "./live-formatting";
import { protectedSourceHighlighting } from "./source-highlighting";

export const sourceHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.heading,
      tags.strong,
      tags.emphasis,
      tags.strikethrough,
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
const wrapping = new Compartment();
const wrappingPreference = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true,
});
const wrapExtension = (mode: EditorMode, enabled: boolean) => [
  wrappingPreference.of(enabled),
  mode === "editing" || enabled ? EditorView.lineWrapping : [],
];
export const getSourceWrapping = (state: EditorState) =>
  state.facet(wrappingPreference);
export const sourceWrappingEffect = (state: EditorState, enabled: boolean) =>
  wrapping.reconfigure(
    wrapExtension(
      isSafeSource(state) ? "editing" : getEditorMode(state),
      enabled
    )
  );
const parserLanguage = new Compartment();
const sourcePresentation = [
  frontmatterEditing.of(false),
  mode.of("source"),
  EditorState.allowMultipleSelections.of(true),
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
  wrapping.of(wrapExtension("editing", true)),
  editorFaultSession,
  headingFolding,
  frontmatterPresentation,
  frontmatterTheme,
  EditorView.exceptionSink.compute([editorFaultSession], (state) => {
    const session = state.field(editorFaultSession);
    return () => reportEditorFault(session, "presentation");
  }),
  parserLanguage.of(isolated ? [] : editingMarkdown),
  presentation.of(
    isolated
      ? [mode.of("source"), safe.of(true), frontmatterEditing.of(false)]
      : livePresentation
  ),
];
export const editorModeExtensions = createEditorModeExtensions();
/** Release/rebuild derived parsing only; never switch mode or lift fault isolation. */
/** Inactive tabs retain presentation state; fault/explicit pauses must clear it. */
export const pauseEditorParser = (inactiveTab = false) => [
  ...(inactiveTab ? [] : [clearHeadingFolds.of(null)]),
  parserLanguage.reconfigure([]),
];
export const resumeEditorParser = (state: EditorState) =>
  parserLanguage.reconfigure(isSafeSource(state) ? [] : editingMarkdown);
export const safeSourceEffects = () => [
  clearHeadingFolds.of(null),
  wrapping.reconfigure(wrapExtension("editing", true)),
  parserLanguage.reconfigure([]),
  presentation.reconfigure([
    mode.of("source"),
    safe.of(true),
    frontmatterEditing.of(false),
  ]),
];
export const restartParserForFaultTest = () =>
  parserLanguage.reconfigure(createEditingMarkdown());
export const switchEditorMode = (next: EditorMode, sourceWrap = true) => [
  ...(next === "source" ? [unfoldFrontmatter.of(null)] : []),
  wrapping.reconfigure(wrapExtension(next, sourceWrap)),
  presentation.reconfigure(
    next === "source" ? sourcePresentation : livePresentation
  ),
];
