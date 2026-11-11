import { expect, test } from "bun:test";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspaceRoot } from "../../shared/workspace";
import { createDocumentService } from "../documents";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createMainTabMetadataBinder } from "./main-tab-binder";
import { createMainTabMultiRootRecoveryReader } from "./main-tab-group-recovery";
import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";

const envelope = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});

function authority(settings: string) {
  let directory: string | null = null;
  let reads = 0;
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
    onTiming: (phase) => {
      if (phase === "diskReadMs") reads++;
    },
  });
  const roster = createRootRosterService(
    settings,
    () => false,
    () => undefined
  );
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(directory),
    onRootRosterCommitted: (event) => roster.committed(event),
  });
  return {
    documents,
    roster,
    workspace,
    reads: () => reads,
    async select(path: string) {
      directory = path;
      const selected = await workspace.request({ ...envelope(), op: "select" });
      if (!selected.ok || !selected.selectedRoot)
        throw Error("Fixture root was not selected");
      const handle = selected.selectedRoot.handle;
      for (let attempt = 0; attempt < 500; attempt++) {
        const state = await workspace.request({ ...envelope(), op: "state" });
        if (!state.ok) throw Error("Fixture root state unavailable");
        const root = state.roots.find((item) => item.handle === handle);
        if (root?.status === "complete") {
          await roster.drain();
          return root;
        }
        await Bun.sleep(2);
      }
      throw Error("Fixture root scan did not complete");
    },
    async open(root: WorkspaceRoot, name: string) {
      const page = await workspace.request({
        ...envelope(),
        op: "page",
        root: root.handle,
        generation: root.generation,
        cursor: 0,
      });
      if (!page.ok) throw Error("Fixture page unavailable");
      const entry = page.nodes?.find(
        (node) => node.kind === "file" && node.name === name
      );
      if (!entry) throw Error("Fixture file not scanned");
      const opened = await workspace.open({
        ...envelope(),
        root: root.handle,
        entry: entry.handle,
      });
      if (!opened.ok || !opened.snapshot)
        throw Error("Fixture file was not opened");
      return opened.snapshot;
    },
    async close() {
      await workspace.dispose();
      await documents.dispose();
      await roster.close();
    },
  };
}

async function fixture(hardLinkBeforeReauthorization = false) {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "multi-root-recovery-"))
  );
  const [alpha, beta, extra] = ["alpha", "beta", "extra"].map((name) =>
    join(directory, name)
  );
  const settings = join(directory, "settings");
  const metadata = join(directory, "metadata");
  const checkpoint = join(metadata, "main-tab-session-checkpoint.json");
  const old = authority(settings);
  const store = createMainTabCheckpointMetadataStore(metadata);
  let live: ReturnType<typeof authority> | undefined;
  try {
    await Promise.all([alpha, beta, extra].map((root) => mkdir(root)));
    const alphaFile = join(alpha, "shared.md"),
      betaFile = join(beta, "shared.md");
    await Promise.all([
      writeFile(alphaFile, "# Original Alpha\n"),
      writeFile(betaFile, "# Beta\n"),
      writeFile(join(alpha, "tail.md"), "# Alpha tail\n"),
      writeFile(join(extra, "unrelated.md"), "# Unrelated\n"),
    ]);
    const oldAlpha = await old.select(alpha),
      oldBeta = await old.select(beta);
    const snapshots = [
      await old.open(oldAlpha, "shared.md"),
      await old.open(oldBeta, "shared.md"),
      await old.open(oldAlpha, "tail.md"),
    ];
    const bound = await createMainTabMetadataBinder(old).bind({
      tabs: snapshots.map(({ handle, documentId, hash, revision }, index) => ({
        handle,
        documentId,
        hash,
        revision,
        pinned: index === 0,
        mode: index === 1 ? "editing" : "source",
      })),
      activeIndex: 1,
    });
    if (
      bound.status !== "ready" ||
      (await store.write(bound.data, () => bound.current())).status !==
        "committed"
    )
      throw Error("Fixture checkpoint was not recorded");
    await old.close();

    if (hardLinkBeforeReauthorization) {
      await rm(betaFile);
      await link(alphaFile, betaFile);
    }
    // Re-authorize the directories under a new workspace and document authority.
    const current = authority(settings);
    live = current;
    const currentBeta = await current.select(beta),
      currentAlpha = await current.select(alpha),
      currentExtra = await current.select(extra);
    const unrelated = await current.open(currentExtra, "unrelated.md");
    const initialReads = current.reads();
    const scope = async (root: WorkspaceRoot) => {
      const identity = await current.roster.confirmExpansionIdentity(
        root.displayPath
      );
      if (!identity?.current())
        throw Error("Fixture root roster identity unavailable");
      return {
        root: root.handle,
        generation: root.generation,
        expectedRootId: identity.id,
      };
    };
    const alphaScope = await scope(currentAlpha),
      betaScope = await scope(currentBeta);
    if (
      oldAlpha.handle === alphaScope.root ||
      oldBeta.handle === betaScope.root ||
      alphaScope.expectedRootId !== bound.data.tabs[0].rootId ||
      betaScope.expectedRootId !== bound.data.tabs[1].rootId
    )
      throw Error("Fixture did not renew authority for the same durable roots");
    return {
      ...current,
      store,
      metadata,
      checkpoint,
      alphaFile,
      unrelated,
      bytes: await readFile(checkpoint),
      record: bound.data,
      roots: [betaScope, alphaScope] as const,
      extra: await scope(currentExtra),
      bodyReads: () => current.reads() - initialReads,
      async dispose() {
        await store.close();
        await current.close();
        await rm(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await Promise.allSettled([old.close(), live?.close(), store.close()]);
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

test("reauthorized roots recover distinct same-name files in record order and release only the recovered grants", async () => {
  const f = await fixture();
  const reader = createMainTabMultiRootRecoveryReader(f.metadata, f);
  try {
    expect(f.record.tabs.map((tab) => tab.relativePath)).toEqual([
      "shared.md",
      "shared.md",
      "tail.md",
    ]);
    await writeFile(f.alphaFile, "# Current Alpha body\n");
    const result = await reader.read(
      { requestId: crypto.randomUUID(), roots: f.roots },
      () => true
    );
    if (result.status !== "ready") throw Error(JSON.stringify(result));
    expect(
      result.tabs.map(({ snapshot, mode, pinned }) => [
        snapshot.fileName,
        snapshot.text,
        mode,
        pinned,
      ])
    ).toEqual([
      ["shared.md", "# Current Alpha body\n", "source", true],
      ["shared.md", "# Beta\n", "editing", false],
      ["tail.md", "# Alpha tail\n", "source", false],
    ]);
    expect(result.activeIndex).toBe(1);
    expect(
      new Set(result.tabs.map((tab) => tab.snapshot.documentId)).size
    ).toBe(3);
    expect(f.documents.locations()).toHaveLength(4);
    expect(await result.revalidate()).toBe(true);
    expect(f.bodyReads()).toBe(3);
    expect(await result.release()).toBe("released");
    expect(await result.release()).toBe("released");
    expect(result.current()).toBe(false);
    expect(f.documents.locations().map((location) => location.handle)).toEqual([
      f.unrelated.handle,
    ]);
    expect(await readFile(f.checkpoint)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.dispose();
  }
});

test("mismatched, missing, extra or stale root tickets are rejected before reading a body", async () => {
  const f = await fixture();
  const reader = createMainTabMultiRootRecoveryReader(f.metadata, f);
  const [beta, alpha] = f.roots;
  try {
    for (const { roots, reason } of [
      { roots: [alpha, f.extra], reason: "unavailable" },
      { roots: [beta, alpha, f.extra], reason: "unavailable" },
      {
        roots: [
          { ...beta, expectedRootId: alpha.expectedRootId },
          { ...alpha, expectedRootId: beta.expectedRootId },
        ],
        reason: "unavailable",
      },
      {
        roots: [beta, { ...alpha, generation: alpha.generation + 1 }],
        reason: "stale",
      },
      { roots: [beta, { ...alpha, root: beta.root }], reason: "invalid" },
      {
        roots: [beta, { ...alpha, expectedRootId: beta.expectedRootId }],
        reason: "invalid",
      },
    ] as const) {
      expect(
        await reader.read({ requestId: crypto.randomUUID(), roots }, () => true)
      ).toEqual({ status: "rejected", reason });
    }
    expect(f.bodyReads()).toBe(0);
    expect(f.documents.locations().map((location) => location.handle)).toEqual([
      f.unrelated.handle,
    ]);
    expect(await readFile(f.checkpoint)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.dispose();
  }
});

test("the cross-root reader rejects a genuine single-root checkpoint before capturing authorization", async () => {
  const f = await fixture();
  let captures = 0;
  const reader = createMainTabMultiRootRecoveryReader(f.metadata, {
    ...f,
    workspace: {
      ...f.workspace,
      captureMainTabCandidates(root, generation) {
        captures++;
        return f.workspace.captureMainTabCandidates(root, generation);
      },
    },
  });
  try {
    const alpha = f.roots[1];
    const record = {
      tabs: f.record.tabs.filter((tab) => tab.rootId === alpha.expectedRootId),
      activeIndex: 1,
    };
    expect(record.tabs).toHaveLength(2);
    expect(await f.store.write(record, () => true)).toEqual({
      status: "committed",
    });
    const bytes = await readFile(f.checkpoint);
    expect(
      await reader.read(
        { requestId: crypto.randomUUID(), roots: [alpha] },
        () => true
      )
    ).toEqual({ status: "rejected", reason: "invalid" });
    expect(captures).toBe(0);
    expect(f.bodyReads()).toBe(0);
    expect(await readFile(f.checkpoint)).toEqual(bytes);
  } finally {
    await reader.close();
    await f.dispose();
  }
});

test("different roots and paths for the same hard-linked physical file are rejected before a body read", async () => {
  const f = await fixture(true);
  const reader = createMainTabMultiRootRecoveryReader(f.metadata, f);
  try {
    const [beta, alpha] = f.roots;
    const first = f.record.tabs[0];
    const second = { ...f.record.tabs[1], fingerprint: first.fingerprint };
    const resolve = (root: typeof alpha, tab: typeof first) =>
      f.workspace
        .captureMainTabCandidates(root.root, root.generation)
        ?.resolve(tab.relativePath, tab.fingerprint, () => undefined);
    const firstEntry = await resolve(alpha, first);
    const secondEntry = await resolve(beta, second);
    expect(firstEntry).toBeString();
    expect(secondEntry).toBeString();
    expect(firstEntry).not.toBe(secondEntry);
    expect(
      await f.store.write({ tabs: [first, second], activeIndex: 1 }, () => true)
    ).toEqual({ status: "committed" });
    const bytes = await readFile(f.checkpoint);
    expect(
      await reader.read(
        { requestId: crypto.randomUUID(), roots: f.roots },
        () => true
      )
    ).toEqual({ status: "rejected", reason: "unavailable" });
    expect(f.bodyReads()).toBe(0);
    expect(f.documents.locations().map((location) => location.handle)).toEqual([
      f.unrelated.handle,
    ]);
    expect(await readFile(f.checkpoint)).toEqual(bytes);
  } finally {
    await reader.close();
    await f.dispose();
  }
});

test("all participating root generations are captured before roster I/O and a concurrent rescan invalidates the group", async () => {
  const f = await fixture();
  const captured: string[] = [];
  let capturedBeforeRoster: readonly string[] = [];
  let newGeneration: number | undefined;
  const reader = createMainTabMultiRootRecoveryReader(f.metadata, {
    ...f,
    workspace: {
      ...f.workspace,
      captureMainTabCandidates(root, generation) {
        captured.push(root);
        return f.workspace.captureMainTabCandidates(root, generation);
      },
    },
    roster: {
      async confirmExpansionIdentity(path) {
        capturedBeforeRoster = [...captured];
        const result = await f.roster.confirmExpansionIdentity(path);
        const refreshed = await f.workspace.request({
          ...envelope(),
          op: "rescan",
          root: f.roots[1].root,
        });
        newGeneration = refreshed.ok
          ? refreshed.roots.find((root) => root.handle === f.roots[1].root)
              ?.generation
          : undefined;
        return result;
      },
    },
  });
  try {
    expect(
      await reader.read(
        { requestId: crypto.randomUUID(), roots: f.roots },
        () => true
      )
    ).toEqual({ status: "rejected", reason: "stale" });
    expect(capturedBeforeRoster).toEqual(f.roots.map((root) => root.root));
    expect(newGeneration ?? 0).toBeGreaterThan(f.roots[1].generation);
    expect(f.bodyReads()).toBe(0);
    expect(f.documents.locations().map((location) => location.handle)).toEqual([
      f.unrelated.handle,
    ]);
    expect(await readFile(f.checkpoint)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.dispose();
  }
});

test("content and history changes after real opens discard the acquired cross-root grants", async () => {
  for (const changeHistory of [false, true]) {
    const f = await fixture();
    let opened = 0;
    let expectedBytes = f.bytes;
    const reader = createMainTabMultiRootRecoveryReader(f.metadata, {
      ...f,
      workspace: {
        ...f.workspace,
        async openMainTabCandidate(input, proof) {
          const result = await f.workspace.openMainTabCandidate(input, proof);
          if (++opened === 2) {
            if (changeHistory) {
              expect(
                await f.store.write({ ...f.record, activeIndex: 2 }, () => true)
              ).toEqual({ status: "committed" });
              expectedBytes = await readFile(f.checkpoint);
            } else
              await writeFile(f.alphaFile, "# Changed after the first grant\n");
          }
          return result;
        },
      },
    });
    try {
      expect(
        await reader.read(
          { requestId: crypto.randomUUID(), roots: f.roots },
          () => true
        )
      ).toEqual({
        status: "rejected",
        reason: changeHistory ? "stale" : "unavailable",
      });
      expect(f.bodyReads()).toBe(changeHistory ? 2 : 3);
      expect(
        f.documents.locations().map((location) => location.handle)
      ).toEqual([f.unrelated.handle]);
      expect(await readFile(f.checkpoint)).toEqual(expectedBytes);
    } finally {
      await reader.close();
      await f.dispose();
    }
  }
});

test("cancellation still attempts every acquired cross-root release when one receipt is unknown", async () => {
  const f = await fixture();
  let current = true;
  const acquired: string[] = [],
    released: string[] = [];
  const reader = createMainTabMultiRootRecoveryReader(f.metadata, {
    ...f,
    workspace: {
      ...f.workspace,
      async openMainTabCandidate(input, proof) {
        const result = await f.workspace.openMainTabCandidate(input, proof);
        if (result.ok && result.snapshot) {
          acquired.push(result.snapshot.handle);
          if (acquired.length === 2) current = false;
        }
        return result;
      },
    },
    documents: {
      ...f.documents,
      release(request) {
        if (
          !request ||
          typeof request !== "object" ||
          !("handle" in request) ||
          typeof request.handle !== "string"
        )
          throw Error("Fixture release request has no grant handle");
        released.push(request.handle);
        if (released.length === 1)
          return Promise.reject(Error("fixture unknown release"));
        return f.documents.release(request);
      },
    },
  });
  try {
    expect(
      await reader.read(
        { requestId: crypto.randomUUID(), roots: f.roots },
        () => current
      )
    ).toEqual({ status: "unknown", reason: "release" });
    expect(f.bodyReads()).toBe(2);
    expect(acquired).toHaveLength(2);
    expect(released).toEqual(acquired);
    expect(f.documents.locations().map((location) => location.handle)).toEqual([
      f.unrelated.handle,
      acquired[0],
    ]);
    expect(await readFile(f.checkpoint)).toEqual(f.bytes);
  } finally {
    await reader.close();
    await f.dispose();
  }
});
