import { Facet, type EditorState } from "@codemirror/state";

/** State-only identity shared by presentation and input consumers. */
export type EditorMode = "editing" | "source";
export const mode = Facet.define<EditorMode, EditorMode>({
  combine: (values) => values[0] ?? "editing",
});
export const safe = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});
export const getEditorMode = (state: EditorState) => state.facet(mode);
export const isSafeSource = (state: EditorState) => state.facet(safe);
