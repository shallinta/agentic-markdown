import { expect, test } from "bun:test";

import type { TransactionSpec } from "@codemirror/state";
import { EditorView, type WidgetType } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

import { createEditingImagePool } from "./editing-image-pool";
import {
  editingImageField,
  editingImagesEffect,
  currentImageCandidates,
  iterateImageCandidates,
  EditingImages,
  registerEditingImages,
  setImageSummaryWorkerFactory,
} from "./editing-images";
import { summarizeImages } from "./image-summary";
import type { ImageSummaryWorker } from "./image-summary-owner";
import { createRawEditorState, rawText } from "./raw-buffer";

test("direct StateField supplies multiline inline replacement, selection reveals raw without editing", () => {
  const raw = "before\n\n![a\nb](a.png)\n\nafter",
    summary = summarizeImages(raw),
    pool = createEditingImagePool("00000000-0000-0000-0000-000000000000", () =>
      Promise.resolve(null)
    );
  let state = createRawEditorState(raw);
  const item = {
    semantic: summary.images[0],
    source: summary.sources[0],
    pool,
    valid: () => true,
  };
  state = state.update({
    effects: editingImagesEffect.of({ reset: true, items: [item] }),
  }).state;
  expect(state.field(editingImageField).shown.size).toBe(1);
  expect(
    state
      .facet(EditorView.decorations)
      .some((value) => value === state.field(editingImageField).shown)
  ).toBe(true);
  state
    .field(editingImageField)
    .shown.between(0, state.doc.length, (_from, _to, value) =>
      expect((value.spec as { block?: boolean }).block).toBe(false)
    );
  state = state.update({ selection: { anchor: item.semantic.from + 1 } }).state;
  expect(state.field(editingImageField).shown.size).toBe(0);
  expect(state.field(rawText)).toBe(raw);
  state = state.update({ selection: { anchor: 0 } }).state;
  expect(state.field(editingImageField).shown.size).toBe(1);
  state = state.update({ changes: { from: 0, insert: "x" } }).state;
  expect(state.field(editingImageField).shown.size).toBe(0);
  pool.dispose();
});

test("actual presentation class yields between dispatch batches (no DOM/layout claim)", async () => {
  let state = createRawEditorState(
      "before\n\n" + "![a](a.png)\n\n".repeat(200)
    ),
    effects = 0;
  const identity = {},
    raw = state.field(rawText);
  let first: () => void = () => undefined;
  const firstDispatch = new Promise<void>((resolve) => {
    first = resolve;
  });
  const view = {
    get state() {
      return state;
    },
    get visibleRanges() {
      return [{ from: 0, to: state.doc.length }];
    },
    get viewport() {
      return { from: 0, to: state.doc.length };
    },
    composing: false,
    compositionStarted: false,
    plugin: () => presentation,
    dispatch(spec: TransactionSpec) {
      const transaction = state.update(spec);
      state = transaction.state;
      effects++;
      presentation.update({ docChanged: false } as ViewUpdate);
      if (effects === 1) first();
    },
  } as unknown as EditorView;
  setImageSummaryWorkerFactory(() => {
    const worker: ImageSummaryWorker = {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      terminate: () => undefined,
      postMessage: (request) =>
        queueMicrotask(() =>
          worker.onmessage?.({
            data: { ...request, summary: summarizeImages(request.text) },
          } as MessageEvent)
        ),
    };
    return worker;
  });
  const remove = registerEditingImages(
    view,
    {
      current: () => ({
        documentId: "d",
        revision: 1,
        doc: state.doc,
        rawText: raw,
        identity,
        handle: "00000000-0000-0000-0000-000000000000",
        assetEpoch: "1",
      }),
      transport: () => Promise.resolve(null),
      failed: () => undefined,
    },
    () => () => undefined
  );
  const presentation = new EditingImages(view);
  try {
    await firstDispatch;
    const batch = state.field(editingImageField).base.size;
    expect(batch).toBeGreaterThan(0);
    expect(batch).toBeLessThan(200);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(state.field(editingImageField).base.size).toBe(batch);
    for (
      let i = 0;
      i < 100 && state.field(editingImageField).base.size < 200;
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(state.field(editingImageField).base.size).toBe(200);
  } finally {
    remove();
    presentation.destroy();
    setImageSummaryWorkerFactory(undefined);
  }
});

test("long-line protection binary-skips thousands of image records", () => {
  const raw = "![a](a.png)".repeat(2000),
    state = createRawEditorState(raw),
    summary = summarizeImages(raw);
  const work = [
    ...iterateImageCandidates(
      state,
      summary,
      [{ from: 0, to: state.doc.length }],
      new Set()
    ),
  ];
  expect(work.filter(Boolean)).toHaveLength(0);
  expect(work.length).toBeLessThan(4);
});

test("widget ignores late load/error from replaced images (DOM-event seam, not layout)", async () => {
  class Element extends EventTarget {
    children: Element[] = [];
    style: Record<string, string> = {};
    className = "";
    tabIndex = 0;
    textContent = "";
    alt = "";
    title = "";
    width = 0;
    height = 0;
    src = "";
    setAttribute(_name: string, _value: string) {
      void _name;
      void _value;
      return undefined;
    }
    removeAttribute(name: string) {
      if (name === "src") this.src = "";
    }
    append(child: Element) {
      this.children.push(child);
    }
    replaceChildren() {
      this.children = [];
    }
    get firstChild() {
      return this.children[0] ?? null;
    }
  }
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document"),
    oldObserver = Object.getOwnPropertyDescriptor(
      globalThis,
      "IntersectionObserver"
    );
  let observe: ((visible: boolean) => void) | undefined;
  class Observer {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
      observe = (visible) => callback([{ isIntersecting: visible }]);
    }
    observe() {
      return undefined;
    }
    disconnect() {
      return undefined;
    }
  }
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new Element() },
  });
  Object.defineProperty(globalThis, "IntersectionObserver", {
    configurable: true,
    value: Observer,
  });
  const pool = createEditingImagePool(
    "00000000-0000-0000-0000-000000000000",
    (request) =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        mime: "image/png",
        data: "AAAA",
        width: 1,
        height: 1,
        identity: "a".repeat(64),
      })
  );
  try {
    const raw = "before ![a](a.png)",
      summary = summarizeImages(raw),
      item = {
        semantic: summary.images[0],
        source: summary.sources[0],
        pool,
        valid: () => true,
      };
    const state = createRawEditorState(raw).update({
      effects: editingImagesEffect.of({ reset: true, items: [item] }),
    }).state;
    let widget: WidgetType | undefined;
    state
      .field(editingImageField)
      .shown.between(0, raw.length, (_from, _to, value) => {
        widget = (value.spec as { widget: WidgetType }).widget;
      });
    let measurements = 0;
    const view = {
      scrollDOM: {},
      requestMeasure: () => {
        measurements++;
      },
    } as unknown as EditorView;
    const root = widget!.toDOM(view) as unknown as Element;
    observe!(true);
    for (let i = 0; i < 8; i++) await Promise.resolve();
    const oldImage = root.firstChild;
    observe!(true);
    const newImage = root.firstChild;
    expect(newImage).not.toBe(oldImage);
    const before = measurements;
    oldImage.dispatchEvent(new Event("error"));
    oldImage.dispatchEvent(new Event("load"));
    expect(root.firstChild).toBe(newImage);
    expect(measurements).toBe(before);
    expect(pool.diagnostics().presentation).toBe(4);
    widget!.destroy(root as unknown as HTMLElement);
    newImage.dispatchEvent(new Event("error"));
    expect(pool.diagnostics().presentation).toBe(0);
  } finally {
    pool.dispose();
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (oldObserver)
      Object.defineProperty(globalThis, "IntersectionObserver", oldObserver);
    else Reflect.deleteProperty(globalThis, "IntersectionObserver");
  }
});

test("selection inside adjacent image preserves its unselected neighbor", () => {
  const raw = "![a](a.png)![b](b.png) end",
    summary = summarizeImages(raw),
    pool = createEditingImagePool("00000000-0000-0000-0000-000000000000", () =>
      Promise.resolve(null)
    );
  let state = createRawEditorState(raw).update({
    selection: { anchor: raw.length },
  }).state;
  state = state.update({
    effects: editingImagesEffect.of({
      reset: true,
      items: summary.images.map((semantic) => ({
        semantic,
        source: summary.sources[semantic.source],
        pool,
        valid: () => true,
      })),
    }),
  }).state;
  expect(state.field(editingImageField).shown.size).toBe(2);
  state = state.update({ selection: { anchor: 5 } }).state;
  const shown: number[] = [];
  state.field(editingImageField).shown.between(0, raw.length, (from) => {
    shown.push(from);
  });
  expect(shown).toEqual([summary.images[1].from]);
  pool.dispose();
});
test("current range lookup rejects mismatched image and does not return known candidates", () => {
  const raw = "![a](a.png)\n\n![b](b.png)",
    state = createRawEditorState(raw),
    summary = summarizeImages(raw);
  expect(
    currentImageCandidates(state, summary, [{ from: 0, to: 10 }], new Set())
  ).toEqual([summary.images[0]]);
  expect(
    currentImageCandidates(
      state,
      summary,
      [{ from: 0, to: state.doc.length }],
      new Set(summary.images.map((i) => i.from))
    )
  ).toEqual([]);
  const wrong = {
    ...summary,
    images: [{ ...summary.images[0], to: summary.images[0].to - 1 }],
  };
  expect(
    currentImageCandidates(
      state,
      wrong,
      [{ from: 0, to: state.doc.length }],
      new Set()
    )
  ).toEqual([]);
});
