import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname } from "node:path";

import type { ObservationStatus } from "../../shared/document-observation";
import { MAX_DOCUMENT_BYTES } from "../../shared/documents";

import { canonicalizeSelectedPath, fileFingerprint, verifySingleFileAuthorization, type SingleFileAuthorization } from "./path-authorization";

type Authorization = Omit<SingleFileAuthorization, "file"> & { scope?: { verify(): Promise<void> } };
interface ProbeResult { status: ObservationStatus; hash?: string; fingerprint?: string }
/** No enumeration, no replacement-file content and no baseline mutation. */
export async function observeFile(grant: Authorization, expectedHash: string, alive: () => boolean): Promise<ProbeResult> {
  const parents = async () => {
    if (!alive()) throw Error("cancelled");
    await grant.scope?.verify();
    if (await canonicalizeSelectedPath(dirname(grant.selectedPath)) !== grant.selectedParent) throw Error("parent changed");
    for (const directory of grant.directories) {
      const current = await lstat(directory.path, { bigint: true });
      if (!current.isDirectory() || current.isSymbolicLink() || fileFingerprint(current) !== directory.fingerprint) throw Error("parent changed");
    }
    if (!alive()) throw Error("cancelled");
  };
  const leaf = async (): Promise<BigIntStats | null> => {
    try { return await lstat(grant.path, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  };
  try {
    await parents();
    const before = await leaf();
    if (!before) {
      await parents();
      return { status: await leaf() ? "unavailable" : "missing" };
    }
    if (!before.isFile() || before.isSymbolicLink() || fileFingerprint(before) !== grant.fingerprint) {
      await parents();
      const after = await leaf();
      return { status: after && fileFingerprint(after) === fileFingerprint(before) ? "replaced" : "unavailable" };
    }
    if (before.size > BigInt(MAX_DOCUMENT_BYTES)) return { status: "unavailable" };
    const file = await open(grant.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const initial = await verifySingleFileAuthorization({ ...grant, file });
      await parents();
      if (initial.size > BigInt(MAX_DOCUMENT_BYTES)) return { status: "unavailable" };
      const bytes = Buffer.alloc(Number(initial.size) + 1);
      let count = 0;
      while (count < bytes.length) {
        if (!alive()) return { status: "unavailable" };
        const part = await file.read(bytes, count, Math.min(65536, bytes.length - count), count);
        if (!part.bytesRead) break;
        count += part.bytesRead;
      }
      const after = await verifySingleFileAuthorization({ ...grant, file });
      await parents();
      if (initial.size !== after.size || BigInt(count) !== initial.size || initial.mtimeNs !== after.mtimeNs || initial.ctimeNs !== after.ctimeNs) return { status: "unavailable" };
      const hash = createHash("sha256").update(bytes.subarray(0, count)).digest("hex");
      return { status: hash === expectedHash ? "unchanged" : "content-changed", hash, fingerprint: fileFingerprint(after) };
    } finally { await file.close(); }
  } catch { return { status: "unavailable" }; }
}
