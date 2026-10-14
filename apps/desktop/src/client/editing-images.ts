import { syntaxTree, syntaxTreeAvailable } from "@codemirror/language";
import {
  StateEffect,
  StateField,
  type Range,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import {
  createEditingImagePool,
  type EditingImageLease,
  type EditingImagePool,
} from "./editing-image-pool";
import {
  createImageSummaryOwner,
  type ImageSummaryIdentity,
  type ImageSummaryWorker,
} from "./image-summary-owner";
import type {
  ImageSemantic,
  ImageSource,
  ImageSummary,
} from "./image-summary-types";
import { imagePlaceholder, type ImageTransport } from "./local-images";
import { longLineProtection } from "./long-line-protection";

interface Binding {
  current: () =>
    (ImageSummaryIdentity & { handle: string; assetEpoch: string }) | null;
  transport: ImageTransport;
  failed: (retry: () => void) => void;
}
const bindings = new WeakMap<EditorView, Binding>();
let workerFactory: (() => ImageSummaryWorker) | undefined;
export function setImageSummaryWorkerFactory(
  factory: (() => ImageSummaryWorker) | undefined
) {
  workerFactory = factory;
}
export function observeEditingImages(view: EditorView) {
  view.plugin(editingImagePlugin)?.observe();
}
export function registerEditingImages(
  view: EditorView,
  binding: Binding,
  subscribe: (fn: () => void) => () => void
) {
  bindings.set(view, binding);
  const observe = () =>
    queueMicrotask(() => {
      if (bindings.get(view) === binding)
        view.plugin(editingImagePlugin)?.observe();
    });
  const unsubscribe = subscribe(observe);
  observe();
  return () => {
    unsubscribe();
    if (bindings.get(view) === binding) {
      bindings.delete(view);
      view.plugin(editingImagePlugin)?.observe();
    }
  };
}
export interface EditingImageItem {
  semantic: ImageSemantic;
  source: ImageSource;
  pool: EditingImagePool;
  valid: () => boolean;
  width?: number;
  height?: number;
}
const setImages = StateEffect.define<{
  reset: boolean;
  items: EditingImageItem[];
}>();
export const editingImagesEffect = setImages;
function active(state: EditorState, from: number, to: number) {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

class ImageWidget extends WidgetType {
  constructor(readonly item: EditingImageItem) {
    super();
  }
  eq(other: ImageWidget) {
    return this.item === other.item;
  }
  toDOM(view: EditorView) {
    const item = this.item,
      root = document.createElement("span");
    root.className = "cm-editing-image";
    root.tabIndex = 0;
    root.setAttribute("role", "button");
    root.setAttribute("aria-label", "显示图片 Markdown 原文");
    let lease: EditingImageLease | null = null,
      observer: IntersectionObserver | undefined,
      dead = false,
      decodeFailed = false,
      renderToken = 0;
    let displayed: HTMLImageElement | null = null;
    const clear = () => {
      displayed?.removeAttribute("src");
      displayed = null;
      root.replaceChildren();
    };
    const blocked = imagePlaceholder(item.source.url);
    const measure = () => {
      if (!dead) view.requestMeasure();
    };
    const render = () => {
      const token = ++renderToken;
      const state = lease?.getSnapshot();
      if (state?.status === "released") {
        clear();
        return;
      }
      if (dead || !item.valid()) return;
      clear();
      if (item.width && item.height) {
        root.style.aspectRatio = `${item.width} / ${item.height}`;
        root.style.width = `min(100%, ${item.width}px)`;
      }
      if (state?.status === "ready") {
        const value = state.result;
        item.width = value.width;
        item.height = value.height;
        root.style.aspectRatio = `${value.width} / ${value.height}`;
        root.style.width = `min(100%, ${value.width}px)`;
        const image = document.createElement("img");
        displayed = image;
        image.alt = item.semantic.alt;
        if (item.source.title !== null) image.title = item.source.title;
        image.width = value.width;
        image.height = value.height;
        image.src = `data:${value.mime};base64,${value.data}`;
        const imageLease = lease;
        const current = () =>
          !dead &&
          renderToken === token &&
          item.valid() &&
          root.firstChild === image &&
          lease === imageLease;
        image.addEventListener(
          "load",
          () => {
            if (current()) measure();
          },
          { once: true }
        );
        image.addEventListener(
          "error",
          () => {
            if (current()) {
              decodeFailed = true;
              clear();
              lease?.release();
              lease = null;
              root.textContent = "图片无法显示";
              measure();
            }
          },
          { once: true }
        );
        root.append(image);
      } else
        root.textContent =
          blocked ??
          (decodeFailed
            ? "图片无法显示"
            : state?.status === "failed"
              ? "图片无法读取"
              : state?.status === "budget"
                ? "图片资源空间不足"
                : "图片加载中…");
      measure();
    };
    const demand = (visible: boolean) => {
      if (dead) return;
      if (visible && item.valid()) {
        if (!blocked && !decodeFailed)
          lease ??= item.pool.acquire(item.source.url, render);
        render();
      } else if (lease) {
        renderToken++;
        clear();
        lease.release();
        lease = null;
      }
    };
    const reveal = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      if (item.valid() && !view.composing && !view.compositionStarted) {
        view.dispatch({ selection: { anchor: item.semantic.from + 1 } });
        view.focus();
      }
    };
    root.addEventListener("click", reveal);
    root.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        reveal(event);
      }
    });
    if (typeof IntersectionObserver === "function") {
      observer = new IntersectionObserver(
        (entries) => demand(entries.some((e) => e.isIntersecting)),
        { root: view.scrollDOM, rootMargin: "200px" }
      );
      observer.observe(root);
    } else demand(true);
    widgetCleanup.set(root, () => {
      dead = true;
      renderToken++;
      observer?.disconnect();
      clear();
      lease?.release();
      lease = null;
    });
    return root;
  }
  destroy(dom: HTMLElement) {
    widgetCleanup.get(dom)?.();
    widgetCleanup.delete(dom);
  }
  ignoreEvent() {
    return true;
  }
}
const widgetCleanup = new WeakMap<HTMLElement, () => void>();
interface ImageField {
  base: DecorationSet;
  shown: DecorationSet;
}
export const editingImageField = StateField.define<ImageField>({
  create: () => ({ base: Decoration.none, shown: Decoration.none }),
  update(value, tr) {
    if (tr.docChanged)
      value = { base: Decoration.none, shown: Decoration.none };
    for (const effect of tr.effects)
      if (effect.is(setImages)) {
        if (effect.value.reset)
          value = { base: Decoration.none, shown: Decoration.none };
        const ranges = effect.value.items.map((item) =>
          Decoration.replace({
            widget: new ImageWidget(item),
            block: false,
            inclusive: false,
          }).range(item.semantic.from, item.semantic.to)
        );
        value = {
          base: value.base.update({ add: ranges, sort: true }),
          shown: value.shown.update({
            add: ranges.filter((r) => !active(tr.state, r.from, r.to)),
            sort: true,
          }),
        };
      }
    if (tr.selection) {
      let shown = value.shown;
      // Only old/new selected intervals can change visibility. Never scan all images.
      for (const r of [
        ...tr.startState.selection.ranges,
        ...tr.state.selection.ranges,
      ]) {
        const add: Range<Decoration>[] = [];
        const affected = new Set<number>();
        let from = r.from,
          to = r.to;
        value.base.between(r.from, r.to, (a, b, deco) => {
          affected.add(a);
          from = Math.min(from, a);
          to = Math.max(to, b);
          if (!active(tr.state, a, b)) add.push(deco.range(a, b));
        });
        shown = shown.update({
          filterFrom: from,
          filterTo: to,
          filter: (a) => !affected.has(a),
          add,
          sort: true,
        });
      }
      value = { base: value.base, shown };
    }
    return value;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.shown),
});

function firstAt(images: readonly ImageSemantic[], position: number) {
  let lo = 0,
    hi = images.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (images[mid].to < position) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function imageScanRanges(
  state: EditorState,
  ranges: readonly { from: number; to: number }[]
) {
  const output: { from: number; to: number }[] = [],
    protectedRanges = state.field(longLineProtection, false) ?? [];
  for (const range of ranges) {
    let from = range.from;
    for (const p of protectedRanges) {
      if (p.to < from) continue;
      if (p.from > range.to) break;
      if (p.from > from) output.push({ from, to: p.from - 1 });
      from = Math.max(from, p.to + 1);
      if (from > range.to) break;
    }
    if (from <= range.to) output.push({ from, to: range.to });
  }
  return output;
}
/** Current-tree lookup is limited to summary images intersecting visible ranges.
 * No asynchronous range is installed unless current Lezer has that exact Image. */
export function* iterateImageCandidates(
  state: EditorState,
  summary: ImageSummary,
  ranges: readonly { from: number; to: number }[],
  known: ReadonlySet<number>
): Generator<ImageSemantic | null> {
  const seen = new Set<number>(),
    tree = syntaxTree(state);
  const protectedRanges = state.field(longLineProtection, false) ?? [];
  for (const range of ranges)
    for (
      let i = firstAt(summary.images, range.from);
      i < summary.images.length && summary.images[i].from <= range.to;
      i++
    ) {
      const image = summary.images[i];
      yield null;
      let lo = 0,
        hi = protectedRanges.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (protectedRanges[mid].to < image.from) lo = mid + 1;
        else hi = mid;
      }
      const protectedRange = protectedRanges[lo];
      if (protectedRange && protectedRange.from <= image.to) {
        i = Math.max(i, firstAt(summary.images, protectedRange.to + 1) - 1);
        continue;
      }
      if (known.has(image.from) || seen.has(image.from)) continue;
      seen.add(image.from);
      if (!syntaxTreeAvailable(state, image.to)) continue;
      let node = tree.resolveInner(image.from + 1, 1);
      while (node.parent && node.name !== "Image") {
        yield null;
        node = node.parent;
      }
      if (
        node.name === "Image" &&
        node.from === image.from &&
        node.to === image.to
      )
        yield image;
    }
}
export function currentImageCandidates(
  state: EditorState,
  summary: ImageSummary,
  ranges: readonly { from: number; to: number }[],
  known: ReadonlySet<number>
) {
  return [...iterateImageCandidates(state, summary, ranges, known)].filter(
    (image): image is ImageSemantic => image !== null
  );
}

export class EditingImages {
  private owner: ReturnType<typeof createImageSummaryOwner> | undefined;
  private pool: EditingImagePool | undefined;
  private poolKey = "";
  private poolHandle = "";
  private queryTree: ReturnType<typeof syntaxTree> | undefined;
  private queryRanges = "";
  private candidate = false;
  private summary: ImageSummary | undefined;
  private known = new Set<number>();
  private queued = false;
  private observeTimer: ReturnType<typeof setTimeout> | undefined;
  private dead = false;
  private failed = false;
  private query: Generator<ImageSemantic | null> | undefined;
  private continueTimer: ReturnType<typeof setTimeout> | undefined;
  constructor(readonly view: EditorView) {
    this.observe();
  }
  update(update: ViewUpdate) {
    if (update.docChanged) {
      this.summary = undefined;
      this.known.clear();
    }
    this.observe();
  }
  observe() {
    if (this.dead || this.queued) return;
    this.queued = true;
    this.observeTimer = setTimeout(() => {
      this.observeTimer = undefined;
      this.queued = false;
      this.refresh();
    }, 0);
  }
  private refresh() {
    if (this.dead) return;
    const binding = bindings.get(this.view),
      source = binding?.current();
    if (!binding || !source || !workerFactory) {
      clearTimeout(this.continueTimer);
      this.continueTimer = undefined;
      this.query = undefined;
      this.owner?.observe(false);
      this.pool?.invalidate();
      this.summary = undefined;
      this.known.clear();
      if (
        !this.view.composing &&
        !this.view.compositionStarted &&
        this.view.state.field(editingImageField, false)?.base.size
      )
        this.view.dispatch({
          effects: setImages.of({ reset: true, items: [] }),
        });
      return;
    }
    if (!this.owner)
      this.owner = createImageSummaryOwner(
        () => bindings.get(this.view)?.current() ?? null,
        workerFactory,
        () => this.observe()
      );
    const key = `${source.handle}:${source.assetEpoch}`;
    if (key !== this.poolKey || !this.pool) {
      if (this.pool && this.poolHandle === source.handle)
        this.pool.invalidate();
      else {
        this.pool?.dispose();
        this.pool = createEditingImagePool(source.handle, binding.transport);
      }
      this.poolKey = key;
      this.poolHandle = source.handle;
      this.known.clear();
      this.summary = undefined;
    }
    // A reliable visible Image starts the summary, even if it is not yet resolved.
    const tree = syntaxTree(this.view.state),
      rangeKey = this.view.visibleRanges
        .map((r) => `${r.from}:${r.to}`)
        .join(","),
      queryChanged = tree !== this.queryTree || rangeKey !== this.queryRanges;
    if (queryChanged) {
      this.queryTree = tree;
      this.queryRanges = rangeKey;
      this.candidate = false;
      for (const range of imageScanRanges(
        this.view.state,
        this.view.visibleRanges
      )) {
        tree.iterate({
          from: range.from,
          to: range.to,
          enter: (n) => {
            if (n.name === "Image") {
              this.candidate = true;
              return false;
            }
            return this.candidate ? false : undefined;
          },
        });
        if (this.candidate) break;
      }
    }
    let visibleKnown = false;
    this.view.state
      .field(editingImageField)
      .base.between(this.view.viewport.from, this.view.viewport.to, () => {
        visibleKnown = true;
      });
    this.owner.observe(this.candidate || visibleKnown);
    const state = this.owner.getSnapshot();
    if (state.status === "failed") {
      if (!this.failed) {
        this.failed = true;
        binding.failed(() => {
          this.failed = false;
          this.owner?.retry();
          this.observe();
        });
      }
      return;
    }
    if (state.status !== "ready" || !this.owner.isCurrent()) return;
    this.failed = false;
    const reset = this.summary !== state.summary;
    if (reset) {
      this.known.clear();
      this.summary = state.summary;
    }
    if (reset || queryChanged)
      this.query = iterateImageCandidates(
        this.view.state,
        state.summary,
        this.view.visibleRanges,
        this.known
      );
    if (!this.query) return;
    const found: ImageSemantic[] = [];
    for (let work = 0; work < 128; work++) {
      const next = this.query.next();
      if (next.done) {
        this.query = undefined;
        break;
      }
      if (next.value) found.push(next.value);
    }
    const items = found.map((semantic) => {
      this.known.add(semantic.from);
      const captured = source,
        epoch = source.assetEpoch,
        summary = state.summary;
      return {
        semantic,
        source: summary.sources[semantic.source],
        pool: this.pool!,
        valid: () => {
          const current = bindings.get(this.view)?.current();
          return (
            !!current &&
            current.doc === captured.doc &&
            current.identity === captured.identity &&
            current.revision === captured.revision &&
            current.assetEpoch === epoch &&
            this.owner?.getSnapshot().status === "ready" &&
            this.summary === summary
          );
        },
      };
    });
    if (reset || items.length)
      this.view.dispatch({ effects: setImages.of({ reset, items }) });
    if (this.query && this.continueTimer === undefined)
      this.continueTimer = setTimeout(() => {
        this.continueTimer = undefined;
        this.observe();
      }, 0);
  }
  destroy() {
    this.dead = true;
    clearTimeout(this.observeTimer);
    clearTimeout(this.continueTimer);
    this.owner?.dispose();
    this.pool?.dispose();
  }
}
export const editingImagePlugin = ViewPlugin.fromClass(EditingImages);
export const editingImages = [
  editingImageField,
  editingImagePlugin,
  EditorView.baseTheme({
    ".cm-editing-image": {
      display: "inline-block",
      maxWidth: "100%",
      verticalAlign: "middle",
      color: "var(--muted-foreground)",
      backgroundColor: "var(--muted)",
      cursor: "pointer",
      overflow: "hidden",
    },
    ".cm-editing-image img": {
      display: "block",
      maxWidth: "100%",
      height: "auto",
    },
    ".cm-editing-image:focus-visible": { outline: "2px solid var(--primary)" },
  }),
];
