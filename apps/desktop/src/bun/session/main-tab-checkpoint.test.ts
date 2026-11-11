import { expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
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
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import {
  createMainTabMetadataBinder,
  type MainTabSourceInput,
} from "./main-tab-binder";
import { createGuardedMainTabCheckpoint } from "./main-tab-checkpoint";
import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";
import { createSingleMainTabRecoveryReader } from "./main-tab-single-recovery";

async function fixture() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "tab-binder-")));
  const paths = [join(dir, "one/same"), join(dir, "two/same")];
  for (const path of paths) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "a.md"), "# Synthetic");
  }
  let selected = paths[0],
    selectedFile = join(paths[0], "a.md");
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(selectedFile),
  });
  const roster = createRootRosterService(
    join(dir, "settings"),
    () => false,
    () => undefined
  );
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(selected),
    onRootRosterCommitted: (event) => roster.committed(event),
  });
  const binder = createMainTabMetadataBinder({ workspace, roster });
  const request = () => ({
    protocolVersion: 1 as const,
    requestId: crypto.randomUUID(),
  });
  const call = async (op: string, more: object = {}) => {
    const response = await workspace.request({ ...request(), op, ...more });
    if (!response.ok) throw Error(JSON.stringify(response));
    return response;
  };
  const pick = async (path: string) => {
    selected = path;
    await call("select");
    for (let i = 0; i < 1000; i++) {
      const root = (await call("state")).roots.find(
        (root) => root.displayPath === path
      );
      if (root?.status === "complete") {
        await roster.drain();
        return root;
      }
      await Bun.sleep(2);
    }
    throw Error("Scan incomplete");
  };
  const open = async (path: string) => {
    const root = await pick(path);
    const nodes = (
      await call("page", {
        root: root.handle,
        generation: root.generation,
        cursor: 0,
      })
    ).nodes!;
    const node = nodes.find((node) => node.kind === "file");
    if (!node) throw Error("No file");
    const opened = await workspace.open({
      ...request(),
      root: root.handle,
      entry: node.handle,
    });
    if (!opened.ok || !opened.snapshot) throw Error(JSON.stringify(opened));
    const { handle, documentId, revision, hash } = opened.snapshot;
    return {
      root,
      snapshot: opened.snapshot,
      tab: {
        handle,
        documentId,
        revision,
        hash,
        pinned: false,
        mode: "editing",
      } as MainTabSourceInput,
    };
  };
  return {
    dir,
    paths,
    documents,
    roster,
    workspace,
    binder,
    call,
    pick,
    open,
    request,
    setFile(path: string) {
      selectedFile = path;
    },
    async close() {
      await workspace.dispose();
      await documents.dispose();
      await roster.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("guarded real root bindings checkpoint separately, survive process restart and never persist authority or content", async () => {
  const f = await fixture();
  const directory = join(f.dir, "metadata");
  const writer = createGuardedMainTabCheckpoint(directory, f);
  try {
    const a = await f.open(f.paths[0]);
    const b = await f.open(f.paths[1]);
    const input = {
      tabs: [{ ...b.tab, pinned: true, mode: "source" }, a.tab],
      activeIndex: 1,
    };
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const saved = await writer.read();
    expect(saved.status).toBe("valid");
    if (saved.status !== "valid") throw Error(saved.status);
    expect(
      saved.data.tabs.map((tab) => [tab.relativePath, tab.pinned, tab.mode])
    ).toEqual([
      ["a.md", true, "source"],
      ["a.md", false, "editing"],
    ]);
    expect(saved.data.activeIndex).toBe(1);
    const file = join(directory, "main-tab-session-checkpoint.json");
    const bytes = await readFile(file);
    for (const secret of [
      f.dir,
      a.tab.handle,
      b.tab.handle,
      a.tab.documentId,
      "# Synthetic",
    ])
      expect(bytes.toString()).not.toContain(secret);
    expect(
      await Bun.file(join(directory, "main-tab-session-probe.json")).exists()
    ).toBe(false);
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "main-tab-checkpoint-child.ts"),
        directory,
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(saved);
    expect(
      await writer.write({ tabs: [], activeIndex: null }, () => true)
    ).toEqual({ status: "rejected", reason: "empty" });
    expect(await writer.write(input, () => false)).toEqual({
      status: "rejected",
      reason: "stale",
    });
    expect(
      await writer.write(input, () => {
        throw Error("not live");
      })
    ).toEqual({ status: "rejected", reason: "stale" });
    expect(
      await writer.write({ ...input, activeIndex: 99 }, () => true)
    ).toEqual({ status: "rejected", reason: "invalid" });
    expect(await readFile(file)).toEqual(bytes);
    for (const path of f.paths)
      expect(await readFile(join(path, "a.md"), "utf8")).toBe("# Synthetic");
  } finally {
    await writer.close();
    await f.close();
  }
});

test("late caller invalidation and changed real roster proof cannot replace a previous checkpoint", async () => {
  const f = await fixture();
  const directory = join(f.dir, "metadata");
  const writer = createGuardedMainTabCheckpoint(directory, f);
  let late: ReturnType<typeof createGuardedMainTabCheckpoint> | undefined;
  try {
    const { tab } = await f.open(f.paths[0]);
    const input = { tabs: [tab], activeIndex: 0 };
    expect((await writer.write(input, () => true)).status).toBe("committed");
    const file = join(directory, "main-tab-session-checkpoint.json");
    const bytes = await readFile(file);
    let current = true;
    late = createGuardedMainTabCheckpoint(directory, {
      workspace: f.workspace,
      roster: {
        async confirmExpansionIdentity(path) {
          const proof = await f.roster.confirmExpansionIdentity(path);
          current = false;
          return proof;
        },
      },
    });
    expect(await late.write(input, () => current)).toEqual({
      status: "rejected",
      reason: "stale",
    });
    await late.close();
    late = createGuardedMainTabCheckpoint(directory, {
      workspace: f.workspace,
      roster: {
        async confirmExpansionIdentity(path) {
          const proof = await f.roster.confirmExpansionIdentity(path);
          f.roster.committed({ paths: [], explicitClear: true });
          await f.roster.drain();
          return proof;
        },
      },
    });
    expect(await late.write(input, () => true)).toEqual({
      status: "rejected",
      reason: "stale",
    });
    expect(await readFile(file)).toEqual(bytes);
  } finally {
    await late?.close();
    await writer.close();
    await f.close();
  }
});

test("standalone grant and protected future checkpoint are not overwritten", async () => {
  const f = await fixture();
  const directory = join(f.dir, "metadata");
  const writer = createGuardedMainTabCheckpoint(directory, f);
  try {
    const standalone = await f.documents.select(f.request());
    if (!standalone.ok || !standalone.snapshot) throw Error("fixture open");
    const { handle, documentId, revision, hash } = standalone.snapshot;
    expect(
      await writer.write(
        {
          tabs: [
            {
              handle,
              documentId,
              revision,
              hash,
              pinned: false,
              mode: "editing",
            },
          ],
          activeIndex: 0,
        },
        () => true
      )
    ).toEqual({ status: "rejected", reason: "unavailable" });
    const { tab } = await f.open(f.paths[1]);
    await mkdir(directory, { recursive: true });
    const file = join(directory, "main-tab-session-checkpoint.json");
    const bytes = '{"version":99,"data":{"future":true}}\n';
    await writeFile(file, bytes);
    expect(
      await writer.write({ tabs: [tab], activeIndex: 0 }, () => true)
    ).toEqual({ status: "rejected", reason: "future" });
    expect(await readFile(file, "utf8")).toBe(bytes);
  } finally {
    await writer.close();
    await f.close();
  }
});

test("metadata store rejects guard at prepublication while preserving the prior bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "checkpoint-guard-"));
  const store = createMainTabCheckpointMetadataStore(dir);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: false,
          mode: "editing" as const,
        },
      ],
      activeIndex: 0,
    };
    expect((await store.write(data, () => true)).status).toBe("committed");
    for (const guard of [undefined, null, true]) {
      expect(
        await Reflect.apply(store.write.bind(store), store, [data, guard])
      ).toEqual({
        status: "rejected",
        reason: "stale",
      });
    }
    const file = join(dir, "main-tab-session-checkpoint.json");
    const bytes = await readFile(file);
    expect(
      await store.write(
        { ...data, tabs: [{ ...data.tabs[0], pinned: true }] },
        () => false
      )
    ).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(file)).toEqual(bytes);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkpoint invocation order survives delayed first binding and inputs are copied before awaits", async () => {
  const f = await fixture();
  let writer: ReturnType<typeof createGuardedMainTabCheckpoint> | undefined;
  try {
    const { tab } = await f.open(f.paths[0]);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    let proofCount = 0;
    writer = createGuardedMainTabCheckpoint(join(f.dir, "metadata"), {
      workspace: {
        async captureMainTabSources(tabs, check) {
          proofCount++;
          if (first) {
            first = false;
            await barrier;
          }
          return f.workspace.captureMainTabSources(tabs, check);
        },
      },
      roster: f.roster,
    });
    const input = { tabs: [{ ...tab }], activeIndex: 0 };
    const one = writer.write(input, () => true);
    input.tabs[0].documentId = crypto.randomUUID();
    const two = writer.write(
      { tabs: [{ ...tab, pinned: true, mode: "source" }], activeIndex: 0 },
      () => true
    );
    await Bun.sleep(5);
    expect(proofCount).toBe(1);
    release();
    expect(await one).toEqual({ status: "committed" });
    expect(await two).toEqual({ status: "committed" });
    expect(proofCount).toBe(2);
    const read = await writer.read();
    expect(read.status).toBe("valid");
    if (read.status === "valid")
      expect(read.data.tabs[0]).toMatchObject({ pinned: true, mode: "source" });
    await writer.close();
    expect(
      await writer.write({ tabs: [tab], activeIndex: 0 }, () => true)
    ).toEqual({ status: "rejected", reason: "closed" });
  } finally {
    await writer?.close();
    await f.close();
  }
});

test.each(['{"version":99,"data":{"future":true}}\n', "{broken publication\n"])(
  "guarded publication observed as incompatible remains unknown without rollback: %s",
  async (replacement) => {
    const directory = await mkdtemp(join(tmpdir(), "checkpoint-observation-"));
    const store = createMainTabCheckpointMetadataStore(directory);
    const filename = "main-tab-session-checkpoint.json";
    try {
      const data = {
        tabs: [
          {
            rootId: crypto.randomUUID(),
            relativePath: "a.md",
            fingerprint: "1:2:3",
            pinned: false,
            mode: "editing" as const,
          },
        ],
        activeIndex: 0,
      };
      expect(await store.write(data, () => true)).toEqual({
        status: "committed",
      });
      let injected = false;
      const result = await store.write(
        { ...data, tabs: [{ ...data.tabs[0], pinned: true }] },
        () => {
          // Controlled filesystem interference at the real pre-rename boundary.
          // Exclude the backup temporary file; actual rename and observation still run.
          const temporary = readdirSync(directory).find(
            (name) =>
              name.startsWith(`${filename}.${process.pid}.`) &&
              name.endsWith(".tmp")
          );
          if (temporary && !injected) {
            writeFileSync(join(directory, temporary), replacement);
            injected = true;
          }
          return true;
        }
      );
      expect(injected).toBe(true);
      expect(result).toEqual({ status: "unknown", reason: "io" });
      expect(await readFile(join(directory, filename), "utf8")).toBe(
        replacement
      );
      expect(
        JSON.parse(await readFile(join(directory, `${filename}.bak`), "utf8"))
      ).toEqual({ version: 1, data });
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  }
);

test("only a confirmed new publication owns a checkpoint; identical preexisting bytes cannot be claimed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-owned-"));
  const first = createMainTabCheckpointMetadataStore(directory);
  const second = createMainTabCheckpointMetadataStore(directory);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: false,
          mode: "editing" as const,
        },
      ],
      activeIndex: 0,
    };
    expect(await second.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(readdirSync(directory)).toEqual([]);
    expect(await first.write(data, () => true)).toEqual({
      status: "committed",
    });
    expect(await second.write(data, () => true)).toEqual({
      status: "committed",
    });
    expect(await second.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await first.write(data, () => true)).toEqual({
      status: "committed",
    });
    expect(await first.clearOwned(() => false)).toEqual({
      status: "rejected",
      reason: "stale",
    });
    expect(await first.clearOwned(() => true)).toEqual({ status: "committed" });
    expect(await first.read()).toEqual({
      status: "valid",
      data: { tabs: [], activeIndex: null },
    });
    expect(
      JSON.parse(
        await readFile(
          join(directory, "main-tab-session-checkpoint.json.bak"),
          "utf8"
        )
      )
    ).toEqual({ version: 1, data });
    expect(await first.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
  } finally {
    await first.close();
    await second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("owned clear compares the live queued authority and cannot erase another publication or future format", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-conflict-"));
  const store = createMainTabCheckpointMetadataStore(directory);
  const other = createMainTabCheckpointMetadataStore(directory);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: false,
          mode: "editing" as const,
        },
      ],
      activeIndex: 0,
    };
    await store.write(data, () => true);
    await other.write(
      { ...data, tabs: [{ ...data.tabs[0], pinned: true }] },
      () => true
    );
    const file = join(directory, "main-tab-session-checkpoint.json");
    const before = await readFile(file);
    expect(await store.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(file)).toEqual(before);
    await writeFile(file, '{"version":99,"data":{}}');
    expect(await other.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(file, "utf8")).toBe('{"version":99,"data":{}}');
  } finally {
    await store.close();
    await other.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a clear with unknown publication outcome revokes ownership and never retries or rolls back", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-clear-unknown-"));
  const store = createMainTabCheckpointMetadataStore(directory);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: false,
          mode: "editing" as const,
        },
      ],
      activeIndex: 0,
    };
    await store.write(data, () => true);
    const filename = "main-tab-session-checkpoint.json";
    let injected = false;
    expect(
      await store.clearOwned(() => {
        const temporary = readdirSync(directory).find(
          (name) =>
            name.startsWith(`${filename}.${process.pid}.`) &&
            name.endsWith(".tmp")
        );
        if (temporary && !injected) {
          writeFileSync(join(directory, temporary), "broken");
          injected = true;
        }
        return true;
      })
    ).toEqual({ status: "unknown", reason: "io" });
    expect(injected).toBe(true);
    expect(await store.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(join(directory, filename), "utf8")).toBe("broken");
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("real bound checkpoint clear shares the writer queue and still leaves markdown untouched", async () => {
  const f = await fixture();
  const writer = createGuardedMainTabCheckpoint(join(f.dir, "metadata"), f);
  try {
    const { tab } = await f.open(f.paths[0]);
    const write = writer.write({ tabs: [tab], activeIndex: 0 }, () => true);
    const clear = writer.clear(() => true);
    expect(await write).toEqual({ status: "committed" });
    expect(await clear).toEqual({ status: "committed" });
    expect(await writer.read()).toEqual({
      status: "valid",
      data: { tabs: [], activeIndex: null },
    });
    expect(await readFile(join(f.paths[0], "a.md"), "utf8")).toBe(
      "# Synthetic"
    );
  } finally {
    await writer.close();
    await f.close();
  }
});

test("same fields rewritten with different bytes cannot be cleared using old ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-bytes-"));
  const store = createMainTabCheckpointMetadataStore(directory);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: false,
          mode: "editing" as const,
        },
      ],
      activeIndex: 0,
    };
    expect(await store.write(data, () => true)).toEqual({
      status: "committed",
    });
    const path = join(directory, "main-tab-session-checkpoint.json");
    const alternate = JSON.stringify({ version: 1, data });
    await writeFile(path, alternate);
    expect(await store.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(path, "utf8")).toBe(alternate);
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rewriting equal fields from noncanonical bytes is a new publication and grants ownership", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-reformat-"));
  const store = createMainTabCheckpointMetadataStore(directory);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: false,
          mode: "editing" as const,
        },
      ],
      activeIndex: 0,
    };
    const path = join(directory, "main-tab-session-checkpoint.json");
    const previous = JSON.stringify({ version: 1, data });
    await writeFile(path, previous);
    expect(await store.write(data, () => true)).toEqual({
      status: "committed",
    });
    expect(await readFile(path, "utf8")).toBe(
      `${JSON.stringify({ version: 1, data }, null, 2)}\n`
    );
    expect(await readFile(`${path}.bak`, "utf8")).toBe(previous);
    expect(await store.clearOwned(() => true)).toEqual({ status: "committed" });
    expect(await store.read()).toEqual({
      status: "valid",
      data: { tabs: [], activeIndex: null },
    });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("private recovery observation claims exact historical bytes without a write, then owned clear works", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-claim-"));
  const prior = createMainTabCheckpointMetadataStore(directory),
    reader = createMainTabCheckpointMetadataStore(directory),
    writer = createMainTabCheckpointMetadataStore(directory);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: true,
          mode: "source" as const,
        },
      ],
      activeIndex: 0,
    };
    await prior.write(data, () => true);
    await prior.close();
    const path = join(directory, "main-tab-session-checkpoint.json"),
      bytes = await readFile(path);
    const observation = await reader.readObserved();
    expect(observation.status).toBe("valid");
    expect(
      await writer.claimObservation(
        { status: "valid", data, current: () => true },
        () => true
      )
    ).toBe(false);
    expect(await writer.claimObservation(observation, () => true)).toBe(true);
    expect(await readFile(path)).toEqual(bytes);
    expect(readdirSync(directory)).toEqual([
      "main-tab-session-checkpoint.json",
    ]);
    expect(await writer.clearOwned(() => true)).toEqual({
      status: "committed",
    });
    expect(await readFile(`${path}.bak`)).toEqual(bytes);
    expect(await writer.read()).toEqual({
      status: "valid",
      data: { tabs: [], activeIndex: null },
    });
  } finally {
    await prior.close();
    await reader.close();
    await writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("recovery claims reject replaced bytes, expired lifecycle and queued checkpoint generations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "checkpoint-claim-stale-"));
  const reader = createMainTabCheckpointMetadataStore(directory),
    writer = createMainTabCheckpointMetadataStore(directory);
  try {
    const data = {
      tabs: [
        {
          rootId: crypto.randomUUID(),
          relativePath: "a.md",
          fingerprint: "1:2:3",
          pinned: false,
          mode: "editing" as const,
        },
      ],
      activeIndex: 0,
    };
    await reader.write(data, () => true);
    const observation = await reader.readObserved();
    expect(await writer.claimObservation(observation, () => false)).toBe(false);
    const write = reader.write(data, () => true);
    expect(await writer.claimObservation(observation, () => true)).toBe(false);
    await write;
    const fresh = await reader.readObserved();
    const path = join(directory, "main-tab-session-checkpoint.json");
    const altered = JSON.stringify({ version: 1, data });
    await writeFile(path, altered);
    expect(await writer.claimObservation(fresh, () => true)).toBe(false);
    expect(await writer.clearOwned(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(path, "utf8")).toBe(altered);
  } finally {
    await reader.close();
    await writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("actual single recovery observation transfers ownership to a fresh writer without rewriting history", async () => {
  const f = await fixture();
  const directory = join(f.dir, "metadata");
  const initial = createGuardedMainTabCheckpoint(directory, f),
    writer = createGuardedMainTabCheckpoint(directory, f);
  const reader = createSingleMainTabRecoveryReader(directory, f);
  try {
    const { tab, root } = await f.open(f.paths[0]);
    await initial.write({ tabs: [tab], activeIndex: 0 }, () => true);
    await initial.close();
    const record = await writer.read();
    if (record.status !== "valid") throw Error("No history");
    await f.documents.release({ ...f.request(), handle: tab.handle });
    const path = join(directory, "main-tab-session-checkpoint.json"),
      before = await readFile(path);
    const recovered = await reader.read(
      {
        requestId: crypto.randomUUID(),
        root: root.handle,
        generation: root.generation,
        expectedRootId: record.data.tabs[0].rootId,
      },
      () => true
    );
    if (recovered.status !== "ready" || !recovered.ownership)
      throw Error("No recovery observation");
    expect(
      await writer.claim(recovered.ownership, () => recovered.current())
    ).toBe(true);
    expect(await readFile(path)).toEqual(before);
    expect(await recovered.release()).toBe("released");
    expect(await writer.clear(() => true)).toEqual({ status: "committed" });
    expect(await readFile(`${path}.bak`)).toEqual(before);
    expect(await writer.read()).toEqual({
      status: "valid",
      data: { tabs: [], activeIndex: null },
    });
  } finally {
    await initial.close();
    await writer.close();
    await reader.close();
    await f.close();
  }
});

test("viewport checkpoints preserve exact live instances, remove closed rows and reject bad bindings", async () => {
  const f = await fixture();
  const writer = createGuardedMainTabCheckpoint(join(f.dir, "metadata"), f);
  try {
    const a = await f.open(f.paths[0]),
      b = await f.open(f.paths[1]);
    const viewport = { from: 3, offset: -1.5, ratio: 0.6 };
    expect(
      await writer.write(
        { tabs: [{ ...a.tab, viewport }, b.tab], activeIndex: 1 },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(
      await writer.write({ tabs: [b.tab, a.tab], activeIndex: 0 }, () => true)
    ).toEqual({ status: "committed" });
    let read = await writer.read();
    if (read.status !== "valid") throw Error("No checkpoint");
    expect(read.positioned?.tabs[1].position).toEqual(viewport);
    expect(
      (
        await writer.write(
          { tabs: [{ ...a.tab, revision: 999, viewport }], activeIndex: 0 },
          () => true
        )
      ).status
    ).toBe("rejected");
    expect(
      await writer.write({ tabs: [b.tab], activeIndex: 0 }, () => true)
    ).toEqual({ status: "committed" });
    await f.documents.release({ ...f.request(), handle: a.tab.handle });
    const reopened = await f.open(f.paths[0]);
    expect(reopened.tab.handle).not.toBe(a.tab.handle);
    expect(
      await writer.write(
        { tabs: [b.tab, reopened.tab], activeIndex: 1 },
        () => true
      )
    ).toEqual({ status: "committed" });
    read = await writer.read();
    if (read.status !== "valid") throw Error("No checkpoint");
    expect(read.positioned?.tabs).toHaveLength(2);
    expect(
      read.positioned?.tabs.every((tab) => tab.position === undefined)
    ).toBe(true);
  } finally {
    await writer.close();
    await f.close();
  }
});

test("claimed historical v2 binds positions to delivered instances; unrelated new sessions may replace", async () => {
  const f = await fixture(),
    directory = join(f.dir, "metadata");
  const first = createGuardedMainTabCheckpoint(directory, f);
  const next = createGuardedMainTabCheckpoint(directory, f);
  const observer = createMainTabCheckpointMetadataStore(directory);
  try {
    const a = await f.open(f.paths[0]),
      b = await f.open(f.paths[1]);
    const viewport = { from: 2, offset: 4, ratio: 0.25 };
    expect(
      await first.write(
        { tabs: [{ ...a.tab, viewport }], activeIndex: 0 },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(
      (await next.write({ tabs: [a.tab], activeIndex: 0 }, () => true)).status
    ).toBe("rejected");
    expect(
      (
        await next.write(
          { tabs: [{ ...a.tab, resetViewport: true }], activeIndex: 0 },
          () => true
        )
      ).status
    ).toBe("rejected");
    const receipt = await observer.readObserved();
    expect(await next.claim(receipt, () => true, [a.tab])).toBe(true);
    expect(
      await next.write(
        { tabs: [{ ...a.tab, pinned: true }], activeIndex: 0 },
        () => true
      )
    ).toEqual({ status: "committed" });
    const restored = await next.read();
    if (restored.status !== "valid") throw Error("No checkpoint");
    expect(restored.positioned?.tabs[0].position).toEqual(viewport);
    const fresh = createGuardedMainTabCheckpoint(directory, f);
    try {
      expect(
        await fresh.write({ tabs: [b.tab], activeIndex: 0 }, () => true)
      ).toEqual({ status: "committed" });
      const other = await fresh.read();
      if (other.status !== "valid") throw Error("No replacement");
      expect(other.positioned?.tabs[0].position).toBeUndefined();
      expect(other.data.tabs[0].rootId).not.toBe(restored.data.tabs[0].rootId);
    } finally {
      await fresh.close();
    }
  } finally {
    await first.close();
    await next.close();
    await observer.close();
    await f.close();
  }
});

test("external position changes invalidate in-memory reuse; explicit close/reopen resets retained identities", async () => {
  const f = await fixture(),
    directory = join(f.dir, "metadata");
  const writer = createGuardedMainTabCheckpoint(directory, f);
  try {
    const a = await f.open(f.paths[0]);
    const viewport = { from: 1, offset: 2, ratio: 0.4 };
    expect(
      await writer.write(
        { tabs: [{ ...a.tab, viewport }], activeIndex: 0 },
        () => true
      )
    ).toEqual({ status: "committed" });
    const path = join(directory, "main-tab-session-checkpoint.json");
    const changed = JSON.parse(await readFile(path, "utf8")) as {
      data: { tabs: { position: { ratio: number } }[] };
    };
    changed.data.tabs[0].position.ratio = 0.8;
    const bytes = JSON.stringify(changed);
    await writeFile(path, bytes);
    expect(
      (await writer.write({ tabs: [a.tab], activeIndex: 0 }, () => true)).status
    ).toBe("rejected");
    expect(await readFile(path, "utf8")).toBe(bytes);
    // A fresh measurement is allowed to supersede the current exact observed bytes.
    expect(
      await writer.write(
        { tabs: [{ ...a.tab, viewport }], activeIndex: 0 },
        () => true
      )
    ).toEqual({ status: "committed" });
    // Retained Quick Open grants may keep these four identifiers across a close/reopen.
    expect(
      await writer.write(
        { tabs: [{ ...a.tab, resetViewport: true }], activeIndex: 0 },
        () => true
      )
    ).toEqual({ status: "committed" });
    const reset = await writer.read();
    if (reset.status !== "valid") throw Error("No checkpoint");
    expect(reset.positioned?.tabs[0].position).toBeUndefined();
  } finally {
    await writer.close();
    await f.close();
  }
});
