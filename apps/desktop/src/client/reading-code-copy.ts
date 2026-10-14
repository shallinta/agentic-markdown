export type CodeCopyStatus = "idle" | "pending" | "success" | "failed";

/** A user gesture starts the write synchronously. Cancellation only hides stale
 * feedback; the platform clipboard write itself cannot be revoked. */
export function createReadingCodeCopy(
  current: () => boolean,
  write: (text: string) => Promise<void>,
  notify: (status: CodeCopyStatus) => void
) {
  let generation = 0;
  let pending = false;
  return {
    copy(text: string) {
      if (pending || !current()) return false;
      const token = ++generation;
      pending = true;
      let result: Promise<void>;
      try {
        result = write(text);
      } catch {
        pending = false;
        if (current()) notify("failed");
        return true;
      }
      notify("pending");
      void result.then(
        () => settle("success"),
        () => settle("failed")
      );
      function settle(status: CodeCopyStatus) {
        if (token !== generation) return;
        pending = false;
        // A temporary busy/frozen guard can end without unmounting. Clear this
        // request's pending UI, but never publish a stale success or failure.
        notify(current() ? status : "idle");
      }
      return true;
    },
    cancel() {
      generation++;
      pending = false;
    },
  };
}

export function writeCodeClipboard(text: string): Promise<void> {
  if (!globalThis.navigator?.clipboard?.writeText)
    throw new Error("Clipboard unavailable");
  return navigator.clipboard.writeText(text);
}
