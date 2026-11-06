import { PACKAGED_READER_SNAPSHOT_URL } from "../../security/reader-policy";
import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { Command } from "../../shared/commands";
import { perfRecord, perfUuid } from "../../shared/perf-lab";
import { readerImageSnapshotDeliveryScript } from "../../shared/reader-image-snapshot";
import { readerBufferSnapshotDeliveryScript, readerSnapshotDeliveryScript, readerSnapshotOwnValue } from "../../shared/reader-snapshot";
import type { BufferReadingSnapshotSource, OpenReadingSnapshotResponse, ReadingSnapshotSource } from "../../shared/rpc";
import { hashPattern } from "../../shared/save-content";
import type { ReadingSnapshotImageRead, TrustedDocumentService } from "../documents";

interface ReaderWindow {
  on(name: "focus" | "blur" | "close", listener: () => void): void;
  show(): void;
  requestClose(): void;
  close(): void;
}

interface MainWindow {
  url: string | null;
  on(name: "focus" | "blur", listener: () => void): void;
  activate(): void;
}

interface SnapshotReaderWindow extends ReaderWindow {
  url: string | null;
  webview: {
    url: string | null;
    isRemoved: boolean;
    on(name: "dom-ready" | "did-commit-navigation", listener: (event: unknown) => void): void;
    executeJavascript(script: string): void;
  };
}

interface SnapshotDependencies {
  capture(source: ReadingSnapshotSource, current: () => boolean, options?: { includeImage: true }):
    ReturnType<TrustedDocumentService["captureReadingSnapshot"]>;
  candidate?(this: void, base64: string, signal: AbortSignal): Promise<string | undefined>;
  open(): SnapshotReaderWindow;
  timeoutMs?: number;
  imageTimeoutMs?: number;
}

const SNAPSHOT_TIMEOUT_MS = 5_000;
interface SnapshotReceipt {
  script: string;
  current(): boolean;
  image?: { deliveryId: string; base64: string; read: ReadingSnapshotImageRead };
}
interface PendingSnapshot {
  settle(response: OpenReadingSnapshotResponse): void;
  receipt?: SnapshotReceipt;
  child?: SnapshotReaderWindow;
}

type SnapshotPreparation = { ok: true; receipt: Omit<SnapshotReceipt, "script"> & { script: string | undefined } } |
  Extract<OpenReadingSnapshotResponse, { ok: false }>;

function snapshotSource(input: unknown): ReadingSnapshotSource | undefined {
  try {
    if (!perfRecord(input) || Reflect.ownKeys(input).length !== 4) return undefined;
    const handle = readerSnapshotOwnValue(input, "handle");
    const documentId = readerSnapshotOwnValue(input, "documentId");
    const expectedRevision = readerSnapshotOwnValue(input, "expectedRevision");
    const expectedHash = readerSnapshotOwnValue(input, "expectedHash");
    if (
      !perfUuid(handle) || handle.length !== 36 ||
      !perfUuid(documentId) || documentId.length !== 36 ||
      typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 || typeof expectedHash !== "string" ||
      expectedHash.length !== 64 || !hashPattern.test(expectedHash)
    ) return undefined;
    return { handle, documentId, expectedRevision, expectedHash };
  } catch {
    return undefined;
  }
}

function bufferSnapshotSource(input: unknown): BufferReadingSnapshotSource | undefined {
  try {
    if (!perfRecord(input) || Reflect.ownKeys(input).length !== 2 ||
        readerSnapshotOwnValue(input, "kind") !== "buffer") return undefined;
    const data = readerSnapshotOwnValue(input, "data");
    return typeof data === "string" ? { kind: "buffer", data } : undefined;
  } catch {
    return undefined;
  }
}

function isReadyAt(event: unknown, url: string): boolean {
  return perfRecord(event) && perfRecord(event.data) && event.data.detail === url;
}

function isSnapshotWindow(child: SnapshotReaderWindow): boolean {
  return child.url === PACKAGED_READER_SNAPSHOT_URL &&
    child.webview.url === PACKAGED_READER_SNAPSHOT_URL && !child.webview.isRemoved;
}

export function createReaderLab(
  open?: () => ReaderWindow,
  snapshot?: SnapshotDependencies,
  onReaderCloseAvailability?: (available: boolean) => void,
) {
  let reader: ReaderWindow | undefined;
  let pending: PendingSnapshot | undefined;
  let capturing: PendingSnapshot | undefined;
  let deliveringImage: { child: SnapshotReaderWindow; retire(): void } | undefined;
  let readyMain: MainWindow | undefined;
  let attempted = false;
  let disposed = false;
  let suspensions = 0;
  let owner: "main" | "opening" | "reader" | "unknown" = "main";
  let closeAvailable = false;
  const retireImage = (child?: ReaderWindow) => {
    if (deliveringImage && (!child || deliveringImage.child === child)) deliveringImage.retire();
  };
  const deliverImage = (child: SnapshotReaderWindow, { deliveryId, base64, read }: NonNullable<SnapshotReceipt["image"]>, ready: () => boolean) => {
    const candidate = snapshot?.candidate;
    if (!candidate || !ready() || reader !== child || !isSnapshotWindow(child)) return;
    const abort = new AbortController();
    const ticket = {
      child,
      retire(this: void) {
        if (deliveringImage !== ticket) return;
        deliveringImage = undefined;
        clearTimeout(timer);
        abort.abort();
      },
    };
    const timer = setTimeout(ticket.retire, snapshot?.imageTimeoutMs ?? SNAPSHOT_TIMEOUT_MS);
    deliveringImage = ticket;
    const current = () => deliveringImage === ticket && ready() && reader === child && isSnapshotWindow(child);
    void Promise.resolve().then(() => current() ? candidate(base64, abort.signal) : undefined).then(async (reference) => {
      if (!reference || !current()) return;
      const result = await read(reference, current);
      if (!current()) return;
      const envelope = { protocolVersion: 1, deliveryId, slot: 0 } as const;
      const script = readerImageSnapshotDeliveryScript(result.ok
        ? { ...envelope, status: "image", mime: result.mime, width: result.width, height: result.height, data: result.data }
        : { ...envelope, status: "unavailable" }, deliveryId);
      if (!script || (result.ok && !result.current()) || !current()) return;
      child.webview.executeJavascript(script);
    }).catch(() => { /* A failed image never changes the submitted body. */ }).finally(ticket.retire);
  };
  const syncCloseAvailability = () => {
    const available = !disposed && owner === "reader" && reader !== undefined;
    if (available === closeAvailable) return;
    closeAvailable = available;
    onReaderCloseAvailability?.(available);
  };
  const setOwner = (next: typeof owner) => {
    owner = next;
    syncCloseAvailability();
  };
  const requestReaderClose = () => {
    retireImage(reader);
    try {
      reader?.requestClose();
    } catch {
      console.warn("Reader lab window could not close");
    }
  };
  const attachReader = (child: ReaderWindow, onClose?: () => void): void => {
    reader = child;
    child.on("close", () => {
      if (reader !== child) return;
      retireImage(child);
      reader = undefined;
      setOwner("main");
      onClose?.();
    });
    child.on("focus", () => {
      if (reader === child) setOwner("reader");
    });
    child.on("blur", () => {
      if (reader === child && owner === "reader") setOwner("unknown");
    });
  };
  const cancelPending = (): void =>
    pending?.settle({ ok: false, error: "CANCELLED" });

  return {
    bindMain(main: MainWindow): void {
      main.on("focus", () => {
        if (owner !== "opening") setOwner("main");
      });
      main.on("blur", () => {
        if (reader && owner === "main") setOwner("unknown");
      });
    },
    openAfterMainReady(main: MainWindow, event?: unknown): void {
      if (disposed || main.url !== PACKAGED_VIEW_URL) return;
      if (snapshot && isReadyAt(event, PACKAGED_VIEW_URL)) readyMain = main;
      if (!open || attempted) return;
      attempted = true;
      setOwner("opening");
      try {
        const child = open();
        attachReader(child);
        child.show();
      } catch {
        console.warn("Reader lab window could not open");
        if (reader) requestReaderClose();
        else setOwner("main");
      }
    },
    retireMainReady(main: MainWindow): void {
      if (readyMain !== main) return;
      readyMain = undefined;
      cancelPending();
      retireImage();
    },
    suspendSnapshots(): () => void {
      suspensions += 1;
      cancelPending();
      retireImage();
      return () => { suspensions -= 1; };
    },
    async openReadingSnapshot(input: unknown, main: MainWindow): Promise<OpenReadingSnapshotResponse> {
      const ready = () => !disposed && suspensions === 0 &&
        readyMain === main && main.url === PACKAGED_VIEW_URL;
      if (!snapshot || !ready()) return { ok: false, error: "UNAVAILABLE" };
      const source = bufferSnapshotSource(input) ?? snapshotSource(input);
      if (!source) return { ok: false, error: "INVALID_REQUEST" };
      if (pending || capturing || reader) return { ok: false, error: "BUSY" };

      const completion = Promise.withResolvers<OpenReadingSnapshotResponse>();
      const token: PendingSnapshot = {
        settle(response) {
          if (pending !== token) return;
          pending = undefined;
          token.receipt = undefined;
          clearTimeout(timer);
          if (!response.ok && token.child && reader === token.child) requestReaderClose();
          token.child = undefined;
          completion.resolve(response);
        },
      };
      const current = () => pending === token && ready();
      const timer = setTimeout(() => token.settle({ ok: false, error: "UNAVAILABLE" }),
        snapshot.timeoutMs ?? SNAPSHOT_TIMEOUT_MS);
      pending = token;
      // A timeout retires the ticket, but cannot preempt a descriptor read.
      // Keep the capture seat until that work has settled.
      capturing = token;
      const finishCapture = () => { if (capturing === token) capturing = undefined; };
      void Promise.resolve().then(async (): Promise<SnapshotPreparation | undefined> => {
        if (!current()) return;
        if ("kind" in source) {
          const script = readerBufferSnapshotDeliveryScript(source.data);
          return script === undefined
            ? { ok: false, error: "INVALID_REQUEST" }
            : { ok: true, receipt: { script, current } };
        }
        const capture = await snapshot.capture(source, current, snapshot.candidate ? { includeImage: true } : undefined);
        if (!current()) return;
        if (!capture.ok) return capture;
        const image = snapshot.candidate && capture.readImage
          ? { deliveryId: crypto.randomUUID(), base64: capture.base64, read: capture.readImage }
          : undefined;
        const script = readerSnapshotDeliveryScript(capture.base64, image?.deliveryId);
        return { ok: true, receipt: { script, current: capture.current, image } };
      }).then((prepared) => {
        finishCapture();
        if (!current()) return;
        if (!prepared?.ok) {
          token.settle(prepared ?? { ok: false, error: "CANCELLED" });
          return;
        }
        const receipt = prepared.receipt;
        if (!receipt.current()) {
          token.settle({ ok: false, error: "CANCELLED" });
          return;
        }
        if (receipt.script === undefined) {
          token.settle({ ok: false, error: "UNAVAILABLE" });
          return;
        }
        token.receipt = { ...receipt, script: receipt.script };
        setOwner("opening");
        const child = snapshot.open();
        token.child = child;
        attachReader(child, () => token.settle({ ok: false, error: "CANCELLED" }));
        let bodySubmitted = false;
        let childNavigated = false;
        child.webview.on("did-commit-navigation", () => {
          if (bodySubmitted) childNavigated = true;
          retireImage(child);
        });
        child.webview.on("dom-ready", (event) => {
          if (!current() || reader !== child || !isReadyAt(event, PACKAGED_READER_SNAPSHOT_URL)) return;
          const receipt = token.receipt;
          if (!receipt) return;
          token.receipt = undefined;
          try {
            if (!receipt.current()) {
              token.settle({ ok: false, error: "CANCELLED" });
              return;
            }
            if (!isSnapshotWindow(child)) {
              token.settle({ ok: false, error: "UNAVAILABLE" });
              return;
            }
            bodySubmitted = true;
            child.webview.executeJavascript(receipt.script);
            child.show();
            token.settle({ ok: true, submitted: true });
            if (receipt.image) deliverImage(child, receipt.image, () => ready() && !childNavigated);
          } catch {
            token.settle({ ok: false, error: "UNAVAILABLE" });
          }
        });
      }).catch(() => {
        finishCapture();
        if (!reader) setOwner("main");
        token.settle({ ok: false, error: "UNAVAILABLE" });
      });
      return completion.promise;
    },
    interceptMenu(command: Command): boolean {
      if (owner === "main") return false;
      if (closeAvailable && command.type === "closeDocument")
        requestReaderClose();
      return true;
    },
    activateMainForDiscard(main: MainWindow): void {
      if (reader && owner !== "main") {
        try {
          main.activate();
        } catch {
          // Activation is best effort; still ask the main renderer to guard quit.
          console.warn("Reader lab could not activate main window");
        }
      }
    },
    dispose(): void {
      disposed = true;
      syncCloseAvailability();
      attempted = true;
      readyMain = undefined;
      cancelPending();
      retireImage();
      reader?.close();
    },
  };
}
