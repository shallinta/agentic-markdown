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

import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import { MAIN_TAB_METADATA_MAX_TABS } from "../../shared/main-tab-checkpoint";
import { createDocumentService } from "../documents";
import { verifySingleFileAuthorization } from "../documents/path-authorization";
import { createMainTabRecoveryRPC } from "../rpc/main-tab-recovery";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { resolveMainTabBlockAnchor } from "./main-tab-anchor-worker-client";
import { createMainTabMetadataBinder } from "./main-tab-binder";
import { createMainTabGroupRecoveryReader } from "./main-tab-group-recovery";
import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";
import { createMainTabPairRecoveryReader } from "./main-tab-pair-recovery";
import { encodeMainTabPosition } from "./main-tab-position-codec";
import { createSingleMainTabRecoveryReader } from "./main-tab-single-recovery";
import { createMarkdownBlockAnchorProbe } from "./markdown-block-anchor-probe";

async function fixture(count = 2) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pair-recovery-")));
  const folder = join(dir, "root");
  await mkdir(folder);
  await writeFile(join(folder, "a.md"), "# Alpha\n");
  await writeFile(join(folder, "b.md"), "# Beta\n");
  for (let index = 2; index < count; index++)
    await writeFile(
      join(folder, `extra-${String(index).padStart(2, "0")}.md`),
      `# Extra ${index}\n`
    );
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
  if (nodes?.length !== count) throw Error("Files missing");
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

test("internal group accepts five and existing-capacity tabs, while pair entry remains exact two", async () => {
  for (const count of [5, MAIN_TAB_METADATA_MAX_TABS]) {
    const f = await fixture(count);
    const group = createMainTabGroupRecoveryReader(f.directory, f);
    const pair = createMainTabPairRecoveryReader(f.directory, f);
    try {
      expect(await pair.read(f.input, () => true)).toEqual({
        status: "rejected",
        reason: "unavailable",
      });
      expect(f.reads()).toBe(0);
      const result = await group.read(f.input, () => true);
      if (result.status !== "ready") throw Error(JSON.stringify(result));
      expect(result.tabs).toHaveLength(count);
      expect(result.activeIndex).toBe(1);
      expect(result.tabs.map((tab) => [tab.mode, tab.pinned])).toEqual(
        Array.from({ length: count }, (_, index) => [
          index === 0 ? "source" : "editing",
          index === 0,
        ])
      );
      expect(result.tabs[0].snapshot.fileName).toBe("a.md");
      expect(result.tabs[1].snapshot.fileName).toBe("b.md");
      expect(result.tabs[count - 1].snapshot.text).toBe(
        `# Extra ${count - 1}\n`
      );
      expect(f.reads()).toBe(count);
      const owner = createMainTabCheckpointMetadataStore(f.directory);
      try {
        expect(
          await owner.claimObservation(result.ownership, () => result.current())
        ).toBe(true);
        expect(await readFile(f.path)).toEqual(f.bytes);
        expect(await result.release()).toBe("released");
        expect(f.documents.locations()).toHaveLength(0);
        expect(await owner.clearOwned(() => true)).toEqual({
          status: "committed",
        });
        expect(await readFile(`${f.path}.bak`)).toEqual(f.bytes);
      } finally {
        await owner.close();
      }
    } finally {
      await group.close();
      await pair.close();
      await f.close();
    }
  }
});

test("group terminal history check rejects external record changes made during reads", async () => {
  const f = await fixture(5);
  let count = 0;
  const reader = createMainTabGroupRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const result = await f.workspace.openMainTabCandidate(input, proof);
        if (++count === 2) {
          const record = JSON.parse(f.bytes.toString()) as {
            version: number;
            data: { activeIndex: number };
          };
          record.data.activeIndex = 0;
          await writeFile(f.path, JSON.stringify(record));
        }
        return result;
      },
    },
  });
  try {
    expect((await reader.read(f.input, () => true)).status).toBe("rejected");
    expect(count).toBe(5);
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path)).not.toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("group cancellation releases every acquired grant even after unknown cleanup", async () => {
  const f = await fixture(5);
  let valid = true,
    count = 0,
    released = 0;
  const reader = createMainTabGroupRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const result = await f.workspace.openMainTabCandidate(input, proof);
        if (++count === 4) valid = false;
        return result;
      },
    },
    documents: {
      ...f.documents,
      async release(request) {
        released++;
        if (released === 1) throw Error("Injected failure");
        return f.documents.release(request);
      },
    },
  });
  try {
    expect(await reader.read(f.input, () => valid)).toEqual({
      status: "unknown",
      reason: "release",
    });
    expect(released).toBe(4);
    expect(f.documents.locations()).toHaveLength(1);
    expect(await readFile(f.path)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("group rejects over-capacity metadata without reads or touching authoritative bytes", async () => {
  const f = await fixture(5);
  const reader = createMainTabGroupRecoveryReader(f.directory, f);
  try {
    const record = JSON.parse(f.bytes.toString()) as {
      version: number;
      data: { tabs: Record<string, unknown>[]; activeIndex: number };
    };
    record.data.tabs = Array.from(
      { length: MAIN_TAB_METADATA_MAX_TABS + 1 },
      (_, index) => ({ ...record.data.tabs[0], relativePath: `${index}.md` })
    );
    const bytes = JSON.stringify(record);
    await writeFile(f.path, bytes);
    expect(await reader.read(f.input, () => true)).toEqual({
      status: "rejected",
      reason: "unavailable",
    });
    expect(f.reads()).toBe(0);
    expect(await readFile(f.path, "utf8")).toBe(bytes);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("group rejects mixed roots before opening and first-file changes during the last read", async () => {
  const f = await fixture(5);
  let count = 0;
  const reader = createMainTabGroupRecoveryReader(f.directory, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const result = await f.workspace.openMainTabCandidate(input, proof);
        if (++count === 5)
          await writeFile(
            join(f.folder, "a.md"),
            "# Changed during last group read\n"
          );
        return result;
      },
    },
  });
  try {
    const record = await f.store.read();
    if (record.status !== "valid") throw Error("Missing record");
    expect(
      await f.store.write(
        {
          ...record.data,
          tabs: record.data.tabs.map((tab, index) =>
            index === 3 ? { ...tab, rootId: crypto.randomUUID() } : tab
          ),
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(await reader.read(f.input, () => true)).toEqual({
      status: "rejected",
      reason: "unavailable",
    });
    expect(count).toBe(0);
    expect(await f.store.write(record.data, () => true)).toEqual({
      status: "committed",
    });
    expect(await reader.read(f.input, () => true)).toEqual({
      status: "rejected",
      reason: "unavailable",
    });
    expect(f.documents.locations()).toHaveLength(0);
    expect(f.reads()).toBe(5);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("group rejects history changed after asynchronous file terminal verification", async () => {
  for (const changeDuringRevalidation of [false, true]) {
    const f = await fixture(5);
    let mutate = !changeDuringRevalidation;
    const reader = createMainTabGroupRecoveryReader(f.directory, {
      ...f,
      documents: {
        ...f.documents,
        async verifyRecoverySnapshots(snapshots, check) {
          const valid = await f.documents.verifyRecoverySnapshots(
            snapshots,
            check
          );
          if (mutate) {
            const record = JSON.parse(f.bytes.toString()) as {
              data: { activeIndex: number };
            };
            record.data.activeIndex = 0;
            await writeFile(f.path, JSON.stringify(record));
          }
          return valid;
        },
      },
    });
    try {
      const result = await reader.read(f.input, () => true);
      if (changeDuringRevalidation) {
        if (result.status !== "ready") throw Error("No initial group");
        mutate = true;
        expect(await result.revalidate()).toBe(false);
        expect(result.current()).toBe(false);
        expect(await result.release()).toBe("released");
      } else expect(result.status).toBe("rejected");
      expect(f.documents.locations()).toHaveLength(0);
      expect(await readFile(f.path)).not.toEqual(f.bytes);
    } finally {
      await reader.close();
      await f.close();
    }
  }
});

test("v2 single, pair and group reject position-only changes before verification or delivery", async () => {
  for (const kind of ["single", "pair", "group"] as const) {
    for (const terminal of [false, true]) {
      const f = await fixture(kind === "group" ? 5 : 2);
      const initial = await f.store.read();
      if (initial.status !== "valid") throw Error("Missing fixture");
      const tabs =
        kind === "single" ? initial.data.tabs.slice(0, 1) : initial.data.tabs;
      const data = {
        schemaVersion: 2 as const,
        tabs: tabs.map((tab) => ({
          ...tab,
          position: { from: 0, offset: 0, ratio: 0.5 },
        })),
        activeIndex: kind === "single" ? 0 : 1,
      };
      expect(await f.store.writePositions(data, () => true)).toEqual({
        status: "committed",
      });
      let changed = false;
      const mutate = async () => {
        if (changed) return;
        changed = true;
        data.tabs[0].position.offset = 1;
        await writeFile(f.path, JSON.stringify({ version: 1, data }));
      };
      const dependencies = {
        ...f,
        workspace: {
          ...f.workspace,
          async openMainTabCandidate(
            ...args: Parameters<typeof f.workspace.openMainTabCandidate>
          ) {
            if (!terminal) await mutate();
            const result = await f.workspace.openMainTabCandidate(...args);
            if (terminal && kind === "single") await mutate();
            return result;
          },
        },
        documents: {
          ...f.documents,
          async verifyRecoverySnapshots(
            ...args: Parameters<typeof f.documents.verifyRecoverySnapshots>
          ) {
            const result = await f.documents.verifyRecoverySnapshots(...args);
            if (terminal) await mutate();
            return result;
          },
        },
      };
      const reader =
        kind === "single"
          ? createSingleMainTabRecoveryReader(f.directory, dependencies)
          : kind === "pair"
            ? createMainTabPairRecoveryReader(f.directory, dependencies)
            : createMainTabGroupRecoveryReader(f.directory, dependencies);
      try {
        const result = await reader.read(f.input, () => true);
        expect(changed).toBe(true);
        expect(result.status).toBe("rejected");
        expect(f.documents.locations()).toHaveLength(0);
        expect(await readFile(f.path, "utf8")).toBe(
          JSON.stringify({ version: 1, data })
        );
      } finally {
        await reader.close();
        await f.close();
      }
    }
  }
});

test("verified single, pair and group deliver only each saved row's source geometry", async () => {
  for (const kind of ["single", "pair", "group"] as const) {
    const f = await fixture(kind === "group" ? 5 : 2);
    const saved = await f.store.read();
    if (saved.status !== "valid") throw Error("No history");
    const tabs =
      kind === "single" ? saved.data.tabs.slice(0, 1) : saved.data.tabs;
    const positions = tabs.map((_, index) =>
      index === 1
        ? undefined
        : {
            from: index + 2,
            offset: index - 0.5,
            ratio: index / 5,
            block: {
              contentHash: "a".repeat(64),
              hash: "b".repeat(64),
              occurrence: 0,
              uniqueAtCapture: true,
              offset: 3,
            },
          }
    );
    expect(
      await f.store.writePositions(
        {
          schemaVersion: 2,
          tabs: tabs.map((tab, index) =>
            positions[index] ? { ...tab, position: positions[index] } : tab
          ),
          activeIndex: kind === "single" ? 0 : 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    const bytes = await readFile(f.path);
    const reader =
      kind === "single"
        ? createSingleMainTabRecoveryReader(f.directory, f)
        : kind === "pair"
          ? createMainTabPairRecoveryReader(f.directory, f)
          : createMainTabGroupRecoveryReader(f.directory, f);
    try {
      const result = await reader.read(f.input, () => true);
      if (result.status !== "ready") throw Error(JSON.stringify(result));
      const items = "tabs" in result ? result.tabs : [result];
      expect(items).toHaveLength(tabs.length);
      for (let index = 0; index < items.length; index++) {
        expect(items[index].snapshot.fileName).toBe(tabs[index].relativePath);
        const position = positions[index];
        expect(items[index].viewport).toEqual(
          position
            ? {
                from: position.from,
                offset: position.offset,
                ratio: position.ratio,
              }
            : undefined
        );
        if (!position)
          expect(
            Object.prototype.hasOwnProperty.call(items[index], "viewport")
          ).toBe(false);
      }
      expect(await readFile(f.path)).toEqual(bytes);
      expect(await result.release()).toBe("released");
      expect(f.documents.locations()).toHaveLength(0);
    } finally {
      await reader.close();
      await f.close();
    }
  }
});

test("actual group RPC transfers each verified viewport beside its corresponding snapshot", async () => {
  const f = await fixture();
  const saved = await f.store.read();
  if (saved.status !== "valid") throw Error("No history");
  const first = { from: 3, offset: -2, ratio: 0.3 },
    second = { from: 5, offset: 4, ratio: 0.6 };
  expect(
    await f.store.writePositions(
      {
        schemaVersion: 2,
        tabs: saved.data.tabs.map((tab, index) => ({
          ...tab,
          position: index === 0 ? first : second,
        })),
        activeIndex: 1,
      },
      () => true
    )
  ).toEqual({ status: "committed" });
  const rpc = createMainTabRecoveryRPC(
    true,
    () => true,
    () => createSingleMainTabRecoveryReader(f.directory, f),
    undefined,
    () => createMainTabGroupRecoveryReader(f.directory, f)
  );
  try {
    rpc.ready({ data: { detail: PACKAGED_VIEW_URL } });
    const opened = await rpc.request({
      ...f.input,
      protocolVersion: 1,
      op: "open",
    });
    expect(opened.status).toBe("group");
    for (const index of [0, 1]) {
      const item = await rpc.request({
        protocolVersion: 1,
        requestId: f.input.requestId,
        op: "group-item",
        index,
      });
      if (item.status !== "group-item") throw Error(JSON.stringify(item));
      expect(item.viewport).toEqual(index === 0 ? first : second);
      expect(item.snapshot.fileName).toBe(saved.data.tabs[index].relativePath);
    }
    expect(
      (
        await rpc.request({
          protocolVersion: 1,
          requestId: f.input.requestId,
          op: "finish",
          adopted: false,
        })
      ).status
    ).toBe("finished");
    expect(f.documents.locations()).toHaveLength(0);
  } finally {
    rpc.dispose();
    await f.close();
  }
});

test("single RPC rejects v2 modified after service await and releases the late snapshot", async () => {
  const f = await fixture();
  const saved = await f.store.read();
  if (saved.status !== "valid") throw Error("No history");
  const data = {
    schemaVersion: 2 as const,
    tabs: [
      { ...saved.data.tabs[0], position: { from: 2, offset: 0, ratio: 0.3 } },
    ],
    activeIndex: 0,
  };
  expect(await f.store.writePositions(data, () => true)).toEqual({
    status: "committed",
  });
  const reader = createSingleMainTabRecoveryReader(f.directory, f);
  const rpc = createMainTabRecoveryRPC(
    true,
    () => true,
    () => ({
      ...reader,
      async read(...args: Parameters<typeof reader.read>) {
        const result = await reader.read(...args);
        expect(result.status).toBe("ready");
        data.tabs[0].position.ratio = 0.9;
        await writeFile(f.path, JSON.stringify({ version: 1, data }));
        return result;
      },
    })
  );
  try {
    rpc.ready({ data: { detail: PACKAGED_VIEW_URL } });
    const response = await rpc.request({
      protocolVersion: 1,
      op: "open",
      ...f.input,
    });
    expect(response).toEqual({
      protocolVersion: 1,
      requestId: f.input.requestId,
      status: "rejected",
    });
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path, "utf8")).toBe(
      JSON.stringify({ version: 1, data })
    );
  } finally {
    rpc.dispose();
    await reader.close();
    await f.close();
  }
});

test("group last-item delivery rejects position changed after async revalidation", async () => {
  const f = await fixture();
  const saved = await f.store.read();
  if (saved.status !== "valid") throw Error("No history");
  const data = {
    schemaVersion: 2 as const,
    tabs: saved.data.tabs.map((tab) => ({
      ...tab,
      position: { from: 1, offset: 0, ratio: 0.3 },
    })),
    activeIndex: 1,
  };
  expect(await f.store.writePositions(data, () => true)).toEqual({
    status: "committed",
  });
  const group = createMainTabGroupRecoveryReader(f.directory, f);
  let deliveryChecks = 0;
  const rpc = createMainTabRecoveryRPC(
    true,
    () => true,
    () => createSingleMainTabRecoveryReader(f.directory, f),
    undefined,
    () => ({
      ...group,
      async read(...args: Parameters<typeof group.read>) {
        const result = await group.read(...args);
        if (result.status !== "ready") return result;
        return {
          ...result,
          verifyDelivery() {
            deliveryChecks++;
            return result.verifyDelivery!();
          },
          async revalidate() {
            const valid = await result.revalidate();
            expect(valid).toBe(true);
            data.tabs[0].position.ratio = 0.9;
            await writeFile(f.path, JSON.stringify({ version: 1, data }));
            return valid;
          },
        };
      },
    })
  );
  try {
    rpc.ready({ data: { detail: PACKAGED_VIEW_URL } });
    expect(
      (await rpc.request({ protocolVersion: 1, op: "open", ...f.input })).status
    ).toBe("group");
    expect(
      (
        await rpc.request({
          protocolVersion: 1,
          op: "group-item",
          requestId: f.input.requestId,
          index: 0,
        })
      ).status
    ).toBe("group-item");
    expect(deliveryChecks).toBe(0);
    expect(
      await rpc.request({
        protocolVersion: 1,
        op: "group-item",
        requestId: f.input.requestId,
        index: 1,
      })
    ).toEqual({
      protocolVersion: 1,
      requestId: f.input.requestId,
      status: "rejected",
    });
    expect(deliveryChecks).toBe(1);
    expect(f.documents.locations()).toHaveLength(0);
    expect(await readFile(f.path, "utf8")).toBe(
      JSON.stringify({ version: 1, data })
    );
  } finally {
    rpc.dispose();
    await group.close();
    await f.close();
  }
});

async function prepareBlockPositions(
  f: Awaited<ReturnType<typeof fixture>>,
  changed = [0, 1]
) {
  const record = await f.store.read();
  if (record.status !== "valid") throw Error("No history");
  const tabs = [];
  for (const [index, tab] of record.data.tabs.entries()) {
    const path = join(f.folder, tab.relativePath),
      raw = await readFile(path, "utf8");
    const probe = createMarkdownBlockAnchorProbe(raw);
    if (probe.status !== "ready") throw Error("No parser");
    const position = encodeMainTabPosition(
      probe.capturePosition({ from: 0, offset: index - 2, ratio: 0.4 })
    );
    if (!position?.block) throw Error("No anchor");
    tabs.push({ ...tab, position });
    if (changed.includes(index)) await writeFile(path, "intro\n\n" + raw);
  }
  expect(
    await f.store.writePositions(
      { schemaVersion: 2, tabs, activeIndex: 1 },
      () => true
    )
  ).toEqual({ status: "committed" });
}

test("group resolves active changed block first then visual order without rereading bodies", async () => {
  const f = await fixture();
  await prepareBlockPositions(f);
  const order: string[] = [];
  const reader = createMainTabGroupRecoveryReader(f.directory, {
    ...f,
    resolveViewport(raw, position, signal) {
      order.push(raw);
      return resolveMainTabBlockAnchor(raw, position, signal);
    },
  });
  try {
    const result = await reader.read(f.input, () => true);
    if (result.status !== "ready") throw Error(JSON.stringify(result));
    expect(order).toEqual(["intro\n\n# Beta\n", "intro\n\n# Alpha\n"]);
    expect(
      result.tabs.map((tab) => [tab.snapshot.fileName, tab.viewport])
    ).toEqual([
      ["a.md", { from: 7, offset: -2, ratio: 0.4 }],
      ["b.md", { from: 7, offset: -1, ratio: 0.4 }],
    ]);
    expect(f.reads()).toBe(2);
    expect(result.verifyDelivery?.()).toBe(true);
    expect(await result.release()).toBe("released");
  } finally {
    await reader.close();
    await f.close();
  }
});

test("held group resolver cancels with caller or close and releases all grants", async () => {
  for (const kind of ["caller", "close"] as const) {
    const f = await fixture();
    await prepareBlockPositions(f);
    const abort = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const reader = createMainTabGroupRecoveryReader(f.directory, {
      ...f,
      resolveViewport(_raw, _position, signal) {
        entered();
        return new Promise((resolve) =>
          signal!.addEventListener("abort", () => resolve(undefined), {
            once: true,
          })
        );
      },
    });
    try {
      const pending = reader.read(f.input, () => true, abort.signal);
      await started;
      if (kind === "caller") abort.abort();
      else await reader.close();
      expect((await pending).status).toBe("rejected");
      expect(f.documents.locations()).toHaveLength(0);
    } finally {
      abort.abort();
      await reader.close();
      await f.close();
    }
  }
});

test("async group resolution also fences unchanged peer snapshots at final delivery", async () => {
  const f = await fixture();
  await prepareBlockPositions(f, [1]);
  const reader = createMainTabGroupRecoveryReader(f.directory, f);
  try {
    const result = await reader.read(f.input, () => true);
    if (result.status !== "ready") throw Error(JSON.stringify(result));
    expect(await result.revalidate()).toBe(true);
    await writeFile(join(f.folder, "a.md"), "# Other\n");
    expect(result.verifyDelivery?.()).toBe(false);
    expect(await result.release()).toBe("released");
    expect(f.documents.locations()).toHaveLength(0);
  } finally {
    await reader.close();
    await f.close();
  }
});

test("shared group parser deadline falls back and never starts a second held resolver", async () => {
  const f = await fixture();
  await prepareBlockPositions(f);
  let attempts = 0,
    aborted = false;
  const reader = createMainTabGroupRecoveryReader(f.directory, {
    ...f,
    resolveViewport(_raw, _position, signal) {
      attempts++;
      return new Promise((resolve) =>
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve(undefined);
          },
          { once: true }
        )
      );
    },
  });
  try {
    const result = await reader.read(f.input, () => true);
    if (result.status !== "ready") throw Error(JSON.stringify(result));
    expect(aborted).toBe(true);
    expect(attempts).toBe(1);
    expect(result.tabs.map((tab) => tab.viewport)).toEqual([
      { from: 0, offset: -2, ratio: 0.4 },
      { from: 0, offset: -1, ratio: 0.4 },
    ]);
    expect(result.verifyDelivery?.()).toBe(true);
    expect(await result.release()).toBe("released");
  } finally {
    await reader.close();
    await f.close();
  }
}, 9000);
