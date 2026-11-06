import { closeSync, fstatSync, type BigIntStats } from "node:fs";

import { sameIndexInventoryMetadata } from "./cache-footprint";
import type { FinalizationRecord } from "./purge-roster";
import { loadFinalizationSidecarRemover, loadPurgeMemberRemover } from "./reclaim-stage";
import { IndexReuseCleanupError, type HeldCompletionPlacement, type HeldIndexPlacement } from "./reuse-catalog";

function closeMember(fd: number) {
  try {
    closeSync(fd);
  } catch {
    throw new IndexReuseCleanupError("Purge member descriptor close unconfirmed");
  }
}

export function unlinkPurgeMember(
  held: HeldIndexPlacement, name: string, pinned: BigIntStats, beforeUnlink: () => void
) {
  const native = loadPurgeMemberRemover();
  if (!native) return "UNAVAILABLE" as const;
  held.check("pending");
  const fd = native.open(held.indexFd, name);
  try {
    beforeUnlink();
    held.check("pending");
    if (!sameIndexInventoryMetadata(pinned, fstatSync(fd, { bigint: true })))
      return "UNAVAILABLE" as const;
    return native.remove(held.profileFd, held.indexFd, fd, name);
  } finally {
    closeMember(fd);
  }
}

export function unlinkFinalizationSidecar(
  held: HeldCompletionPlacement, selected: FinalizationRecord, pinned: BigIntStats, beforeUnlink: () => void
) {
  const native = loadFinalizationSidecarRemover();
  if (!native) return "UNAVAILABLE" as const;
  held.checkAbsent();
  const fd = native.open(held.profileFd, selected);
  try {
    beforeUnlink();
    held.checkAbsent();
    if (!sameIndexInventoryMetadata(pinned, fstatSync(fd, { bigint: true }))) return "UNAVAILABLE" as const;
    return native.remove(held.profileFd, fd, selected);
  } finally {
    closeMember(fd);
  }
}
