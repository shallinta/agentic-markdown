import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { resolveSaveWorkerEntry } from "../documents/atomic-save";

import { keys, natural, record } from "./protocol";
import { INDEX_PURGE_ROSTER_NAME } from "./purge-roster";

type StageResult = "staged" | "BUSY" | "UNAVAILABLE" | "UNKNOWN";
interface ReclaimStage {
  openIndex: (profileFd: number) => number;
  stage: (profileFd: number, indexFd: number) => StageResult;
}

function loadSaveNative() {
  if (process.platform !== "darwin") return;
  const entry = resolveSaveWorkerEntry(join(import.meta.dir, "../documents"));
  if (!entry) return;
  try {
    const native: unknown = createRequire(import.meta.url)(join(dirname(entry), "save-primitives.node"));
    return record(native) ? native : undefined;
  } catch {
    return;
  }
}

/** The native export accepts only held descriptors and uses fixed names. */
export function loadReclaimStage(): ReclaimStage | undefined {
  const native = loadSaveNative();
  if (typeof native?.stageRetiredIndex !== "function" || typeof native.openDirectoryAt !== "function") return;
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
}

export function loadPurgePublisher() {
  const native = loadSaveNative();
  if (typeof native?.createTemp !== "function" || typeof native.removeTemp !== "function" ||
      typeof native.publishExclusive !== "function") return;
  const { createTemp, removeTemp, publishExclusive } = native;
  return {
    create(profileFd: number, name: string) {
      const fd: unknown = Reflect.apply(createTemp, native, [profileFd, name]);
      if (!natural(fd) || fd > 0x7fff_ffff) throw Error("Purge roster staging descriptor unavailable");
      return fd;
    },
    remove(profileFd: number, name: string) {
      if (Reflect.apply(removeTemp, native, [profileFd, name]) !== 0)
        throw Error("Purge roster staging cleanup unavailable");
    },
    publish(profileFd: number, name: string) {
      try {
        return Reflect.apply(publishExclusive, native, [profileFd, name, INDEX_PURGE_ROSTER_NAME]) === 0
          ? "published" as const : "UNKNOWN" as const;
      } catch (error) {
        if (record(error) && error.code === "PUBLISH_EXISTS") return "BUSY" as const;
        if (record(error) && error.code === "PUBLISH_UNSUPPORTED") return "UNAVAILABLE" as const;
        return "UNKNOWN" as const;
      }
    },
  };
}

export function loadPurgeMemberRemover() {
  const native = loadSaveNative();
  if (typeof native?.openFileAt !== "function" || typeof native.removeRetiredIndexMember !== "function") return;
  const { openFileAt, removeRetiredIndexMember } = native;
  return {
    open(pendingFd: number, name: string) {
      const fd: unknown = Reflect.apply(openFileAt, native, [pendingFd, name]);
      if (!natural(fd) || fd > 0x7fff_ffff) throw Error("Purge member descriptor unavailable");
      return fd;
    },
    remove(profileFd: number, pendingFd: number, fileFd: number, name: string) {
      try {
        const result: unknown = Reflect.apply(removeRetiredIndexMember, native, [profileFd, pendingFd, fileFd, name]);
        if (!record(result)) return "UNKNOWN" as const;
        if (result.ok === true && keys(result, "ok")) return "removed" as const;
        if (result.ok === false && keys(result, "error,ok") &&
            (result.error === "PRECONDITION" || result.error === "INPUT")) return "UNAVAILABLE" as const;
        return "UNKNOWN" as const;
      } catch {
        return "UNKNOWN" as const;
      }
    },
  };
}
