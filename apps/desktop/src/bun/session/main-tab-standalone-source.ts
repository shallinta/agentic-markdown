import { isAbsolute } from "node:path";

import { validRootRosterId } from "../../shared/root-roster";
import { hashPattern } from "../../shared/save-content";
import type { TrustedDocumentService } from "../documents";

export interface MainTabStandaloneIdentity {
  handle: string;
  documentId: string;
  revision: number;
  hash: string;
}
export interface MainTabStandaloneSource {
  readonly path: string;
  readonly fingerprint: string;
}
export type MainTabStandaloneProof =
  | { status: "ready"; source: MainTabStandaloneSource; current(): boolean }
  | { status: "invalid" | "unavailable" | "stale" };

function copyStandaloneSource(value: unknown): MainTabStandaloneSource | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join() !== "fingerprint,path" ||
      !("path" in value) || !("fingerprint" in value)) return;
  const { path, fingerprint } = value;
  if (typeof path !== "string" || path.length > 4096 || !isAbsolute(path) || path.includes("\0") ||
      !/\.(md|markdown)$/i.test(path) || typeof fingerprint !== "string" ||
      fingerprint.length > 200 || !/^\d+:\d+:-?\d+$/.test(fingerprint)) return;
  return Object.freeze({ path, fingerprint });
}

/** Internal only. Historical paths are comparison data, never authorization. */
export async function captureMainTabStandaloneSource(
  documents: Pick<TrustedDocumentService, "captureContentSearchBindings">,
  source: MainTabStandaloneIdentity,
  current: () => boolean,
  expected?: unknown
): Promise<MainTabStandaloneProof> {
  let valid = true;
  let captured: ReturnType<
    TrustedDocumentService["captureContentSearchBindings"]
  >;
  const admitted = () => {
    try {
      valid =
        valid &&
        current() === true &&
        (!captured || captured.current() === true);
    } catch {
      valid = false;
    }
    return valid;
  };
  try {
    if (
      !source ||
      typeof source !== "object" ||
      Array.isArray(source) ||
      Object.keys(source).sort().join() !== "documentId,handle,hash,revision" ||
      !validRootRosterId(source.handle) ||
      !validRootRosterId(source.documentId) ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 1 ||
      typeof source.hash !== "string" ||
      !hashPattern.test(source.hash)
    )
      return { status: "invalid" };
    const identity = { ...source };
    const history = expected === undefined ? undefined : copyStandaloneSource(expected);
    if (expected !== undefined && !history) return { status: "invalid" };
    if (!admitted()) return { status: "stale" };
    captured = documents.captureContentSearchBindings([identity.handle]);
    if (!admitted()) return { status: "stale" };
    const binding = captured?.bindings[0];
    if (
      captured?.bindings.length !== 1 ||
      !binding ||
      binding.scope ||
      !binding.verifyStandalone ||
      binding.handle !== identity.handle ||
      binding.documentId !== identity.documentId ||
      binding.revision !== identity.revision ||
      binding.hash !== identity.hash ||
      (history &&
        (history.path !== binding.path ||
          history.fingerprint !== binding.fingerprint))
    )
      return { status: "unavailable" };
    const metadata = copyStandaloneSource({ path: binding.path, fingerprint: binding.fingerprint });
    if (!metadata) return { status: "unavailable" };
    await binding.verifyStandalone(() => {
      if (!admitted()) throw Error("Stale standalone source");
    });
    if (!admitted()) return { status: "stale" };
    return { status: "ready", source: metadata, current: admitted };
  } catch {
    return { status: admitted() ? "unavailable" : "stale" };
  }
}
