import {
  CANONICAL_CONFIG,
  canonicalCorpus,
  type CanonicalRow,
} from "../shared/canonical-corpus";

export interface CanonicalWorker {
  onmessage:
    ((event: MessageEvent<{ ok: boolean; row?: CanonicalRow }>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: { id: string; config: string }): void;
  terminate(): void;
}
export function createCanonicalRunner(factory: () => CanonicalWorker) {
  let active:
    { worker: CanonicalWorker; finish: (value: null) => void } | undefined;
  return {
    cancel() {
      active?.finish(null);
    },
    run(onRow: (row: CanonicalRow) => void): Promise<boolean | null> {
      if (active) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        const worker = factory();
        let index = 0;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (value: boolean | null) => {
          if (active?.worker !== worker) return;
          clearTimeout(timer);
          active = undefined;
          worker.terminate();
          resolve(value);
        };
        active = { worker, finish };
        const fail = () => {
          if (active?.worker !== worker) return;
          clearTimeout(timer);
          active = undefined;
          worker.terminate();
          reject(new Error("Canonical experiment failed"));
        };
        worker.onerror = worker.onmessageerror = fail;
        let allPassed = true;
        const send = () => {
          timer = setTimeout(fail, 15000);
          worker.postMessage({
            id: canonicalCorpus[index].id,
            config: CANONICAL_CONFIG,
          });
        };
        worker.onmessage = (event) => {
          if (active?.worker !== worker) return;
          clearTimeout(timer);
          try {
            const row = event.data?.row;
            if (
              !event.data?.ok ||
              row?.id !== canonicalCorpus[index].id ||
              typeof row.passed !== "boolean" ||
              typeof row.rangesValid !== "boolean" ||
              typeof row.decodedMatches !== "boolean" ||
              typeof row.semanticMatches !== "boolean" ||
              !Number.isFinite(row.milliseconds) ||
              !row.canonical ||
              !row.editor ||
              !Array.isArray(row.headings) ||
              !row.headings.every(
                (value) => Number.isInteger(value) && value >= 1 && value <= 6
              ) ||
              !Array.isArray(row.targets) ||
              !row.targets.every(
                (value) => typeof value === "string" && value.length <= 1000
              )
            ) {
              fail();
              return;
            }
            allPassed &&= row.passed;
            onRow(row);
            if (active?.worker !== worker) return;
            if (++index === canonicalCorpus.length) finish(allPassed);
            else send();
          } catch {
            fail();
          }
        };
        try {
          send();
        } catch {
          fail();
        }
      });
    },
  };
}
