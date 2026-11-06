import type { EditorState, Transaction } from "@codemirror/state";

import { RASTER_PASTE_MAX_BYTES, validRasterPastePath } from "../shared/raster-paste";

import { planRasterPaste, rasterPasteTransaction, type RasterPastePlan } from "./raster-paste-plan";

export interface RasterPasteSource {
  handle: string;
  documentId: string;
  expectedRevision: number;
  expectedHash: string;
}

export type RasterPasteTransport = (
  source: RasterPasteSource,
  bytes: Uint8Array,
  current: () => boolean
) => Promise<unknown>;

export interface RasterPasteAuthority {
  current(): boolean;
  subscribe(listener: () => void): () => void;
}

export type AuthorizeRasterPaste = (source: RasterPasteSource) => RasterPasteAuthority | undefined;

export interface RasterPasteContext {
  state: EditorState;
  source: RasterPasteSource;
  location: string;
  activation: number;
  bufferRevision: number;
}

type Report = "busy" | "size" | "save" | "unavailable" | "position" | "rejected" | "unknown" | "unlinked";

interface RasterPasteOptions {
  capture(): RasterPasteContext | undefined;
  transport(): RasterPasteTransport | undefined;
  authorize(): AuthorizeRasterPaste | undefined;
  dirty(): boolean;
  dispatch(transaction: Transaction): boolean;
  report(message: Report): void;
}

type PasteEvent = Pick<ClipboardEvent, "isTrusted" | "defaultPrevented" | "clipboardData" | "preventDefault" | "stopPropagation">;

const windowPending = new WeakSet<object>();

function rasterFile(event: PasteEvent): File | undefined {
  if (!event.isTrusted || event.defaultPrevented) return undefined;
  const data = event.clipboardData;
  if (data?.files.length !== 1 || data.items.length > 1 ||
      Array.from(data.types).some(type => !["Files", "image/png", "image/jpeg"].includes(type)) ||
      Array.from(data.items).some(item => item.kind !== "file"))
    return undefined;
  const file = data.files[0];
  return file && (file.type === "image/png" || file.type === "image/jpeg") ? file : undefined;
}

type Intent = Omit<RasterPasteContext, "state">;

function sameCapture(old: Intent, plan: RasterPastePlan, next: RasterPasteContext | undefined): boolean {
  return !!next && next.activation === old.activation && next.bufferRevision === old.bufferRevision &&
    next.location === old.location &&
    next.state.doc === plan.doc && next.state.selection.eq(plan.selection, true) &&
    next.source.handle === old.source.handle && next.source.documentId === old.source.documentId &&
    next.source.expectedRevision === old.source.expectedRevision && next.source.expectedHash === old.source.expectedHash;
}

export function createRasterPasteIntent(scope: object, options: RasterPasteOptions) {
  let validate: (() => void) | undefined;
  let invalidate: (() => void) | undefined;
  let disposed = false;

  async function receive(
    file: File, original: Intent, authority: RasterPasteAuthority,
    publish: RasterPasteTransport, plan: RasterPastePlan
  ) {
    let active = true;
    let sent = false;
    let confirmed = false;
    let unsubscribe: (() => void) | undefined;
    const retire = () => {
      active = false;
      unsubscribe?.();
      unsubscribe = undefined;
    };
    const current = () => {
      if (!active || disposed) return undefined;
      const latest = options.capture();
      if (!sameCapture(original, plan, latest) || !authority.current() ||
          !options.transport() || !options.authorize()) {
        retire();
        return undefined;
      }
      return latest;
    };
    invalidate = retire;
    validate = () => { current(); };
    windowPending.add(scope);
    try {
      unsubscribe = authority.subscribe(validate);
      if (!current()) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current()) return;
      if (bytes.length !== file.size || bytes.length > RASTER_PASTE_MAX_BYTES) {
        options.report("rejected");
        return;
      }
      sent = true;
      const receipt = await publish(original.source, bytes, () => !!current());
      if (!receipt || typeof receipt !== "object" || !("ok" in receipt)) {
        options.report("unknown");
        return;
      }
      if (receipt.ok === false && "error" in receipt &&
          ["INVALID", "STALE", "CONFLICT", "UNAVAILABLE", "BUSY", "ADMITTED_BUSY", "UNAUTHORIZED", "READ_ONLY", "CANCELLED"]
            .some(error => error === receipt.error)) {
        if (active) options.report("rejected");
        return;
      }
      if (receipt.ok !== true || !("relativePath" in receipt) || !validRasterPastePath(receipt.relativePath)) {
        options.report("unknown");
        return;
      }
      confirmed = true;
      const latest = current();
      const transaction = latest && rasterPasteTransaction(latest.state, plan, receipt.relativePath);
      if (!transaction || !options.dispatch(transaction)) options.report("unlinked");
    } catch {
      if (sent || active) options.report(confirmed ? "unlinked" : sent ? "unknown" : "rejected");
    } finally {
      invalidate = validate = undefined;
      windowPending.delete(scope);
      retire();
    }
  }

  return {
    paste(event: PasteEvent) {
      if (disposed) return;
      const publish = options.transport();
      const authorize = options.authorize();
      if (!publish || !authorize) return;
      const file = rasterFile(event);
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      if (windowPending.has(scope)) return options.report("busy");
      if (!file.size || file.size > RASTER_PASTE_MAX_BYTES) return options.report("size");
      const original = options.capture();
      if (!original) return options.report(options.dirty() ? "save" : "unavailable");
      const authority = authorize(original.source);
      if (!authority?.current()) return options.report("unavailable");
      const plan = planRasterPaste(original.state);
      if (!plan) return options.report("position");
      const { source, location, activation, bufferRevision } = original;
      void receive(file, { source, location, activation, bufferRevision }, authority, publish, plan);
    },
    check: () => { validate?.(); },
    invalidate: () => { invalidate?.(); },
    dispose: () => { disposed = true; invalidate?.(); },
  };
}
