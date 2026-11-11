import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DocumentSnapshot } from "../../shared/documents";
import type { MainTabSourceInput } from "../../shared/main-tab-checkpoint";
import { createDocumentService } from "../documents";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createMainTabMixedMetadataBinder } from "./main-tab-mixed-binder";

export const text = "# 同名文档\r\n合成内容\n";
export const request = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});
export const inputTab = (
  { handle, documentId, revision, hash }: DocumentSnapshot,
  mode: MainTabSourceInput["mode"] = "editing",
  pinned = false
): MainTabSourceInput => ({ handle, documentId, revision, hash, mode, pinned });

export async function fixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "mixed-tab-binder-"))
  );
  const roots = [
    join(directory, "one/same"),
    join(directory, "two/same"),
  ] as const;
  const files = roots.map((root) => join(root, "a.md"));
  const explicitPath = join(roots[0], "nested/a.md");
  for (const path of [...files, explicitPath]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  const settingsDir = join(directory, "settings");
  let pickedFile = explicitPath;
  let pickedFolder: string = roots[0];
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(pickedFile),
  });
  const roster = createRootRosterService(
    settingsDir,
    () => false,
    () => undefined
  );
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(pickedFolder),
    onRootRosterCommitted: (event) => roster.committed(event),
  });
  const binder = createMainTabMixedMetadataBinder({
    documents,
    workspace,
    roster,
  });
  const call = async (op: string, more: object = {}) => {
    const result = await workspace.request({ ...request(), op, ...more });
    if (!result.ok) throw Error(`Workspace fixture failed: ${op}`);
    return result;
  };
  const openFolderTab = async (index: 0 | 1) => {
    pickedFolder = roots[index];
    await call("select");
    for (let attempt = 0; attempt < 1000; attempt++) {
      const root = (await call("state")).roots.find(
        (candidate) => candidate.displayPath === roots[index]
      );
      if (root?.status !== "complete") {
        await Bun.sleep(2);
        continue;
      }
      await roster.drain();
      const page = await call("page", {
        root: root.handle,
        generation: root.generation,
        cursor: 0,
      });
      const entry = page.nodes?.find(
        (node) => node.kind === "file" && node.displayPath === files[index]
      );
      if (!entry) throw Error("Missing directory fixture file");
      const opened = await workspace.open({
        ...request(),
        root: root.handle,
        entry: entry.handle,
      });
      if (!opened.ok || !opened.snapshot)
        throw Error("Could not open directory fixture file");
      return opened.snapshot;
    }
    throw Error("Directory fixture scan incomplete");
  };
  const openExplicit = async (path = explicitPath) => {
    pickedFile = path;
    const opened = await documents.select(request());
    if (!opened.ok || !opened.snapshot)
      throw Error("Could not open explicit fixture file");
    return opened.snapshot;
  };
  return {
    settingsDir,
    documents,
    workspace,
    roster,
    binder,
    roots,
    files,
    explicitPath,
    openFolderTab,
    openExplicit,
    async close() {
      await workspace.dispose();
      await documents.dispose();
      await roster.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
