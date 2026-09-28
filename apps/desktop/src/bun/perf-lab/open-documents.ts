import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { OPEN_PROBE_CASES, openProbeText } from "../../shared/open-probe";
import { perfRecord, perfUuid, type PerfResponse } from "../../shared/perf-lab";
import { createDocumentService } from "../documents";

/** Separate grant registry. No production document handles or supplied paths accepted. */
export function createOpenDocumentLab(enabled: boolean) {
  interface Session {
    id: string;
    directory: string;
    service: ReturnType<typeof createDocumentService>;
    selected: string | null;
    metrics: Record<string, number>;
    busy: boolean;
    timer: ReturnType<typeof setTimeout>;
  }
  let session: Session | undefined;
  let starting = false;
  const dispose = async () => {
    const old = session;
    session = undefined;
    if (old) {
      clearTimeout(old.timer);
      await old.service.dispose();
    }
  };
  const exact = (value: Record<string, unknown>, keys: string[]) =>
    Object.keys(value).length === keys.length &&
    keys.every((key) => key in value);
  async function run(value: unknown): Promise<PerfResponse> {
    if (!enabled) return { ok: false, error: "DISABLED" };
    if (!perfRecord(value)) return { ok: false, error: "INVALID" };
    if (value.op === "open-start") {
      if (!exact(value, ["op"])) return { ok: false, error: "INVALID" };
      if (session || starting) return { ok: false, error: "BUSY" };
      starting = true;
      try {
        const directory = await mkdtemp(join(tmpdir(), "agentic-open-probe-"));
        const current: Session = {
          id: crypto.randomUUID(),
          directory,
          selected: null,
          metrics: {},
          busy: false,
          service: createDocumentService({
            pickFile: () => Promise.resolve(current.selected),
            onTiming: (key, ms) => {
              current.metrics[key] = ms;
            },
          }),
          timer: setTimeout(() => {
            void dispose();
          }, 240_000),
        };
        session = current;
        return { ok: true, runId: current.id };
      } catch {
        return { ok: false, error: "FAILED" };
      } finally {
        starting = false;
      }
    }
    if (!perfUuid(value.runId) || value.runId !== session?.id)
      return { ok: false, error: "INVALID" };
    const current = session;
    if (value.op === "open-prepare") {
      if (
        !exact(value, ["op", "runId", "sample"]) ||
        !Number.isInteger(value.sample) ||
        Number(value.sample) < 0 ||
        Number(value.sample) >= OPEN_PROBE_CASES
      )
        return { ok: false, error: "INVALID" };
      if (current.busy) return { ok: false, error: "BUSY" };
      current.busy = true;
      try {
        await writeFile(
          join(current.directory, `sample-${String(value.sample)}.md`),
          openProbeText(Number(value.sample)),
          { mode: 0o600 }
        );
        return { ok: true };
      } catch {
        return { ok: false, error: "FAILED" };
      } finally {
        current.busy = false;
      }
    }
    if (value.op === "open-stop") {
      if (!exact(value, ["op", "runId"]))
        return { ok: false, error: "INVALID" };
      await dispose();
      return { ok: true };
    }
    if (
      value.op !== "open-call" ||
      !exact(value, ["op", "runId", "action", "sample", "request"]) ||
      ![
        "select",
        "read",
        "save",
        "release",
        "cancel",
        "checkWriteCapability",
        "waitForSaves",
      ].includes(String(value.action)) ||
      !Number.isInteger(value.sample) ||
      Number(value.sample) < 0 ||
      Number(value.sample) >= OPEN_PROBE_CASES
    )
      return { ok: false, error: "INVALID" };
    if (current.busy && value.action !== "cancel")
      return { ok: false, error: "BUSY" };
    const action = value.action as
      | "select"
      | "read"
      | "save"
      | "release"
      | "cancel"
      | "checkWriteCapability"
      | "waitForSaves";
    if (action === "cancel")
      return {
        ok: true,
        document: await current.service.cancel(value.request),
      };
    current.busy = true;
    current.metrics = {};
    try {
      if (action === "select") {
        current.selected = join(
          current.directory,
          `sample-${String(value.sample)}.md`
        );
      }
      const start = performance.now();
      const document = await current.service[action](value.request);
      return {
        ok: true,
        document,
        openMetrics: {
          ...current.metrics,
          backendDocumentMs: performance.now() - start,
          pickerNative: 0,
        },
      };
    } catch {
      return { ok: false, error: "FAILED" };
    } finally {
      current.busy = false;
    }
  }
  return { run, dispose };
}
