import type { WorkspaceRoot } from "../shared/workspace";

export function resolveContentSearchRoot(
  roots: readonly WorkspaceRoot[],
  alias: string | undefined,
  selectedHandle: string | null
):
  | { ok: true; root: WorkspaceRoot }
  | { ok: false; error: "ambiguous" | "unknown" | "selection" } {
  if (alias === undefined) {
    const root = roots.find((candidate) => candidate.handle === selectedHandle);
    return root ? { ok: true, root } : { ok: false, error: "selection" };
  }

  const key = alias.startsWith("/") ? "displayPath" : "name";
  let root: WorkspaceRoot | undefined;
  for (const candidate of roots) {
    if (candidate[key] !== alias) continue;
    if (root) return { ok: false, error: "ambiguous" };
    root = candidate;
  }
  return root ? { ok: true, root } : { ok: false, error: "unknown" };
}
