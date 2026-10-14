import {
  findCodeCopyValue,
  rawCodeTarget,
  type CodeCopyTarget,
} from "./code-copy-target";
import type { createCurrentCanonical } from "./current-canonical";
import {
  createReadingCodeCopy,
  type CodeCopyStatus,
} from "./reading-code-copy";

export interface EditingCodeTicket {
  valid: () => boolean;
  target: CodeCopyTarget;
  raw: string;
}
export type CodeMenuStatus = "preparing" | "ready" | "failed";
export function createEditingCodeCopy(
  canonical: ReturnType<typeof createCurrentCanonical>,
  write: (text: string) => Promise<void>,
  notify: (status: CodeMenuStatus) => void,
  feedback: (status: CodeCopyStatus) => void
) {
  let ticket: EditingCodeTicket | null = null,
    value: string | undefined,
    generation = 0,
    disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const copy = createReadingCodeCopy(
    () => !disposed && !!ticket?.valid(),
    write,
    feedback
  );
  const cancelPreparation = () => {
    generation++;
    clearTimeout(timer);
    canonical.cancel();
  };
  const prepare = () => {
    cancelPreparation();
    value = undefined;
    const current = ticket,
      id = generation;
    if (disposed || !current?.valid()) return;
    notify("preparing");
    void canonical.request().then((result) => {
      const valid = () =>
        !disposed && id === generation && ticket === current && current.valid();
      if (!valid()) return;
      if (!result || !canonical.isCurrent(result)) {
        notify("failed");
        return;
      }
      function* queryValue() {
        const mapped = yield* rawCodeTarget(current!.raw, current!.target);
        return yield* findCodeCopyValue(result!.tree, current!.raw, mapped);
      }
      const query = queryValue();
      const step = () => {
        if (!valid() || !canonical.isCurrent(result)) return;
        const next = query.next();
        if (!next.done) {
          timer = setTimeout(step, 0);
          return;
        }
        if (next.value === null) notify("failed");
        else {
          value = next.value;
          notify("ready");
        }
      };
      step();
    });
  };
  return {
    open(next: EditingCodeTicket) {
      copy.cancel();
      ticket = next;
      prepare();
    },
    retry: prepare,
    valid: () => !disposed && !!ticket?.valid(),
    select: () => value !== undefined && copy.copy(value),
    close() {
      cancelPreparation();
      value = undefined;
    },
    invalidate() {
      ticket = null;
      value = undefined;
      cancelPreparation();
      copy.cancel();
    },
    dispose() {
      disposed = true;
      ticket = null;
      cancelPreparation();
      canonical.dispose();
      copy.cancel();
    },
  };
}
