import { PACKAGED_READER_SNAPSHOT_URL } from "../../security/reader-policy";
import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { Command } from "../../shared/commands";
import { perfRecord, perfUuid } from "../../shared/perf-lab";
import { readerSnapshotDeliveryScript } from "../../shared/reader-snapshot";
import type { OpenReadingSnapshotResponse, ReadingSnapshotSource } from "../../shared/rpc";
import { hashPattern } from "../../shared/save-content";

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
    on(name: "dom-ready", listener: (event: unknown) => void): void;
    executeJavascript(script: string): void;
  };
}

interface SnapshotDependencies {
  capture(
    source: ReadingSnapshotSource,
    current: () => boolean,
  ): Promise<
    | { ok: true; base64: string; current: () => boolean }
    | Extract<OpenReadingSnapshotResponse, { ok: false }>
  >;
  open(): SnapshotReaderWindow;
  timeoutMs?: number;
}

const SNAPSHOT_TIMEOUT_MS = 5_000;
interface SnapshotReceipt {
  script: string;
  current(): boolean;
}
interface PendingSnapshot {
  settle(response: OpenReadingSnapshotResponse): void;
  receipt?: SnapshotReceipt;
  child?: SnapshotReaderWindow;
}

function snapshotSource(input: unknown): ReadingSnapshotSource | undefined {
  if (!perfRecord(input)) return undefined;
  const keys = Object.keys(input);
  if (keys.length !== 4 || keys.sort().join(",") !== "documentId,expectedHash,expectedRevision,handle")
    return undefined;
  const { handle, documentId, expectedRevision, expectedHash } = input;
  if (
    !perfUuid(handle) || handle.length !== 36 ||
    !perfUuid(documentId) || documentId.length !== 36 ||
    typeof expectedRevision !== "number" || !Number.isSafeInteger(expectedRevision) ||
    expectedRevision < 1 || typeof expectedHash !== "string" ||
    expectedHash.length !== 64 || !hashPattern.test(expectedHash)
  ) return undefined;
  return { handle, documentId, expectedRevision, expectedHash };
}

function isReadyAt(event: unknown, url: string): boolean {
  return perfRecord(event) && perfRecord(event.data) && event.data.detail === url;
}

export function createReaderLab(
  open?: () => ReaderWindow,
  snapshot?: SnapshotDependencies,
  onReaderCloseAvailability?: (available: boolean) => void,
) {
  let reader: ReaderWindow | undefined;
  let pending: PendingSnapshot | undefined;
  let capturing: PendingSnapshot | undefined;
  let readyMain: MainWindow | undefined;
  let attempted = false;
  let disposed = false;
  let suspensions = 0;
  let owner: "main" | "opening" | "reader" | "unknown" = "main";
  let closeAvailable = false;
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
    },
    suspendSnapshots(): () => void {
      suspensions += 1;
      cancelPending();
      return () => { suspensions -= 1; };
    },
    async openReadingSnapshot(input: unknown, main: MainWindow): Promise<OpenReadingSnapshotResponse> {
      const ready = () => !disposed && suspensions === 0 &&
        readyMain === main && main.url === PACKAGED_VIEW_URL;
      if (!snapshot || !ready()) return { ok: false, error: "UNAVAILABLE" };
      const source = snapshotSource(input);
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
      void Promise.resolve().then(() =>
        current() ? snapshot.capture(source, current) : undefined
      ).then((capture) => {
        finishCapture();
        if (!current()) return;
        if (!capture) {
          token.settle({ ok: false, error: "CANCELLED" });
          return;
        }
        if (!capture.ok) {
          token.settle(capture);
          return;
        }
        const script = readerSnapshotDeliveryScript(capture.base64);
        if (!capture.current()) {
          token.settle({ ok: false, error: "CANCELLED" });
          return;
        }
        if (script === undefined) {
          token.settle({ ok: false, error: "UNAVAILABLE" });
          return;
        }
        token.receipt = { script, current: capture.current };
        setOwner("opening");
        const child = snapshot.open();
        token.child = child;
        attachReader(child, () => token.settle({ ok: false, error: "CANCELLED" }));
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
            if (child.url !== PACKAGED_READER_SNAPSHOT_URL ||
              child.webview.url !== PACKAGED_READER_SNAPSHOT_URL || child.webview.isRemoved) {
              token.settle({ ok: false, error: "UNAVAILABLE" });
              return;
            }
            child.webview.executeJavascript(receipt.script);
            child.show();
            token.settle({ ok: true, submitted: true });
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
      reader?.close();
    },
  };
}
