import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";

import { createWorkspaceService } from ".";

const envelope = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});

test("only a newly committed picker root returns a detached identity receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selected-root-"));
  const parent = join(directory, "parent"),
    child = join(parent, "child");
  await mkdir(child, { recursive: true });
  const file = join(child, "a.md");
  await writeFile(file, "# unchanged");
  let selected: string | null = child;
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
  });
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(selected),
  });
  try {
    const first = await workspace.request({ ...envelope(), op: "select" });
    if (!first.ok) throw Error(first.error);
    expect(first.selectedRoot).toEqual({
      handle: first.roots[0].handle,
      generation: first.roots[0].generation,
    });
    expect(Object.keys(first.selectedRoot!).sort()).toEqual([
      "generation",
      "handle",
    ]);
    for (const op of ["state", "select"]) {
      const result = await workspace.request({ ...envelope(), op });
      expect("selectedRoot" in result).toBe(false);
    }
    selected = null;
    expect(
      "selectedRoot" in
        (await workspace.request({ ...envelope(), op: "select" }))
    ).toBe(false);
    const next = await workspace.request({
      ...envelope(),
      op: "hidden",
      root: first.selectedRoot!.handle,
      showHidden: true,
    });
    if (!next.ok) throw Error(next.error);
    expect(next.roots[0].generation).toBeGreaterThan(
      first.selectedRoot!.generation
    );
    expect("selectedRoot" in next).toBe(false);
    expect(first.selectedRoot!.generation).toBe(1);
    selected = parent;
    const absorbed = await workspace.request({ ...envelope(), op: "select" });
    if (!absorbed.ok) throw Error(absorbed.error);
    expect(absorbed.roots.length).toBe(1);
    expect(absorbed.selectedRoot?.handle).toBe(absorbed.roots[0].handle);
    expect(absorbed.selectedRoot?.handle).not.toBe(first.selectedRoot!.handle);
    selected = child;
    expect(
      "selectedRoot" in
        (await workspace.request({ ...envelope(), op: "select" }))
    ).toBe(false);
    selected = join(directory, "missing");
    const failed = await workspace.request({ ...envelope(), op: "select" });
    expect(failed.ok).toBe(false);
    expect("selectedRoot" in failed).toBe(false);
    expect(await readFile(file, "utf8")).toBe("# unchanged");
    expect(documents.captureContentSearchBindings([])?.bindings).toEqual([]);
  } finally {
    await workspace.dispose();
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a picker invalidated by a completed lifecycle fence cannot issue a root receipt", async () => {
  const directory = await mkdtemp(join(tmpdir(), "selected-root-stale-"));
  let resolve!: (value: string | null) => void;
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
  });
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () =>
      new Promise<string | null>((done) => {
        resolve = done;
      }),
  });
  try {
    const pending = workspace.request({ ...envelope(), op: "select" });
    const resume = workspace.suspendRootMutations();
    resume();
    resolve(directory);
    const result = await pending;
    expect(result.ok).toBe(false);
    expect("selectedRoot" in result).toBe(false);
    const state = await workspace.request({ ...envelope(), op: "state" });
    if (!state.ok) throw Error(state.error);
    expect(state.roots).toEqual([]);
    expect("selectedRoot" in state).toBe(false);
  } finally {
    await workspace.dispose();
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
