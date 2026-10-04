import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";

import CanonicalWorker from "../src/client/current-canonical.worker?worker";
import { createDocumentCanonical } from "../src/client/document-canonical";
import { createDocumentController } from "../src/client/documents";
import { createReadingThemeSelection } from "../src/client/reading-theme";
import { ReadingView } from "../src/components/reading-view";
import { analyzeTextFidelity } from "../src/shared/text-fidelity";

const texts = ["A", "B"].map((id) => ({
  handle:
    id === "A"
      ? "00000000-0000-4000-8000-000000000001"
      : "00000000-0000-4000-8000-000000000002",
  documentId:
    id === "A"
      ? "00000000-0000-4000-8000-000000000001"
      : "00000000-0000-4000-8000-000000000002",
  fileName: `${id}.md`,
  revision: 1,
  hash: "a".repeat(64),
  text: Array.from(
    { length: 30 },
    (_, i) => `## ${id}${i}\n\n${"正文内容 ".repeat(50)}\n\n`
  ).join(""),
}));
const values = texts.map((value) => ({
  ...value,
  byteLength: new TextEncoder().encode(value.text).length,
  fidelity: analyzeTextFidelity(value.text),
  writeCapability: { writable: true, reason: "writable" as const },
}));
let next = 0;
let outcome: "normal" | "cancel" | "failure" = "normal";
const controller = createDocumentController({
  cancelDocument: (request) => Promise.resolve({ ...request, ok: true, snapshot: null }),
  selectDocument: async (request) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (outcome === "failure") throw Error("controlled transport failure");
    return {
      ...request,
      ok: true,
      snapshot: outcome === "cancel" ? null : values[next++ % values.length],
    };
  },
  readDocument: (request) => Promise.resolve({
    ...request,
    ok: true,
    snapshot: values[0],
  }),
  releaseDocument: (request) => Promise.resolve({
    ...request,
    ok: true,
    snapshot: null,
  }),
});
const canonical = createDocumentCanonical(
  controller,
  () => new CanonicalWorker()
);
controller.subscribe(canonical.invalidate);
await controller.select();
controller.toggleReadingMode();
await controller.select();
controller.toggleReadingMode();
controller.activateTab(values[0].documentId);
const themes = createReadingThemeSelection(
  controller.captureCurrentViewport,
  controller.canChangeReadingTheme
);
Object.assign(window, {
  positionHarness: {
    controller,
    canonical,
    themes,
    setOutcome(value: typeof outcome) {
      outcome = value;
    },
  },
});
function App() {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot
  );
  const theme = useSyncExternalStore(themes.subscribe, themes.getSnapshot);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: 400 }}>
      {controller.getMode(state.snapshot!.documentId) === "reading" ? (
        <ReadingView
          controller={controller}
          canonical={canonical}
          documentId={state.snapshot!.documentId}
          frozen={state.busy || state.frozen}
          theme={theme}
        />
      ) : (
        <pre data-editor-placeholder="">
          Non-reading view: viewport regression does not exercise CodeMirror.
        </pre>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
