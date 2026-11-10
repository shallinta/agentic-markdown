import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validRootRosterResponse } from "../../shared/root-roster";
import { createDocumentService } from "../documents";

import { createRootRosterService } from "./root-roster-service";

import { createWorkspaceService } from ".";

const env = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});
const list = { protocolVersion: 1 as const, op: "list" as const };
test("real root commits retain exact pending rows, notify, and dispose does not clear", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roster-integration-")),
    parent = join(dir, "roots"),
    child = join(parent, "child"),
    data = join(dir, "data");
  await mkdir(child, { recursive: true });
  await writeFile(join(child, "a.md"), "# A");
  let pick: string | null = child,
    notifications = 0;
  const docs = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const workspace = createWorkspaceService({
    documents: docs,
    pickDirectory: () => Promise.resolve(pick),
    onRootRosterCommitted: (event) => roster.committed(event),
  });
  const roster = createRootRosterService(
    data,
    () => workspace.rootMutationsSuspended(),
    () => {
      notifications++;
    }
  );
  try {
    expect((await workspace.request({ ...env(), op: "select" })).ok).toBe(true);
    await roster.drain();
    const restored = createRootRosterService(
      data,
      () => false,
      () => undefined
    );
    expect((await restored.request(list)).pending.map((e) => e.path)).toEqual([
      await realpath(child),
    ]);
    await restored.close();
    pick = parent;
    expect((await workspace.request({ ...env(), op: "select" })).ok).toBe(true);
    pick = child;
    expect((await workspace.request({ ...env(), op: "select" })).ok).toBe(true);
    pick = null;
    expect((await workspace.request({ ...env(), op: "select" })).ok).toBe(true);
    await roster.drain();
    expect(notifications).toBe(3);
    const before = await readFile(join(data, "workspace-roots.json"));
    await workspace.dispose();
    await roster.close();
    expect(await readFile(join(data, "workspace-roots.json"))).toEqual(before);
  } finally {
    await workspace.dispose();
    await roster.close();
    await docs.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("lifecycle fences late picker, pending mutation and resumes without closing metadata", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roster-fence-")),
    root = join(dir, "root"),
    data = join(dir, "data");
  await mkdir(root);
  let resolve!: (value: string | null) => void;
  const docs = createDocumentService({ pickFile: () => Promise.resolve(null) });
  const workspace = createWorkspaceService({
    documents: docs,
    pickDirectory: () =>
      new Promise((done) => {
        resolve = done;
      }),
    onRootRosterCommitted: (event) => roster.committed(event),
  });
  const seed = createRootRosterService(
    data,
    () => false,
    () => undefined
  );
  seed.committed({ paths: ["/historical"] });
  await seed.close();
  const roster = createRootRosterService(
    data,
    () => workspace.rootMutationsSuspended(),
    () => undefined,
    () => workspace.rootMutationGeneration()
  );
  try {
    const pending = (await roster.request(list)).pending[0];
    const selecting = workspace.request({ ...env(), op: "select" });
    const resume = workspace.suspendRootMutations();
    resume();
    resolve(root);
    expect((await selecting).ok).toBe(false);
    const stopAgain = workspace.suspendRootMutations();
    const denied = await roster.request({
      protocolVersion: 1,
      op: "remove",
      id: pending.id,
    });
    expect(denied.failure).toBe("busy");
    expect(denied.readOnly).toBe(false);
    expect(denied.pending).toEqual([pending]);
    expect(validRootRosterResponse(denied)).toBe(true);
    expect((await workspace.request({ ...env(), op: "clear" })).ok).toBe(false);
    await roster.drain();
    stopAgain();
    expect((await roster.request(list)).pending).toEqual([pending]);
    const queuedRemoval = roster.request({
      protocolVersion: 1,
      op: "remove",
      id: pending.id,
    });
    const release = workspace.suspendRootMutations();
    release();
    expect((await queuedRemoval).failure).toBe("busy");
    expect((await roster.request(list)).pending).toEqual([pending]);
    expect((await workspace.request({ ...env(), op: "clear" })).ok).toBe(true);
    await roster.drain();
    expect((await roster.request(list)).pending).toEqual([]);
  } finally {
    await workspace.dispose();
    await roster.close();
    await docs.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});

test("wire rejects arbitrary paths and protected startup does not masquerade as retryable write failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "roster-wire-"));
  try {
    await writeFile(
      join(dir, "workspace-roots.json"),
      '{"version":7,"data":{"entries":[]}}'
    );
    const roster = createRootRosterService(
      dir,
      () => false,
      () => undefined
    );
    expect((await roster.request(list)).readOnly).toBe(true);
    expect(
      (await roster.request({ ...list, path: "/arbitrary" })).failure
    ).toBe("invalid");
    roster.committed({ paths: ["/real-authorized"] });
    await roster.drain();
    const result = await roster.request(list);
    expect(result.failure).toBe("future");
    expect(validRootRosterResponse(result)).toBe(true);
    expect("live" in result).toBe(false);
    await roster.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("committed directory removal and controlled Trash publish roster once after commit", async () => {
  for (const action of ["remove", "trash"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "roster-removal-")),
      root = join(dir, "root"),
      data = join(dir, "data");
    await mkdir(root);
    await writeFile(join(root, "a.md"), "A");
    let notifications = 0;
    const docs = createDocumentService({
      pickFile: () => Promise.resolve(null),
    });
    const workspace = createWorkspaceService({
      documents: docs,
      pickDirectory: () => Promise.resolve(root),
      onRootRosterCommitted: (event) => roster.committed(event),
      trashRun: async (input) => {
        const resultPath = join(dir, "controlled-trash");
        await rename(input.path, resultPath);
        return { status: "trashed", resultPath };
      },
    });
    const roster = createRootRosterService(
      data,
      () => workspace.rootMutationsSuspended(),
      () => {
        notifications++;
      }
    );
    try {
      await workspace.request({ ...env(), op: "select" });
      let state = await workspace.request({ ...env(), op: "state" });
      for (
        let i = 0;
        i < 1000 && state.ok && state.roots[0].status !== "complete";
        i++
      ) {
        await Bun.sleep(2);
        state = await workspace.request({ ...env(), op: "state" });
      }
      if (!state.ok || state.roots[0].status !== "complete")
        throw Error("Scan incomplete");
      const selected = state.roots[0];
      await roster.drain();
      expect(notifications).toBe(1);
      if (action === "remove") {
        const s = await workspace.removeFolderRoot({ ...env(), op: "state" });
        if (s.status !== "state") throw Error();
        const operation = {
          session: s.session,
          sequence: s.sequence,
          root: selected.handle,
        };
        const p = await workspace.removeFolderRoot({
          ...env(),
          ...operation,
          op: "prepare",
          generation: selected.generation,
          documents: [],
        });
        expect(p.status).toBe("issued");
        const suspend = workspace.suspendRootMutations();
        expect(
          (
            await workspace.removeFolderRoot({
              ...env(),
              ...operation,
              op: "commit",
              decision: "keep",
            })
          ).status
        ).toBe("busy");
        suspend();
        expect(
          (
            await workspace.removeFolderRoot({
              ...env(),
              ...operation,
              op: "commit",
              decision: "keep",
            })
          ).status
        ).toBe("committed");
        await workspace.removeFolderRoot({
          ...env(),
          ...operation,
          op: "query",
        });
      } else {
        const s = await workspace.trashDocument({ ...env(), op: "state" });
        if (s.status !== "state") throw Error();
        const operation = { session: s.session, sequence: s.sequence };
        const p = await workspace.trashDocument({
          ...env(),
          ...operation,
          op: "prepare",
          target: {
            kind: "directory",
            root: selected.handle,
            generation: selected.generation,
          },
        });
        if (p.status !== "prepared") throw Error(p.status);
        expect(
          (
            await workspace.trashDocument({
              ...env(),
              ...operation,
              op: "commit",
              confirmationToken: p.confirmationToken,
            })
          ).status
        ).toBe("trashed");
        await workspace.trashDocument({ ...env(), ...operation, op: "query" });
      }
      await roster.drain();
      expect(notifications).toBe(2);
      const restarted = createRootRosterService(
        data,
        () => false,
        () => undefined
      );
      expect((await restarted.request(list)).pending).toEqual([]);
      await restarted.close();
    } finally {
      await workspace.dispose();
      await roster.close();
      await docs.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }
});
