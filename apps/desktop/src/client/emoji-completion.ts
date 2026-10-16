import {
  autocompletion,
  acceptCompletion,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
  selectedCompletion,
  pickedCompletion,
  startCompletion,
  type CompletionContext,
  type Completion,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { Prec, Transaction } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

import { emojiPrefix, type EmojiPrefix } from "./emoji-completion-context";
import { EMOJI_MAPPING_VERSION, emojiNames } from "./emoji-map";

export interface EmojiIndex {
  version: string;
  names: readonly string[];
}
type Loader = () => Promise<EmojiIndex>;
let indexPromise: Promise<EmojiIndex> | undefined;
const loadIndex: Loader = () =>
  (indexPromise ??= import("./emoji-completion-index").catch((error) => {
    indexPromise = undefined;
    throw error;
  }));
const routes = new WeakMap<EditorView, () => boolean>();
const sessions = new WeakMap<EditorView, EmojiCompletionSession>();
export function registerEmojiCompletion(
  view: EditorView,
  ready: () => boolean
) {
  routes.set(view, ready);
  return () => {
    if (routes.get(view) === ready) {
      routes.delete(view);
      sessions.get(view)?.invalidate();
    }
  };
}
export function observeEmojiCompletion(view: EditorView) {
  if (!routes.get(view)?.()) sessions.get(view)?.invalidate();
}
/** Fixed sorted prefix index: no fuzzy search and no semantic result truncation. */
export function emojiMatches(names: readonly string[], prefix: string) {
  let lo = 0,
    hi = names.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (names[mid] < prefix) lo = mid + 1;
    else hi = mid;
  }
  const start = lo;
  hi = names.length;
  const limit = prefix + "\uffff";
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (names[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  return names.slice(start, lo);
}
export class EmojiCompletionSession {
  private epoch = 0;
  private alive = true;
  private composing = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(
    readonly view: EditorView,
    private loader: Loader = loadIndex
  ) {
    sessions.set(view, this);
  }
  ready() {
    return (
      this.alive &&
      !this.composing &&
      !this.view.compositionStarted &&
      !this.view.composing &&
      !!routes.get(this.view)?.()
    );
  }
  invalidate() {
    this.epoch++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.alive && this.epoch === epoch) closeCompletion(this.view);
    }, 0);
  }
  /** User cancellation also revokes returned apply callbacks and pending resume. */
  cancel() {
    this.epoch++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    return closeCompletion(this.view);
  }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || !this.ready()) this.epoch++;
    if (!this.ready() && completionStatus(update.state) !== null)
      this.invalidate();
  }
  compositionStart() {
    this.composing = true;
    this.invalidate();
  }
  compositionEnd() {
    this.composing = false;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.epoch++;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.alive && this.ready() && emojiPrefix(this.view.state))
        startCompletion(this.view);
    }, 20);
  }
  destroy() {
    this.alive = false;
    this.epoch++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (sessions.get(this.view) === this) sessions.delete(this.view);
  }
  async query(context: CompletionContext): Promise<CompletionResult | null> {
    if (!this.ready() || context.state !== this.view.state) return null;
    const prefix = emojiPrefix(context.state);
    if (!prefix) return null;
    const epoch = this.epoch,
      doc = context.state.doc,
      selection = context.state.selection;
    let aborted = false;
    context.addEventListener(
      "abort",
      () => {
        aborted = true;
      },
      { onDocChange: true }
    );
    const current = () => {
      const now = emojiPrefix(this.view.state);
      return (
        !aborted &&
        !context.aborted &&
        this.ready() &&
        epoch === this.epoch &&
        this.view.state.doc === doc &&
        this.view.state.selection.eq(selection) &&
        !!now &&
        samePrefix(prefix, now)
      );
    };
    let index: EmojiIndex;
    try {
      index = await this.loader();
    } catch {
      return null;
    }
    if (!current() || index.version !== EMOJI_MAPPING_VERSION) return null;
    const apply = (
      view: EditorView,
      completion: Completion,
      from: number,
      to: number
    ) => {
      if (view !== this.view || !current()) return;
      const next = emojiPrefix(view.state);
      if (
        !next ||
        !samePrefix(prefix, next) ||
        from !== prefix.from ||
        to !== prefix.to
      )
        return;
      const name = completion.label.slice(1, -1);
      if (
        !Object.prototype.hasOwnProperty.call(emojiNames, name) ||
        !name.startsWith(prefix.prefix) ||
        completion.label !== `:${name}:`
      )
        return;
      view.dispatch({
        changes: { from, to, insert: completion.label },
        selection: { anchor: from + completion.label.length },
        annotations: [
          pickedCompletion.of(completion),
          Transaction.userEvent.of("input.complete"),
          isolateHistory.of("full"),
        ],
      });
    };
    const options: Completion[] = emojiMatches(index.names, prefix.prefix)
      .filter((name) => Object.prototype.hasOwnProperty.call(emojiNames, name))
      .map((name) => ({ label: `:${name}:`, detail: emojiNames[name], apply }));
    return options.length
      ? { from: prefix.from, to: prefix.to, options, filter: false }
      : null;
  }
}
const samePrefix = (a: EmojiPrefix, b: EmojiPrefix) =>
  a.from === b.from &&
  a.to === b.to &&
  a.head === b.head &&
  a.prefix === b.prefix;
export const emojiCompletionSource = (context: CompletionContext) =>
  context.view ? (sessions.get(context.view)?.query(context) ?? null) : null;
export function emojiCompletionKey(event: KeyboardEvent, view: EditorView) {
  const session = sessions.get(view);
  if (
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    !session?.ready() ||
    completionStatus(view.state) !== "active"
  )
    return false;
  if (event.key === "Escape") return session.cancel();
  if (event.key === "ArrowDown") return moveCompletionSelection(true)(view);
  if (event.key === "ArrowUp") return moveCompletionSelection(false)(view);
  if (event.key === "Enter") {
    if (!selectedCompletion(view.state)) {
      session.cancel();
      return false;
    }
    const before = view.state.doc;
    acceptCompletion(view);
    // A library boolean only confirms a handler was called, not controller acceptance.
    if (view.state.doc !== before) return true;
    session.cancel();
    return false;
  }
  return false;
}
export const emojiCompletion = [
  autocompletion({
    override: [emojiCompletionSource],
    defaultKeymap: false,
    selectOnOpen: false,
    interactionDelay: 0,
    closeOnBlur: true,
    maxRenderedOptions: 20,
  }),
  ViewPlugin.define((view) => new EmojiCompletionSession(view), {
    eventHandlers: {
      compositionstart() {
        this.compositionStart();
      },
      compositionend() {
        this.compositionEnd();
      },
      blur() {
        this.invalidate();
      },
    },
  }),
  Prec.highest(EditorView.domEventHandlers({ keydown: emojiCompletionKey })),
  EditorView.theme({
    ".cm-tooltip-autocomplete": {
      backgroundColor: "var(--popover)",
      color: "var(--popover-foreground)",
      border: "1px solid var(--border)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
  }),
];
