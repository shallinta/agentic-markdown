import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";
import { verifySingleFileAuthorization } from "../documents/path-authorization";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createMainTabMetadataBinder } from "./main-tab-binder";
import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";
import { createMainTabPairRecoveryReader } from "./main-tab-pair-recovery";

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pair-recovery-")));
  const folder = join(dir, "root");
  await mkdir(folder);
  await writeFile(join(folder, "a.md"), "# Alpha\n");
  await writeFile(join(folder, "b.md"), "# Beta\n");
  let reads = 0;
  let afterVerify: ((path: string) => Promise<void>) | undefined;
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
    async verify(grant, check) {
      const stamp = await verifySingleFileAuthorization(grant, check);
      await afterVerify?.(grant.path);
      return stamp;
    },
    onTiming: (phase) => {
      if (phase === "diskReadMs") reads++;
    },
  });
  const roster = createRootRosterService(
    join(dir, "settings"),
    () => false,
    () => undefined
  );
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(folder),
    onRootRosterCommitted: (event) => roster.committed(event),
  });
  const request = () => ({
    protocolVersion: 1 as const,
    requestId: crypto.randomUUID(),
  });
  await workspace.request({ ...request(), op: "select" });
  let root;
  for (let attempt = 0; attempt < 1000; attempt++) {
    const state = await workspace.request({ ...request(), op: "state" });
    if (!state.ok) throw Error("State unavailable");
    root = state.roots[0];
    if (root?.status === "complete") break;
    await Bun.sleep(2);
  }
  if (root?.status !== "complete") throw Error("Scan failed");
  await roster.drain();
  const page = await workspace.request({
    ...request(),
    op: "page",
    root: root.handle,
    generation: root.generation,
    cursor: 0,
  });
  if (!page.ok) throw Error("Page unavailable");
  const nodes = page.nodes
    ?.filter((node) => node.kind === "file")
    .sort((a, b) => a.name.localeCompare(b.name));
  if (nodes?.length !== 2) throw Error("Files missing");
  const snapshots = [];
  for (const node of nodes) {
    const response = await workspace.open({
      ...request(),
      root: root.handle,
      entry: node.handle,
    });
    if (!response.ok || !response.snapshot) throw Error("Open failed");
    snapshots.push(response.snapshot);
  }
  const binder = createMainTabMetadataBinder({ workspace, roster });
  const bound = await binder.bind({
    tabs: snapshots.map((snapshot, index) => ({
      handle: snapshot.handle,
      documentId: snapshot.documentId,
      hash: snapshot.hash,
      revision: snapshot.revision,
      pinned: index === 0,
      mode: index === 0 ? "source" : "editing",
    })),
    activeIndex: 1,
  });
  if (bound.status !== "ready") throw Error("Bind failed");
  const directory = join(dir, "metadata");
  const store = createMainTabCheckpointMetadataStore(directory);
  expect(await store.write(bound.data, () => true)).toEqual({
    status: "committed",
  });
  for (const snapshot of snapshots)
    await documents.release({ ...request(), handle: snapshot.handle });
  const input = {
    requestId: crypto.randomUUID(),
    root: root.handle,
    generation: root.generation,
    expectedRootId: bound.data.tabs[0].rootId,
  };
  const path = join(directory, "main-tab-session-checkpoint.json");
  const bytes = await readFile(path);
  reads = 0;
  return {
    dir,
    folder,
    documents,
    workspace,
    roster,
    directory,
    store,
    input,
    path,
    bytes,
    reads: () => reads,
    setAfterVerify(callback: (path: string) => Promise<void>) {
      afterVerify = callback;
    },
    async close() {
      await store.close();
      await workspace.dispose();
      await documents.dispose();
      await roster.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("two real scoped snapshots retain order, modes and active item without rereading bodies", async () => {
  const f = await fixture();
  const reader = createMainTabPairRecoveryReader(f.directory, f);
  try {
    const result = await reader.read(f.input, () => true);
    if (result.status !== "ready") throw Error(JSON.stringify(result));
    expect(
      result.tabs.map((tab) => [tab.snapshot.fileName, tab.mode, tab.pinned])
    ).toEqual([
      ["a.md", "source", true],
      ["b.md", "editing", false],
    ]);
    expect(result.activeIndex).toBe(1);
    expect(result.current()).toBe(true);

    expect(f.reads()).toBe(2);
    expect(f.documents.locations()).toHaveLength(2);
    expect(await readFile(f.path)).toEqual(f.bytes);
    expect(await result.revalidate()).toBe(true);
    const owner = createMainTabCheckpointMetadataStore(f.directory);
    expect(
      await owner.claimObservation(result.ownership, () => result.current())
    ).toBe(true);
    expect(await readFile(f.path)).toEqual(f.bytes);
    expect(await owner.clearOwned(() => true)).toEqual({ status: "committed" });
    expect(await readFile(`${f.path}.bak`)).toEqual(f.bytes);
    await owner.close();
    expect(await result.release()).toBe("released");
    expect(await result.release()).toBe("released");
    expect(result.current()).toBe(false);
    expect(f.documents.locations()).toHaveLength(0);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("first file same-inode edit during second read rejects and releases both grants", async () => {
  const f = await fixture();
  let count = 0;
  const reader = createMainTabPairRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const response = await f.workspace.openMainTabCandidate(input, proof);
        if (++count === 2)
          await writeFile(join(f.folder, "a.md"), "# Changed first\n");
        return response;
      },
    },
  });
  try {
    expect(await reader.read(f.input, () => true)).toEqual({
      status: "rejected",
      reason: "unavailable",
    });
    expect(f.reads()).toBe(2);
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("cancellation after second open attempts every release despite the first unknown", async () => {
  const f = await fixture();
  let valid = true;
  let opened = 0;
  let releases = 0;
  const reader = createMainTabPairRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const response = await f.workspace.openMainTabCandidate(input, proof);
        if (++opened === 2) valid = false;
        return response;
      },
    },
    documents: {
      ...f.documents,
      async release(request) {
        releases++;
        if (releases === 1) throw Error("Injected release unknown");
        return f.documents.release(request);
      },
    },
  });
  try {
    expect(await reader.read(f.input, () => valid)).toEqual({
      status: "unknown",
      reason: "release",
    });
    expect(releases).toBe(2);
    expect(f.documents.locations()).toHaveLength(1);
    expect(await readFile(f.path)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("second physical open failure releases only first newly acquired grant", async () => {
  const f = await fixture();
  let count = 0;
  const reader = createMainTabPairRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        if (++count === 2) await rm(join(f.folder, "b.md"));
        return f.workspace.openMainTabCandidate(input, proof);
      },
    },
  });
  try {
    expect((await reader.read(f.input, () => true)).status).toBe("rejected");
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("same-path checkpoint admission between opens cancels the batch without overwriting history", async () => {
  const f = await fixture();
  let opened = 0;
  const reader = createMainTabPairRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const response = await f.workspace.openMainTabCandidate(input, proof);
        if (++opened === 1) {
          const record = await f.store.read();
          if (record.status !== "valid") throw Error("Record missing");
          expect(await f.store.write(record.data, () => true)).toEqual({
            status: "committed",
          });
        }
        return response;
      },
    },
  });
  try {
    expect(await reader.read(f.input, () => true)).toEqual({
      status: "rejected",
      reason: "stale",
    });
    expect(opened).toBe(1);
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("cross-root and duplicate file identities are rejected before any body read", async () => {
  const f = await fixture();
  const reader = createMainTabPairRecoveryReader(f.directory, f);
  try {
    const record = await f.store.read();
    if (record.status !== "valid") throw Error("Record missing");
    for (const second of [
      { ...record.data.tabs[1], rootId: crypto.randomUUID() },
      { ...record.data.tabs[1], fingerprint: record.data.tabs[0].fingerprint },
    ]) {
      expect(
        await f.store.write(
          { tabs: [record.data.tabs[0], second], activeIndex: 1 },
          () => true
        )
      ).toEqual({ status: "committed" });
      const bytes = await readFile(f.path);
      expect(await reader.read(f.input, () => true)).toEqual({
        status: "rejected",
        reason: "unavailable",
      });
      expect(f.documents.locations()).toHaveLength(0);
      expect(await readFile(f.path)).toEqual(bytes);
    }
    expect(f.reads()).toBe(0);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("borrowed prior-batch snapshot with matching response envelope is never released", async () => {
  const f = await fixture();
  const original = createMainTabPairRecoveryReader(f.directory, f);
  let releases = 0;
  const reader = createMainTabPairRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      openMainTabCandidate: (input) =>
        Promise.resolve({
          protocolVersion: 1,
          requestId: input.requestId,
          ok: true,
          snapshot: borrowed,
        }),
    },
    documents: {
      ...f.documents,
      release: (request) => {
        releases++;
        return f.documents.release(request);
      },
    },
  });
  let borrowed: import("../../shared/documents").DocumentSnapshot;
  try {
    const result = await original.read(f.input, () => true);
    if (result.status !== "ready") throw Error("No prior batch");
    borrowed = result.tabs[0].snapshot;
    expect(await reader.read(f.input, () => true)).toEqual({
      status: "unknown",
      reason: "io",
    });
    expect(releases).toBe(0);
    expect(f.documents.locations()).toHaveLength(2);
    expect(await result.release()).toBe("released");
  } finally {
    await reader.close();
    await original.close();
    await f.close();
  }
});

test("repeated same-handle response from first request releases that grant exactly once", async () => {
  const f = await fixture();
  let first: import("../../shared/documents").DocumentSnapshot | undefined;
  let releases = 0;
  const reader = createMainTabPairRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        if (first)
          return {
            protocolVersion: 1,
            requestId: input.requestId,
            ok: true,
            snapshot: first,
          };
        const response = await f.workspace.openMainTabCandidate(input, proof);
        if (response.ok && response.snapshot) first = response.snapshot;
        return response;
      },
    },
    documents: {
      ...f.documents,
      release: (request) => {
        releases++;
        return f.documents.release(request);
      },
    },
  });
  try {
    expect(await reader.read(f.input, () => true)).toEqual({
      status: "unknown",
      reason: "io",
    });
    expect(releases).toBe(1);
    expect(f.documents.locations()).toHaveLength(0);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("first file modified during final second-file verify is rejected before group publication", async () => {
  const f = await fixture();
  let opened = 0;
  let changed = false;
  const reader = createMainTabPairRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const response = await f.workspace.openMainTabCandidate(input, proof);
        if (++opened === 2)
          f.setAfterVerify(async (path) => {
            if (path === join(f.folder, "b.md")) {
              await writeFile(
                join(f.folder, "a.md"),
                "# Late first-file change\n"
              );
              changed = true;
            }
          });
        return response;
      },
    },
  });
  try {
    const result = await reader.read(f.input, () => true);
    expect(changed).toBe(true);
    expect(result).toEqual({ status: "rejected", reason: "unavailable" });
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("delivery revalidation detects changes after the ready result without rereading bodies", async () => {
  const f = await fixture();
  const reader = createMainTabPairRecoveryReader(f.directory, f);
  try {
    const result = await reader.read(f.input, () => true);
    if (result.status !== "ready") throw Error("No pair");
    await writeFile(join(f.folder, "a.md"), "# Changed before item two\n");
    expect(await result.revalidate()).toBe(false);
    expect(result.current()).toBe(false);
    expect(f.reads()).toBe(2);
    expect(await result.release()).toBe("released");
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});
