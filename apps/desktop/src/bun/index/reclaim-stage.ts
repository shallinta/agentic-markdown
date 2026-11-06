import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { resolveSaveWorkerEntry } from "../documents/atomic-save";

import { keys, natural, record } from "./protocol";

type StageResult = "staged" | "BUSY" | "UNAVAILABLE" | "UNKNOWN";
interface ReclaimStage {
  openIndex: (profileFd: number) => number;
  stage: (profileFd: number, indexFd: number) => StageResult;
}

/** The native export accepts only held descriptors and uses fixed names. */
export function loadReclaimStage(): ReclaimStage | undefined {
  if (process.platform !== "darwin") return;
  const entry = resolveSaveWorkerEntry(join(import.meta.dir, "../documents"));
  if (!entry) return;
  try {
    const native: unknown = createRequire(import.meta.url)(join(dirname(entry), "save-primitives.node"));
    if (!record(native) || typeof native.stageRetiredIndex !== "function" ||
        typeof native.openDirectoryAt !== "function") return;
    const stage = native.stageRetiredIndex;
    const openDirectoryAt = native.openDirectoryAt;
    return {
      openIndex(profileFd) {
        const fd: unknown = Reflect.apply(openDirectoryAt, native, [profileFd, "index"]);
        if (!natural(fd) || fd > 0x7fff_ffff) throw Error("Index directory descriptor unavailable");
        return fd;
      },
      stage(profileFd, indexFd) {
        try {
          const result: unknown = Reflect.apply(stage, native, [profileFd, indexFd]);
          if (!record(result)) return "UNKNOWN";
          if (result.ok === true && keys(result, "ok")) return "staged";
          if (result.ok !== false || !keys(result, "error,ok")) return "UNKNOWN";
          if (result.error === "COLLISION") return "BUSY";
          if (result.error === "PRECONDITION" || result.error === "INPUT" || result.error === "UNSUPPORTED")
            return "UNAVAILABLE";
          return "UNKNOWN";
        } catch {
          return "UNKNOWN";
        }
      },
    };
  } catch {
    return;
  }
}
