import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspaceResponse } from "../../shared/workspace";
import { createDocumentService } from "../documents";

import { createRootRosterService } from "./root-roster-service";

import { createWorkspaceService } from ".";

const request = (op: string, details: object = {}) => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
  op,
  ...details,
});
const good = (result: WorkspaceResponse) => {
  if (!result.ok) throw Error(JSON.stringify(result));
  return result;
};

test("expansion capture is limited to scanned visible directory handles and live generations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "expansion-workspace-"));
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
  });
  const workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents,
  });
  const call = async (op: string, details?: object) =>
    good(await workspace.request(request(op, details)));
  async function settle() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const root = (await call("state")).roots[0];
      if (root?.status === "complete") return root;
      await Bun.sleep(2);
    }
    throw Error("Scan incomplete");
  }
  try {
    for (const path of ["a/nested", ".secret"]) {
      await mkdir(join(directory, path), { recursive: true });
      await writeFile(join(directory, path, "sample.md"), "sample");
    }
    await call("select");
    const root = await settle();
    const target = { root: root.handle, generation: root.generation };
    const nodes = (await call("page", { ...target, cursor: 0 })).nodes!;
    const entry = (name: string) => {
      const node = nodes.find((item) => item.name === name);
      if (!node) throw Error("Missing test node");
      return node.handle;
    };
    const capture = workspace.captureExpansion(root.handle, root.generation);
    expect(capture?.path).toBe(await realpath(directory));
    expect(
      capture?.project([
        "a/nested",
        "a/nested/sample.md",
        ".secret",
        "unknown",
        "../a",
        "/a",
      ])
    ).toEqual([entry("nested")]);
    expect(
      workspace.captureExpansion(root.handle, root.generation, entry("nested"))
        ?.relativePath
    ).toBe("a/nested");
    expect(
      workspace.captureExpansion(
        root.handle,
        root.generation,
        entry("sample.md")
      )
    ).toBeUndefined();
    expect(
      workspace.captureExpansion(
        root.handle,
        root.generation,
        crypto.randomUUID()
      )
    ).toBeUndefined();
    const resume = workspace.suspendRootMutations();
    expect(capture?.current()).toBe(false);
    expect(
      workspace.captureExpansion(root.handle, root.generation)
    ).toBeUndefined();
    resume();
    expect(capture?.project(["a"])).toBeUndefined();

    const beforeHidden = workspace.captureExpansion(
      root.handle,
      root.generation
    );
    await call("hidden", { root: root.handle, showHidden: true });
    expect(beforeHidden?.current()).toBe(false);
    expect(
      workspace.captureExpansion(root.handle, root.generation)
    ).toBeUndefined();
    const refreshed = await settle();
    const current = workspace.captureExpansion(
      refreshed.handle,
      refreshed.generation
    );
    expect(current?.project([".secret"])).toHaveLength(1);
    await call("clear");
    expect(current?.current()).toBe(false);
  } finally {
    await workspace.dispose();
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("serialized roster confirmation needs a live identity, exact durable match and current lifecycle", async () => {
  const directory = await mkdtemp(join(tmpdir(), "expansion-roster-"));
  const file = join(directory, "workspace-roots.json");
  const live = "/authorized";
  const pending = "/historical";
  const quiet = () => undefined;
  const seed = createRootRosterService(directory, () => false, quiet);
  let suspended = false;
  let generation = 0;
  let durableChanges = 0;
  const roster = createRootRosterService(
    directory,
    () => suspended,
    quiet,
    () => generation,
    () => {
      durableChanges++;
    }
  );
  try {
    expect(await seed.confirmExpansionRoster()).toBeUndefined();
    seed.committed({ paths: [live, pending] });
    const original = await seed.confirmExpansionIdentity(live);
    if (!original) throw Error("Missing initial durable root identity");
    expect(original.current()).toBe(true);
    await seed.close();

    expect(await roster.confirmExpansionIdentity(live)).toBeUndefined();
    expect(await roster.confirmExpansionIdentity(pending)).toBeUndefined();
    expect((await roster.confirmExpansionRoster())?.ids).toHaveLength(2);
    roster.committed({ paths: [live], selectedPath: live });
    const reselected = await roster.confirmExpansionIdentity(live);
    if (!reselected) throw Error("Missing reselected durable root identity");
    expect(reselected.id).toBe(original.id);
    expect(reselected.current()).toBe(true);
    expect(await roster.confirmExpansionIdentity(pending)).toBeUndefined();
    expect(durableChanges).toBe(1);
    const list = { protocolVersion: 1, op: "list" };
    const pendingId = (await roster.request(list)).pending[0].id;
    const beforeRemove = await roster.confirmExpansionRoster();
    expect(beforeRemove?.ids).toContain(pendingId);
    const removal = roster.request({
      protocolVersion: 1,
      op: "remove",
      id: pendingId,
    });
    expect(beforeRemove?.current()).toBe(false);
    expect((await removal).pending).toEqual([]);
    expect(durableChanges).toBe(2);
    expect((await roster.confirmExpansionRoster())?.ids).toEqual([
      reselected.id,
    ]);

    const active = await roster.confirmExpansionIdentity(live);
    const queued = roster.confirmExpansionIdentity(live);
    suspended = true;
    generation++;
    expect(active?.current()).toBe(false);
    expect(await queued).toBeUndefined();
    suspended = false;
    const prior = await roster.confirmExpansionRoster();
    expect(prior?.current()).toBe(true);

    const mismatched = {
      id: crypto.randomUUID(),
      path: live,
      name: "authorized",
    };
    await writeFile(
      file,
      JSON.stringify({ version: 1, data: { entries: [mismatched] } })
    );
    expect(await roster.confirmExpansionIdentity(live)).toBeUndefined();
    expect(await roster.confirmExpansionRoster()).toBeUndefined();
    await writeFile(file, '{"version":9,"data":{"entries":[]}}');
    roster.committed({ paths: [], explicitClear: true });
    expect(prior?.current()).toBe(false);
    expect(await roster.confirmExpansionRoster()).toBeUndefined();
    expect(durableChanges).toBe(2);
  } finally {
    await seed.close();
    await roster.close();
    await rm(directory, { recursive: true, force: true });
  }
});
