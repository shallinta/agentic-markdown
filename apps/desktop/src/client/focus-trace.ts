const documentEvents = [
  "pointerdown",
  "mousedown",
  "keydown",
  "keyup",
  "beforeinput",
  "input",
  "focusin",
  "focusout",
  "click",
] as const;
const keys = new Set([
  " ",
  "Enter",
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);
const inputTypes = new Set([
  "insertText",
  "insertLineBreak",
  "insertParagraph",
  "insertCompositionText",
  "deleteContentBackward",
  "deleteContentForward",
  "historyUndo",
  "historyRedo",
]);

export interface FocusTraceRow {
  sequence: number;
  milliseconds: number;
  type: string;
  target: string;
  targetId: number | null;
  active: string;
  activeId: number | null;
  hasFocus: boolean;
  trusted: boolean;
  key?: string;
  inputType?: string;
  alt?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  composing?: boolean;
  prevented: boolean;
  selectionRangeCount?: number;
  selectionAnchor?: "editor" | "other" | "none";
  selectionFocus?: "editor" | "other" | "none";
  selectionSameEditor?: boolean;
}

/** Observe document-local endpoints only; never read offsets or mutate Selection. */
function selectionSummary(doc: Document): Partial<FocusTraceRow> {
  try {
    if (doc.nodeType !== 9 || doc.activeElement?.shadowRoot) return {};
    const selection = doc.getSelection();
    const rangeCount = selection?.rangeCount ?? 0;
    if (!Number.isSafeInteger(rangeCount) || rangeCount < 0) return {};
    const endpoint = (node: Node | null) => {
      if (!node) return { category: "none" as const, editor: null };
      if (node.getRootNode() !== doc) throw Error("unsupported selection root");
      const element =
        node.nodeType === 1 ? (node as Element) : node.parentElement;
      const content = element?.closest(".cm-content");
      const editor =
        content?.closest(".cm-editor[data-document-editor]") ?? null;
      return {
        category: editor ? ("editor" as const) : ("other" as const),
        editor,
      };
    };
    const anchor = endpoint(selection?.anchorNode ?? null);
    const focus = endpoint(selection?.focusNode ?? null);
    return {
      selectionRangeCount: rangeCount,
      selectionAnchor: anchor.category,
      selectionFocus: focus.category,
      selectionSameEditor:
        anchor.editor !== null && anchor.editor === focus.editor,
    };
  } catch {
    // Unsupported/shadow selection is unknown, never a reason to affect input.
    return {};
  }
}

/** Local, opt-in metadata only. Never reads labels, text, paths or InputEvent.data. */
export function createFocusTrace(
  doc: Document,
  clock = () => performance.now()
) {
  let running = false;
  let rows: FocusTraceRow[] = [];
  let sequence = 0;
  let started = 0;
  let nextId = 0;
  let identities = new WeakMap<object, number>();
  const describe = (target: EventTarget | null): [string, number | null] => {
    if (!target) return ["none", null];
    if (target === doc) return ["document", null];
    if (target === doc.defaultView) return ["window", null];
    if ((target as Node).nodeType !== 1) return ["other", null];
    const element = target as Element;
    let id = identities.get(element);
    if (id === undefined) identities.set(element, (id = ++nextId));
    const category = element.closest("[data-focus-trace-lab]")
      ? "lab"
      : element.closest(".cm-content")
        ? "editor"
        : element.closest('[role="treeitem"]')
          ? element.closest('button[role="switch"]')
            ? "root-switch"
            : element.closest("button")
              ? "root-button"
              : "tree-item"
          : "other";
    return [category, id];
  };
  const record = (event: Event) => {
    if (!running) return;
    const [target, targetId] = describe(event.target);
    const [active, activeId] = describe(doc.activeElement);
    const row: FocusTraceRow = {
      sequence: ++sequence,
      milliseconds: Math.round(clock() - started),
      type: event.type,
      target,
      targetId,
      active,
      activeId,
      hasFocus: doc.hasFocus(),
      trusted: event.isTrusted,
      prevented: event.defaultPrevented,
    };
    if (event.type === "keydown" || event.type === "keyup") {
      const keyboard = event as KeyboardEvent;
      row.key = keys.has(keyboard.key)
        ? keyboard.key === " "
          ? "Space"
          : keyboard.key
        : "Other";
      row.alt = keyboard.altKey;
      row.ctrl = keyboard.ctrlKey;
      row.meta = keyboard.metaKey;
      row.shift = keyboard.shiftKey;
      row.composing = keyboard.isComposing;
    } else if (event.type === "beforeinput" || event.type === "input") {
      const input = event as InputEvent;
      row.inputType = inputTypes.has(input.inputType)
        ? input.inputType
        : "Other";
      row.composing = input.isComposing;
    }
    if (event.type === "focusin") Object.assign(row, selectionSummary(doc));
    if (rows.length === 128) rows.shift();
    rows.push(row);
  };
  const stop = () => {
    running = false;
    for (const type of documentEvents)
      doc.removeEventListener(type, record, true);
    doc.defaultView?.removeEventListener("focus", record);
    doc.defaultView?.removeEventListener("blur", record);
  };
  const clear = () => {
    rows = [];
    sequence = 0;
    identities = new WeakMap();
    nextId = 0;
    started = clock();
  };
  return {
    start() {
      if (running) return;
      clear();
      running = true;
      for (const type of documentEvents)
        doc.addEventListener(type, record, true);
      doc.defaultView?.addEventListener("focus", record);
      doc.defaultView?.addEventListener("blur", record);
    },
    stop() {
      stop();
      return rows.map((row) => ({ ...row }));
    },
    clear() {
      stop();
      clear();
    },
    dispose() {
      stop();
      clear();
    },
  };
}
