import { undo } from "@codemirror/commands";
import { Language, syntaxParserRunning } from "@codemirror/language";
import { Compartment, EditorSelection, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Parser, type Input, type TreeFragment } from "@lezer/common";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";
import type { PerfRow } from "../shared/perf-lab";

import { switchEditorMode } from "./editor-mode";
import { editingMarkdown } from "./live-formatting";
import { createRawEditorState, rawText } from "./raw-buffer";

/** Counters wrap the real parser; no sleeps, artificial yields or global mutation. */
export class MeasuredParser extends Parser {
  advances = 0;
  advanceMs = 0;
  destroyed = false;
  afterDestroy = 0;
  afterDestroyMs = 0;
  constructor(private readonly delegate: Parser) {
    super();
  }
  createParse(
    input: Input,
    fragments: readonly TreeFragment[],
    ranges: readonly { from: number; to: number }[]
  ) {
    const parse = this.delegate.createParse(input, fragments, ranges);
    return {
      advance: () => {
        const start = performance.now();
        try {
          return parse.advance();
        } finally {
          const elapsed = performance.now() - start;
          this.advances++;
          this.advanceMs += elapsed;
          if (this.destroyed) {
            this.afterDestroy++;
            this.afterDestroyMs += elapsed;
          }
        }
      },
      get parsedPos() {
        return parse.parsedPos;
      },
      get stoppedAt() {
        return parse.stoppedAt;
      },
      stopAt(position: number) {
        parse.stopAt(position);
      },
    };
  }
}

class Unavailable extends Error {}
function abort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Probe cancelled", "AbortError");
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  abort(signal);
  return new Promise((resolve, reject) => {
    const stop = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      stop();
      reject(new DOMException("Probe cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      stop();
      resolve();
    }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
function frame(window: Window, signal: AbortSignal): Promise<void> {
  abort(signal);
  return new Promise((resolve, reject) => {
    const stop = () => {
      window.cancelAnimationFrame(id);
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      stop();
      reject(new DOMException("Probe cancelled", "AbortError"));
    };
    const id = window.requestAnimationFrame(() => {
      stop();
      resolve();
    });
    const timer = setTimeout(() => {
      stop();
      reject(new Unavailable("No animation frame"));
    }, 1200);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
export const lifecycleOutcome = (
  controlPending: boolean,
  cancelledPending: boolean,
  progress: number,
  afterDestroy: number
): PerfRow["status"] =>
  afterDestroy > 0
    ? "failed"
    : !controlPending || !cancelledPending || progress <= 0
      ? "unsupported"
      : "ok";

function host(container: HTMLElement) {
  const element = container.ownerDocument.createElement("div");
  element.style.height = "240px";
  element.style.width = "100%";
  element.style.overflow = "hidden";
  container.append(element);
  return element;
}
function byteSize(raw: string) {
  const size = new TextEncoder().encode(raw).length;
  if (size > MAX_DOCUMENT_BYTES) throw new Error("Probe sample too large");
  return size;
}

export async function runEditorViewProbe(
  container: HTMLElement,
  onProgress: (text: string) => void,
  signal: AbortSignal
): Promise<PerfRow[]> {
  const rows: PerfRow[] = [];
  const window = container.ownerDocument.defaultView;
  if (!window) throw new Unavailable("No window");
  for (const units of [10_000, 50_000, 200_000])
    for (const mode of ["editing", "source"] as const) {
      const raw = "\uFEFF# 合成视图探针\n\n" + "x".repeat(units);
      const row: PerfRow = {
        bytes: byteSize(raw),
        shape: "long-line",
        route: "cm-long-line-view",
        status: "failed",
        metrics: {
          mode: mode === "editing" ? 0 : 1,
          lineUnits: units,
          viewCreateMs: null,
          dispatchMs: null,
          twoFramesMs: null,
          coordsAvailable: null,
          roundTripDelta: null,
          rawMatches: null,
          undoMatches: null,
        },
      };
      let view: EditorView | undefined;
      const parent = host(container);
      try {
        abort(signal);
        onProgress(
          `真实视图探针：${units} 单位，${mode === "editing" ? "编辑" : "源码"}模式`
        );
        let state = createRawEditorState(raw);
        if (mode === "source")
          state = state.update({ effects: switchEditorMode(mode) }).state;
        const start = performance.now();
        view = new EditorView({ state, parent });
        row.metrics.viewCreateMs = performance.now() - start;
        const position = view.state.doc.length;
        const dispatchStart = performance.now();
        view.dispatch({
          changes: { from: position, insert: "!" },
          selection: EditorSelection.cursor(position + 1),
          scrollIntoView: true,
          userEvent: "input.type",
        });
        row.metrics.dispatchMs = performance.now() - dispatchStart;
        const framesStart = performance.now();
        await frame(window, signal);
        await frame(window, signal);
        row.metrics.twoFramesMs = performance.now() - framesStart;
        const coordinates = view.coordsAtPos(position + 1);
        const back =
          coordinates &&
          view.posAtCoords({
            x: (coordinates.left + coordinates.right) / 2,
            y: (coordinates.top + coordinates.bottom) / 2,
          });
        row.metrics.coordsAvailable = coordinates && back !== null ? 1 : 0;
        row.metrics.roundTripDelta =
          back === null ? null : Math.abs(back - position - 1);
        row.metrics.rawMatches =
          view.state.field(rawText) === raw + "!" ? 1 : 0;
        const undone = undo(view);
        row.metrics.undoMatches =
          undone && view.state.field(rawText) === raw ? 1 : 0;
        row.status =
          row.metrics.rawMatches !== 1 || row.metrics.undoMatches !== 1
            ? "failed"
            : !row.metrics.coordsAvailable
              ? "unsupported"
              : row.metrics.roundTripDelta === 0
                ? "ok"
                : "failed";
      } catch (error) {
        row.status = signal.aborted
          ? "cancelled"
          : error instanceof Unavailable
            ? "unsupported"
            : "failed";
      } finally {
        view?.destroy();
        parent.remove();
        rows.push(row);
      }
      if (signal.aborted) return rows;
    }

  const raw =
    "\uFEFF# 中文生命周期\n\n" +
    "paragraph **bold** *emphasis* [link](local.md)\n\n".repeat(16_000);
  const row: PerfRow = {
    bytes: byteSize(raw),
    shape: "lines",
    route: "cm-parser-lifecycle",
    status: "failed",
    metrics: {
      observationMs: null,
      controlPending: null,
      cancelledPending: null,
      controlAdvanceCount: null,
      controlAdvanceMs: null,
      cancelledAdvanceCount: null,
      afterDestroyAdvanceCount: null,
      afterDestroyAdvanceMs: null,
      rawMatches: null,
      selectionMatches: null,
      historyMatches: null,
    },
  };
  const controlParser = new MeasuredParser(editingMarkdown.parser),
    cancelledParser = new MeasuredParser(editingMarkdown.parser);
  const compartment = new Compartment();
  const parent = host(container),
    controlParent = host(container);
  let control: EditorView | undefined,
    cancelled: EditorView | undefined,
    restored: EditorView | undefined;
  try {
    abort(signal);
    onProgress("真实视图探针：解析正对照与销毁观察（最多 1200ms）");
    const language = (parser: Parser) =>
      Prec.high(
        new Language(editingMarkdown.data, parser, [], "markdown-measured")
      );
    control = new EditorView({
      state: createRawEditorState(raw, language(controlParser)),
      parent: controlParent,
    });
    let state = createRawEditorState(
      raw,
      compartment.of(language(cancelledParser))
    );
    state = state.update({
      changes: { from: 0, insert: "!" },
      selection: EditorSelection.range(2, 7),
      userEvent: "input.type",
    }).state;
    cancelled = new EditorView({ state, parent });
    const controlPending = syntaxParserRunning(control),
      cancelledPending = syntaxParserRunning(cancelled);
    row.metrics.controlPending = Number(controlPending);
    row.metrics.cancelledPending = Number(cancelledPending);
    const baseline = controlParser.advances,
      baselineMs = controlParser.advanceMs;
    state = cancelled.state;
    cancelled.destroy();
    cancelled = undefined;
    cancelledParser.destroyed = true;
    const observation = performance.now();
    await wait(1200, signal);
    row.metrics.observationMs = performance.now() - observation;
    row.metrics.controlAdvanceCount = controlParser.advances - baseline;
    row.metrics.controlAdvanceMs = controlParser.advanceMs - baselineMs;
    row.metrics.cancelledAdvanceCount = cancelledParser.advances;
    row.metrics.afterDestroyAdvanceCount = cancelledParser.afterDestroy;
    row.metrics.afterDestroyAdvanceMs = cancelledParser.afterDestroyMs;
    row.status = lifecycleOutcome(
      controlPending,
      cancelledPending,
      row.metrics.controlAdvanceCount,
      cancelledParser.afterDestroy
    );
    // Remove the probe-only language before recreating; never reuse its counters.
    state = state.update({ effects: compartment.reconfigure([]) }).state;
    restored = new EditorView({ state, parent });
    row.metrics.rawMatches =
      restored.state.field(rawText) === "!" + raw ? 1 : 0;
    row.metrics.selectionMatches =
      restored.state.selection.main.anchor === 2 &&
      restored.state.selection.main.head === 7
        ? 1
        : 0;
    row.metrics.historyMatches =
      undo(restored) && restored.state.field(rawText) === raw ? 1 : 0;
    if (
      row.metrics.rawMatches !== 1 ||
      row.metrics.selectionMatches !== 1 ||
      row.metrics.historyMatches !== 1
    )
      row.status = "failed";
  } catch (error) {
    row.status = signal.aborted
      ? "cancelled"
      : error instanceof Unavailable
        ? "unsupported"
        : "failed";
  } finally {
    control?.destroy();
    cancelled?.destroy();
    restored?.destroy();
    parent.remove();
    controlParent.remove();
    rows.push(row);
  }
  return rows;
}
