import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import { createDocumentService } from "../documents";
import { createMainTabRecoveryRPC } from "../rpc/main-tab-recovery";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { resolveMainTabBlockAnchor } from "./main-tab-anchor-worker-client";
import { createMainTabMetadataBinder } from "./main-tab-binder";
import {
  createMainTabCheckpointMetadataStore,
  type MainTabSessionMetadata,
} from "./main-tab-metadata";
import { encodeMainTabPosition } from "./main-tab-position-codec";
import { createSingleMainTabRecoveryReader } from "./main-tab-single-recovery";
import { createMarkdownBlockAnchorProbe } from "./markdown-block-anchor-probe";

async function child(operation: "write" | "read" | "reject", directory: string): Promise<unknown> {
  const processHandle = Bun.spawn([
    process.execPath, join(import.meta.dir, "main-tab-single-recovery-child.ts"), operation, directory,
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(), processHandle.exited,
  ]);
  if (code !== 0) throw Error(`Recovery ${operation} failed (${code})\n${stderr}`);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as unknown;
}

test("an independent process reads exactly one reauthorized saved tab and settles its new grant", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "single-tab-recovery-")));
  const folder = join(directory, "workspace");
  const file = join(folder, "original.md");
  const checkpoint = join(directory, "metadata", "main-tab-session-checkpoint.json");
  try {
    await mkdir(folder);
    await writeFile(file, "# Original contents\n");
    await writeFile(join(folder, "sentinel.md"), "# Existing grant\n");
    expect(await child("write", directory)).toEqual({ written: { status: "committed" }, mruUnchanged: true });
    const authority = await readFile(checkpoint);
    const initialFile = await stat(file, { bigint: true });
    await writeFile(file, "# Current contents\n");
    const changedFile = await stat(file, { bigint: true });
    expect([changedFile.dev, changedFile.ino]).toEqual([initialFile.dev, initialFile.ino]);
    expect(await child("read", directory)).toEqual({
      initial: { pending: 1, roots: 0, grants: 0 }, proof: true, grants: 1, mode: "source", pinned: true,
      currentText: true, treeAuthority: true, released: "released", releasedProof: false,
      finalGrants: 0, metadataUnchanged: true, mruUnchanged: true,
    });
    expect(await readFile(checkpoint)).toEqual(authority);
    expect(await readFile(file, "utf8")).toBe("# Current contents\n");

    expect(await child("reject", directory)).toEqual({
      initial: { pending: 1, roots: 0, grants: 0 }, wrongRoot: "rejected:unavailable", expired: "rejected:stale",
      protectedResults: Array.from({ length: 3 }, () => ({ result: "rejected:unavailable", preserved: true })),
      changedRecord: "rejected:stale", afterReread: "rejected:stale", racedPublication: "committed", priorGrantKept: true,
      staleAfterOpen: "rejected:stale", priorGrantKeptAfterOpen: true,
      lateReleased: { result: "rejected:stale", count: 0, releases: 1 },
      unknownRelease: { result: "unknown:release", count: 1, releases: 1 }, existing: "rejected:unavailable",
      existingKept: true, staleGeneration: "rejected:stale", replacement: "rejected:unavailable", finalGrants: 0,
      metadataUnchanged: true, backupUnchanged: true, mruUnchanged: true,
    });
    expect(await readFile(checkpoint)).toEqual(authority);
    expect(await readFile(join(folder, "old.md"), "utf8")).toBe("# Current contents\n");
    expect(await readFile(file, "utf8")).toBe("# A different file\n");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("same-path owned clear invalidates old observations and fences a queued read", async () => {
  const directory = await mkdtemp(join(tmpdir(), "single-tab-observation-"));
  const writer = createMainTabCheckpointMetadataStore(directory);
  const reader = createMainTabCheckpointMetadataStore(`${directory}/.`);
  try {
    const saved: MainTabSessionMetadata = { tabs: [{ rootId: crypto.randomUUID(), relativePath: "a.md", fingerprint: "1:2:3", pinned: false, mode: "editing" }], activeIndex: 0 };
    expect(await writer.write(saved, () => true)).toEqual({ status: "committed" });
    const before = await reader.readObserved();
    if (before.status !== "valid") throw Error(before.status);
    expect(before.current()).toBe(true);
    const clearing = writer.clearOwned(() => true);
    expect(before.current()).toBe(false);
    expect(await reader.readObserved()).toEqual({ status: "stale" });
    expect(await clearing).toEqual({ status: "committed" });
    const empty = await reader.readObserved();
    if (empty.status !== "valid") throw Error(empty.status);
    expect(empty.data).toEqual({ tabs: [], activeIndex: null });
    expect(empty.current()).toBe(true);
    await reader.close();
    expect(empty.current()).toBe(false);
  } finally {
    await Promise.all([writer.close(), reader.close()]);
    await rm(directory, { recursive: true, force: true });
  }
});

async function anchoredFixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "single-anchor-"))
  );
  const folder = join(directory, "root"),
    file = join(folder, "a.md"),
    metadata = join(directory, "metadata");
  const text = "before\n\ntarget\n\nafter";
  await mkdir(folder);
  await writeFile(file, text);
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
  });
  const roster = createRootRosterService(
    join(directory, "roster"),
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
  for (let index = 0; index < 1000; index++) {
    const state = await workspace.request({ ...request(), op: "state" });
    if (!state.ok) throw Error("No workspace");
    root = state.roots[0];
    if (root?.status === "complete") break;
    await Bun.sleep(2);
  }
  if (root?.status !== "complete") throw Error("No scan");
  await roster.drain();
  const page = await workspace.request({
    ...request(),
    op: "page",
    root: root.handle,
    generation: root.generation,
    cursor: 0,
  });
  const node = page.ok
    ? page.nodes?.find((node) => node.kind === "file")
    : undefined;
  if (!node) throw Error("No node");
  const opened = await workspace.open({
    ...request(),
    root: root.handle,
    entry: node.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error("No snapshot");
  const snapshot = opened.snapshot;
  const bound = await createMainTabMetadataBinder({ workspace, roster }).bind({
    tabs: [
      {
        handle: snapshot.handle,
        documentId: snapshot.documentId,
        revision: snapshot.revision,
        hash: snapshot.hash,
        mode: "editing",
        pinned: false,
      },
    ],
    activeIndex: 0,
  });
  if (bound.status !== "ready") throw Error("No binding");
  const probe = createMarkdownBlockAnchorProbe(text);
  if (probe.status !== "ready") throw Error("No parser");
  const position = encodeMainTabPosition(
    probe.capturePosition({ from: 8, offset: -2, ratio: 0.4 })
  );
  if (!position?.block) throw Error("No block");
  const store = createMainTabCheckpointMetadataStore(metadata);
  const save = (withBlock = true) =>
    store.writePositions(
      {
        schemaVersion: 2,
        tabs: [
          {
            ...bound.data.tabs[0],
            position: withBlock
              ? position
              : {
                  from: position.from,
                  offset: position.offset,
                  ratio: position.ratio,
                },
          },
        ],
        activeIndex: 0,
      },
      () => true
    );
  await save();
  await documents.release({ ...request(), handle: snapshot.handle });
  return {
    file,
    text,
    documents,
    roster,
    workspace,
    metadata,
    save,
    input: {
      requestId: crypto.randomUUID(),
      root: root.handle,
      generation: root.generation,
      expectedRootId: bound.data.tabs[0].rootId,
    },
    async close() {
      await store.close();
      await workspace.dispose();
      await documents.dispose();
      await roster.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("single changed block resolves existing snapshot in worker; unchanged or absent anchors skip it", async () => {
  for (const mode of ["changed", "unchanged", "absent", "miss"] as const) {
    const f = await anchoredFixture();
    let calls = 0;
    if (mode === "absent") await f.save(false);
    if (mode !== "unchanged") await writeFile(f.file, "intro\n\n" + f.text);
    const reader = createSingleMainTabRecoveryReader(f.metadata, {
      ...f,
      resolveViewport(raw, position, signal) {
        calls++;
        return mode === "miss"
          ? Promise.resolve(undefined)
          : resolveMainTabBlockAnchor(raw, position, signal);
      },
    });
    try {
      const result = await reader.read(f.input, () => true);
      if (result.status !== "ready") throw Error(JSON.stringify(result));
      expect(calls).toBe(mode === "changed" || mode === "miss" ? 1 : 0);
      expect(result.viewport).toEqual({
        from: mode === "changed" ? 15 : 8,
        offset: -2,
        ratio: 0.4,
      });
      expect(result.verifyDelivery?.()).toBe(true);
      expect(await result.release()).toBe("released");
    } finally {
      await reader.close();
      await f.close();
    }
  }
});

test("changed-block await cancellation and throwing physical proof clean the newly minted grant", async () => {
  for (const failure of ["cancel", "physical", "throw"] as const) {
    const f = await anchoredFixture();
    await writeFile(f.file, "intro\n\n" + f.text);
    let live = true,
      entered!: () => void,
      resume!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const reader = createSingleMainTabRecoveryReader(f.metadata, {
      ...f,
      documents:
        failure === "throw"
          ? {
              ...f.documents,
              currentRecoverySnapshot() {
                throw Error("physical proof failed");
              },
            }
          : f.documents,
      async resolveViewport() {
        entered();
        await waiting;
        return undefined;
      },
    });
    try {
      const pending = reader.read(f.input, () => live);
      await started;
      if (failure === "cancel") live = false;
      if (failure === "physical")
        await writeFile(f.file, "another\n\n" + f.text);
      resume();
      expect((await pending).status).toBe("rejected");
      expect(f.documents.locations()).toHaveLength(0);
    } finally {
      resume();
      await reader.close();
      await f.close();
    }
  }
});

test("finish(false) aborts held anchor resolution through the real single reader and releases its grant", async () => {
  const f = await anchoredFixture();
  await writeFile(f.file, "intro\n\n" + f.text);
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let aborted = false;
  const reader = createSingleMainTabRecoveryReader(f.metadata, {
    ...f,
    resolveViewport(_raw, _position, signal) {
      entered();
      return new Promise((resolve) => {
        signal!.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve(undefined);
          },
          { once: true }
        );
      });
    },
  });
  const rpc = createMainTabRecoveryRPC(
    true,
    () => true,
    () => reader
  );
  try {
    rpc.ready({ data: { detail: PACKAGED_VIEW_URL } });
    const opening = rpc.request({ protocolVersion: 1, op: "open", ...f.input });
    await started;
    const finished = await rpc.request({
      protocolVersion: 1,
      requestId: f.input.requestId,
      op: "finish",
      adopted: false,
    });
    expect(aborted).toBe(true);
    expect(finished.status).toBe("finished");
    expect((await opening).status).toBe("rejected");
    expect(f.documents.locations()).toHaveLength(0);
  } finally {
    rpc.dispose();
    await reader.close();
    await f.close();
  }
});
