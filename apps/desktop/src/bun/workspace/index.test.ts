import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { openSync, closeSync, constants } from "node:fs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rename,
  rm,
  readFile,
  stat,
  realpath,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFolderWorkspace } from "../../client/workspace";
import { validContentSearchProgress, validContentSearchResponse, type ContentSearchProgress } from "../../shared/content-search";
import type {
  WorkspaceResponse,
  WorkspaceNode,
  WorkspaceRoot,
} from "../../shared/workspace";
import { createDocumentService } from "../documents";
import { checkWriteCapability } from "../documents/write-capability";
import { createContentSearchRPC } from "../rpc/content-search";

import { authorizeRoot } from "./authorization";
import { createHiddenPreferences } from "./preferences";
import { createScan } from "./scan";
import { createScanWorker } from "./worker";

import { createWorkspaceService } from ".";

let directory: string,
  selected: string | null,
  documents: ReturnType<typeof createDocumentService>,
  workspace: ReturnType<typeof createWorkspaceService>;
let serial = 0;
let revealed: string[] = [];
const request = (op: string, extra: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  requestId: `test-${++serial}`,
  op,
  ...extra,
});
const good = (response: WorkspaceResponse) => {
  if (!response.ok) throw Error(JSON.stringify(response));
  return response;
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "workspace-test-"));
  selected = directory;
  revealed = [];
  documents = createDocumentService({
    pickFile: () => Promise.resolve(selected),
    revealPath: (path) => {
      revealed.push(path);
    },
    openDefaultPath: (path) => {
      revealed.push(path);
      return true;
    },
  });
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
  });
});
afterEach(async () => {
  await workspace.dispose();
  await documents.dispose();
  await rm(directory, { recursive: true, force: true });
});
async function settle(): Promise<Extract<WorkspaceResponse, { ok: true }>> {
  for (let i = 0; i < 3000; i++) {
    const state = good(await workspace.request(request("state")));
    if (state.roots.every((root) => root.status !== "scanning")) return state;
    await Bun.sleep(2);
  }
  throw Error("scan did not settle");
}
async function nodes(root: WorkspaceRoot) {
  const result: WorkspaceNode[] = [];
  while (result.length < root.entries) {
    const page = good(
      await workspace.request(
        request("page", {
          root: root.handle,
          generation: root.generation,
          cursor: result.length,
        })
      )
    );
    result.push(...page.nodes!);
  }
  return result;
}
test("reveal root directory and unopened file uses retained authority without document grants", async () => {
  await mkdir(join(directory, "nested"));
  await writeFile(join(directory, "nested", "a.md"), "body");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const entries = await nodes(root);
  for (const entry of [undefined, ...entries.map((node) => node.handle)]) {
    const target = {
      type: "workspace",
      root: root.handle,
      generation: root.generation,
      ...(entry ? { entry } : {}),
    };
    expect(
      (
        await workspace.reveal({
          protocolVersion: 1,
          requestId: `reveal-${++serial}`,
          target,
        })
      ).ok
    ).toBe(true);
  }
  expect(revealed).toEqual([
    await realpath(directory),
    ...entries.map((node) => node.displayPath),
  ]);
  expect(documents.locations()).toEqual([]);
  expect(await readFile(join(directory, "nested", "a.md"), "utf8")).toBe(
    "body"
  );
  expect(
    (
      await workspace.reveal({
        protocolVersion: 1,
        requestId: "forged",
        target: {
          type: "workspace",
          root: root.handle,
          generation: root.generation,
          path: directory,
        },
      })
    ).ok
  ).toBe(false);
  expect(
    (
      await workspace.reveal({
        protocolVersion: 1,
        requestId: "stale",
        target: {
          type: "workspace",
          root: root.handle,
          generation: root.generation + 1,
        },
      })
    ).ok
  ).toBe(false);
});
test("reveal rejects replaced directory and revoked root without dispatch", async () => {
  await mkdir(join(directory, "nested"));
  await writeFile(join(directory, "nested", "a.md"), "body");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const node = (await nodes(root)).find((entry) => entry.kind === "directory")!;
  await rename(join(directory, "nested"), join(directory, "old"));
  await symlink(join(directory, "old"), join(directory, "nested"));
  expect(
    (
      await workspace.reveal({
        protocolVersion: 1,
        requestId: "replaced",
        target: {
          type: "workspace",
          root: root.handle,
          generation: root.generation,
          entry: node.handle,
        },
      })
    ).ok
  ).toBe(false);
  expect((await workspace.request(request("clear"))).ok).toBe(true);
  expect(
    (
      await workspace.reveal({
        protocolVersion: 1,
        requestId: "revoked",
        target: {
          type: "workspace",
          root: root.handle,
          generation: root.generation,
        },
      })
    ).ok
  ).toBe(false);
  expect(revealed).toEqual([]);
});
test("default workspace open only accepts files and never grants or opens documents", async () => {
  await mkdir(join(directory, "nested"));
  await writeFile(join(directory, "nested", "a.md"), "disk");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0],
    entries = await nodes(root);
  const directoryNode = entries.find((node) => node.kind === "directory")!;
  const file = entries.find((node) => node.kind === "file")!;
  const call = (target: unknown) =>
    workspace.openDefault({
      protocolVersion: 1,
      requestId: `default-${++serial}`,
      target,
    });
  const target = {
    type: "workspace",
    root: root.handle,
    generation: root.generation,
  };
  expect((await call(target)).ok).toBe(false);
  expect((await call({ ...target, entry: directoryNode.handle })).ok).toBe(
    false
  );
  expect(
    (await call({ ...target, entry: file.handle, path: file.displayPath })).ok
  ).toBe(false);
  expect(
    (
      await call({
        ...target,
        entry: file.handle,
        generation: root.generation + 1,
      })
    ).ok
  ).toBe(false);
  expect(revealed).toEqual([]);
  expect((await call({ ...target, entry: file.handle })).ok).toBe(true);
  expect(revealed).toEqual([file.displayPath]);
  expect(documents.locations()).toEqual([]);
  selected = file.displayPath;
  const opened = await documents.select({
    protocolVersion: 1,
    requestId: "standalone",
  });
  if (!opened.ok || !opened.snapshot) throw Error("fixture");
  expect(
    (await call({ type: "document", handle: opened.snapshot.handle })).ok
  ).toBe(true);
  expect(revealed).toEqual([file.displayPath, file.displayPath]);
  expect(await readFile(file.displayPath, "utf8")).toBe("disk");
});
for (const action of ["reveal", "openDefault"] as const)
  test(`${action} pending workspace cannot cross hidden rescan clear or disposal`, async () => {
    await writeFile(join(directory, "a.md"), "body");
    const broker =
      action === "reveal" ? "revealAuthorized" : "openDefaultAuthorized";
    const original = documents[broker].bind(documents);
    for (const mode of ["hidden", "rescan", "clear", "dispose"] as const) {
      await workspace.dispose();
      workspace = createWorkspaceService({
        pickDirectory: () => Promise.resolve(directory),
        documents,
      });
      await workspace.request(request("select"));
      const root = (await settle()).roots[0];
      const file = (await nodes(root)).find((node) => node.kind === "file")!;
      let entered!: () => void, resume!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      let closed = 0;
      documents[broker] = (envelope, authorize, current) =>
        original(
          envelope,
          async (check) => {
            const resource = await authorize(check);
            entered();
            await gate;
            return {
              path: resource.path,
              close: async () => {
                await resource.close();
                closed++;
              },
            };
          },
          current
        );
      const pending = workspace[action]({
        protocolVersion: 1,
        requestId: `pending-${mode}`,
        target: {
          type: "workspace",
          root: root.handle,
          generation: root.generation,
          entry: file.handle,
        },
      });
      await ready;
      try {
        if (mode === "dispose") await workspace.dispose();
        else
          expect(
            (
              await workspace.request(
                request(mode, {
                  ...(mode === "clear" ? {} : { root: root.handle }),
                  ...(mode === "hidden" ? { showHidden: true } : {}),
                })
              )
            ).ok
          ).toBe(true);
      } finally {
        resume();
      }
      expect((await pending).ok).toBe(false);
      expect(closed).toBe(1);
    }
    documents[broker] = original;
    expect(revealed).toEqual([]);
  });
test("automatic directory changes publish stable metadata without manual rescan and stop after dispose", async () => {
  await mkdir(join(directory, "empty"));
  await writeFile(join(directory, "keep.md"), "keep");
  await workspace.request(request("select"));
  const initial = (await settle()).roots[0];
  const original = (await nodes(initial)).find(
    (node) => node.name === "keep.md"
  )!;
  async function until(
    predicate: (root: WorkspaceRoot, entries: WorkspaceNode[]) => boolean
  ) {
    for (let i = 0; i < 180; i++) {
      const root = good(await workspace.request(request("state"))).roots[0];
      try {
        const entries = await nodes(root);
        if (predicate(root, entries)) return { root, entries };
      } catch {
        /* concurrent generation, retry current snapshot */
      }
      await Bun.sleep(30);
    }
    throw Error("automatic observation did not converge");
  }
  await until((root) => root.observation === "watching");
  await writeFile(join(directory, "empty/new.md"), "new");
  const added = await until(
    (root, entries) =>
      root.generation > initial.generation &&
      entries.some((node) => node.name === "new.md")
  );
  expect(added.entries.find((node) => node.name === "keep.md")?.handle).toBe(
    original.handle
  );
  await rm(join(directory, "empty/new.md"));
  const removed = await until(
    (_root, entries) => !entries.some((node) => node.name === "new.md")
  );
  await Bun.sleep(800);
  expect(
    good(await workspace.request(request("state"))).roots[0].generation
  ).toBe(removed.root.generation);
  await workspace.dispose();
  expect((await workspace.request(request("state"))).ok).toBe(false);
}, 15000);
test("existing client rescan runs the real candidate RPC and atomically retains unchanged handles", async () => {
  await writeFile(join(directory, "keep.md"), "keep");
  await writeFile(join(directory, "remove.md"), "remove");
  const client = createFolderWorkspace((value) => workspace.request(value));
  await client.select();
  await settle();
  await client.refresh();
  const root = client.getSnapshot().roots[0];
  const initial = client.getSnapshot().nodes[root.handle];
  const keep = initial.find((node) => node.name === "keep.md")!;
  await rm(join(directory, "remove.md"));
  await writeFile(join(directory, "new.md"), "new");
  const observed: string[][] = [];
  client.subscribe(() =>
    observed.push(
      client
        .getSnapshot()
        .nodes[root.handle].map((node) => node.name)
        .sort()
    )
  );
  await client.rescan(root.handle);
  const current = client.getSnapshot();
  expect(current.roots[0].generation).toBe(root.generation + 1);
  expect(
    current.nodes[root.handle].find((node) => node.name === "keep.md")!.handle
  ).toBe(keep.handle);
  expect(current.nodes[root.handle].map((node) => node.name).sort()).toEqual([
    "keep.md",
    "new.md",
  ]);
  expect(
    observed.every(
      (names) =>
        JSON.stringify(names) === '["keep.md","remove.md"]' ||
        JSON.stringify(names) === '["keep.md","new.md"]'
    )
  ).toBe(true);
  expect(current.error).toBeNull();
  client.dispose();
});

test("lost issued manual response expires only after fencing its candidate and allows other root observation", async () => {
  await workspace.dispose();
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
    manualLeaseMs: 20,
  });
  await mkdir(join(directory, "a"));
  await mkdir(join(directory, "b"));
  selected = join(directory, "a");
  await workspace.request(request("select"));
  selected = join(directory, "b");
  await workspace.request(request("select"));
  const roots = (await settle()).roots;
  const operation = good(
    await workspace.request(request("prepareRescan", { root: roots[0].handle }))
  ).operation!;
  // The client never receives/accepts the issued response in this scenario.
  await writeFile(join(directory, "b/new.md"), "new");
  let updated = false;
  for (let i = 0; i < 150; i++) {
    const root = good(await workspace.request(request("state"))).roots[1];
    if (root.entries === 1) {
      updated = true;
      break;
    }
    await Bun.sleep(30);
  }
  expect(updated).toBe(true);
  const stale = good(
    await workspace.request(request("acceptRescan", { operation }))
  );
  expect(stale.receipt?.status).toBe("rejected");
}, 10000);

test("strict rescan RPC issues before commit, queries without replay and validates opaque fields", async () => {
  await writeFile(join(directory, "a.md"), "a");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  await writeFile(join(directory, "b.md"), "b");
  const prepared = good(
    await workspace.request(request("prepareRescan", { root: root.handle }))
  );
  expect(prepared.operation).toBeDefined();
  expect((await settle()).roots[0].generation).toBe(root.generation);
  for (const extra of [
    { operation: { session: "path", sequence: 1 } },
    { operation: prepared.operation, root: root.handle },
    { operation: { ...prepared.operation, sequence: 1.5 } },
  ]) {
    expect(
      await workspace.request(request("acceptRescan", extra))
    ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
  }
  const accepted = good(
    await workspace.request(
      request("acceptRescan", { operation: prepared.operation })
    )
  );
  expect(accepted.receipt).toEqual({
    status: "committed",
    root: root.handle,
    generation: root.generation + 1,
  });
  const queried = good(
    await workspace.request(
      request("queryRescan", { operation: prepared.operation })
    )
  );
  expect(queried.receipt).toEqual(accepted.receipt);
  expect(
    good(
      await workspace.request(
        request("acceptRescan", { operation: prepared.operation })
      )
    ).receipt
  ).toEqual(accepted.receipt);
  expect((await settle()).roots[0].generation).toBe(root.generation + 1);
  expect(
    await workspace.request(
      request("prepareRescan", { root: root.handle, path: directory })
    )
  ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
});

test("manual issue budget failure releases its prepared candidate for another root", async () => {
  await workspace.dispose();
  await mkdir(join(directory, "a"));
  await mkdir(join(directory, "b"));
  const authorization = await authorizeRoot(join(directory, "a"));
  const summarySize = Buffer.byteLength(
    JSON.stringify({
      token: "0".repeat(36),
      root: "0".repeat(36),
      generation: 1,
      added: 0,
      removed: 0,
      replaced: 0,
      retainedHandles: [],
    })
  );
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
    cacheLimit:
      512 +
      Buffer.byteLength(JSON.stringify(authorization)) +
      2 * summarySize +
      256 +
      128,
  });
  selected = join(directory, "a");
  await workspace.request(request("select"));
  selected = join(directory, "b");
  await workspace.request(request("select"));
  const roots = (await settle()).roots;
  const failed = await workspace.request(
    request("prepareRescan", { root: roots[0].handle })
  );
  expect(failed).toMatchObject({ ok: false, error: "BUSY" });
  await Bun.sleep(10);
  const next = await workspace.reconciliation.prepare(roots[1].handle);
  expect(next.ok).toBe(true);
  if (next.ok) workspace.reconciliation.release(next.summary.token);
});

test("unconfirmed watcher shutdown terminates the Worker and reports restart instead of manual recovery", async () => {
  await workspace.dispose();
  const worker = createScanWorker();
  let stops = 0,
    closes = 0;
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
    worker: {
      call(message) {
        if (message.op === "watchClose") {
          closes++;
          return Promise.reject(Error("controlled close failure"));
        }
        if (message.op === "watchDispose")
          return Promise.reject(Error("controlled shutdown failure"));
        return worker.call(message);
      },
      dispose() {
        stops++;
        worker.dispose();
      },
    },
  });
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  for (let i = 0; i < 100; i++) {
    if (
      good(await workspace.request(request("state"))).roots[0].observation ===
      "watching"
    )
      break;
    await Bun.sleep(20);
  }
  expect(
    good(await workspace.request(request("state"))).roots[0].observation
  ).toBe("watching");
  await workspace.request(
    request("hidden", { root: root.handle, showHidden: true })
  );
  for (let i = 0; i < 150 && !stops; i++) await Bun.sleep(20);
  expect(stops).toBe(1);
  expect(closes).toBe(3);
  expect(
    good(await workspace.request(request("state"))).roots[0].observation
  ).toBe("unavailable");
  expect(
    await workspace.request(request("rescan", { root: root.handle }))
  ).toMatchObject({ ok: false, error: "UNAVAILABLE" });
}, 10000);

test("content search preparation checks the disk version and reuses only the matching live grant", async () => {
  const raw = "\ufeff# 标题\r\n🎯 target\r\n";
  const file = join(directory, "hit.md");
  await writeFile(file, raw);
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const entry = (await nodes(root))[0].handle;
  const expectedHash = createHash("sha256").update(raw).digest("hex");
  const input = { root: root.handle, generation: root.generation, entry, expectedHash };
  const prepare = (change: Partial<typeof input> = {}) =>
    workspace.prepareContentSearchDocument({ ...input, ...change }, crypto.randomUUID());
  expect(await prepare({ generation: root.generation + 1 })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ entry: crypto.randomUUID() })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ expectedHash: "0".repeat(64) })).toEqual({ ok: false, error: "STALE" });
  expect(documents.locations()).toEqual([]);
  const opened = await prepare();
  if (!opened.ok || opened.target.kind !== "open") throw Error(JSON.stringify(opened));
  expect(opened.target.snapshot).toMatchObject({ text: raw, hash: expectedHash });
  const { handle, documentId, revision, hash } = opened.target.snapshot;
  const binding = { handle, documentId, revision, hash };
  const reuse = (change: Partial<typeof binding> = {}) =>
    workspace.prepareContentSearchDocument(
      { ...input, binding: { ...binding, ...change } }, crypto.randomUUID()
    );
  expect(await prepare()).toEqual({ ok: false, error: "STALE" });
  expect(await reuse({ handle: crypto.randomUUID() })).toEqual({ ok: false, error: "STALE" });
  expect(await reuse({ revision: revision + 1 })).toEqual({ ok: false, error: "STALE" });
  expect(await reuse()).toEqual({ ok: true, target: { kind: "reuse", ...binding } });
  expect(documents.locations()).toMatchObject([{ handle, documentId }]);
  await writeFile(file, raw.replace("target", "change"));
  expect(await reuse()).toEqual({ ok: false, error: "STALE" });
  expect(documents.locations()).toMatchObject([{ handle, documentId }]);
});

test("content search preparation cannot publish a snapshot invalidated at the commit boundary", async () => {
  await workspace.dispose();
  const file = join(directory, "hit.md");
  const controller = new AbortController();
  let scenario: "disk" | "cancel" = "disk";
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents: {
      ...documents,
      openAuthorized(envelope, authorize, scope, proof) {
        if (!proof) throw Error("expected search proof");
        return documents.openAuthorized(envelope, authorize, scope, {
          ...proof,
          async verify(...args) {
            if (scenario === "disk") await writeFile(file, "moved!");
            await proof.verify(...args);
            if (scenario === "cancel") controller.abort();
          },
        });
      },
    },
  });
  await writeFile(file, "target");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const entry = (await nodes(root))[0].handle;
  const input = { root: root.handle, generation: root.generation, entry };
  const prepare = (raw: string) => workspace.prepareContentSearchDocument(
    { ...input, expectedHash: createHash("sha256").update(raw).digest("hex") },
    crypto.randomUUID(), controller.signal
  );
  expect(await prepare("target")).toEqual({ ok: false, error: "STALE" });
  expect(documents.locations()).toEqual([]);
  scenario = "cancel";
  expect(await prepare("moved!")).toEqual({ ok: false, error: "CANCELLED" });
  expect(documents.locations()).toEqual([]);
});

const searchHash = (text: string) => createHash("sha256").update(text).digest("hex");
const documentEnvelope = () => ({ protocolVersion: 1 as const, requestId: crypto.randomUUID() });

test("exact search location stays available above the root query coverage limit", async () => {
  const owner = join(directory, "owner");
  await mkdir(owner);
  const text = "\uFEFF# 标题\r\n🎯 target\r\n";
  const file = join(owner, "target.md");
  const oversized = join(owner, "large.md");
  const hiddenPath = join(owner, ".hidden.md");
  const largeText = "x".repeat(65_537);
  await writeFile(file, text);
  await writeFile(oversized, largeText);
  await writeFile(hiddenPath, "hidden target");
  await Promise.all(Array.from({ length: 31 }, (_, index) =>
    writeFile(join(owner, `other-${index}.md`), "unrelated")
  ));
  selected = owner;
  good(await workspace.request(request("select")));
  const root = (await settle()).roots[0];
  expect(root.status).toBe("complete");
  const entries = await nodes(root);
  expect(entries.filter((node) => node.kind === "file")).toHaveLength(33);
  const target = entries.find((node) => node.name === "target.md");
  const large = entries.find((node) => node.name === "large.md");
  if (!target || !large) throw Error("Missing exact search location fixture");
  const expectedHash = searchHash(text);
  const input = { root: root.handle, generation: root.generation, entry: target.handle, expectedHash };
  const roots = [{ handle: root.handle, generation: root.generation }];
  const limited = { root: root.handle, generation: root.generation, query: "target", handles: [], fragments: true as const };
  expect(await workspace.searchContentCandidates(limited)).toEqual({ ok: false, error: "LIMIT" });

  const oversizedPath = await realpath(oversized);
  documents.setTrashGuard((path) => path === oversizedPath);
  const narrowed = { ...limited, fileFilters: ["target.md"] };
  const from = text.indexOf("target");
  const to = from + "target".length;
  expect(await workspace.searchContentCandidates(narrowed)).toEqual({
    ok: true, mappings: [], coverage: [{
      entry: target.handle, hash: expectedHash, bytes: Buffer.byteLength(text),
      fragments: { matches: [{ from, to, before: text.slice(0, from), after: text.slice(to) }], more: false },
    }],
  });
  expect(await workspace.searchContentCandidates({
    ...limited, pathFilters: [{ kind: "path", value: "target.md" }, { kind: "-path", value: "large.md" }],
  })).toMatchObject({ ok: true, coverage: [{ entry: target.handle }] });
  const exactly32 = await workspace.searchContentCandidates({
    ...limited, pathFilters: [{ kind: "-path", value: "large.md" }],
  });
  if (!exactly32.ok) throw Error(JSON.stringify(exactly32));
  expect(exactly32.coverage).toHaveLength(32);
  expect(exactly32.coverage.some(({ entry }) => entry === large.handle)).toBe(false);
  expect(await workspace.searchContentCandidates({ ...limited, fileFilters: [".md"] }))
    .toEqual({ ok: false, error: "LIMIT" });
  expect(await workspace.searchContentCandidates({
    root: root.handle, generation: root.generation, query: "target", handles: [], fileFilters: ["target.md"],
  })).toEqual({ ok: false, error: "LIMIT" });
  expect(await workspace.searchContentCandidatesForWorkspace({
    roots, standaloneHandles: [], query: "target", handles: [], fragments: true,
  })).toEqual({ ok: false, error: "LIMIT" });
  const prepare = (change: Partial<typeof input> = {}) =>
    workspace.prepareContentSearchDocument({ ...input, ...change }, crypto.randomUUID());
  expect(await prepare({ generation: root.generation + 1 })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ entry: crypto.randomUUID() })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ expectedHash: searchHash("changed") })).toEqual({ ok: false, error: "STALE" });
  expect(documents.locations()).toEqual([]);
  const opened = await prepare();
  if (!opened.ok || opened.target.kind !== "open") throw Error(JSON.stringify(opened));
  const { handle, documentId, revision, hash, locationId } = opened.target.snapshot;
  const binding = { handle, documentId, revision, hash };
  expect(opened.target.snapshot).toMatchObject({ text, hash: expectedHash, explicitStandalone: false });
  expect(await workspace.prepareContentSearchDocument({ ...input, binding }, crypto.randomUUID()))
    .toEqual({ ok: true, target: { kind: "reuse", ...binding } });
  const anchored = { entry: handle, expectedHash, roots, rootEntry: target.handle };
  const reopen = (change: Partial<typeof anchored> = {}) =>
    workspace.prepareRetainedContentSearchDocument({ ...anchored, ...change }, crypto.randomUUID());
  expect(await reopen({ roots: [{ handle: root.handle, generation: root.generation + 1 }] }))
    .toEqual({ ok: false, error: "STALE" });
  expect(await reopen({ rootEntry: large.handle })).toEqual({ ok: false, error: "STALE" });
  expect(await reopen({ expectedHash: searchHash("changed") })).toEqual({ ok: false, error: "STALE" });
  expect(await reopen()).toMatchObject({ ok: true, target: { kind: "retained", snapshot: {
    ...binding, locationId, text, explicitStandalone: false,
  } } });
  expect(documents.locations()).toMatchObject([{ handle, documentId }]);

  documents.setTrashGuard(() => false);
  expect(await workspace.searchContentCandidates({ ...limited, fileFilters: ["large.md"] }))
    .toEqual({ ok: false, error: "LIMIT" });
  expect(await prepare({ entry: large.handle, expectedHash: searchHash(largeText) }))
    .toEqual({ ok: false, error: "LIMIT" });
  const outside = await pickSearchFile(oversized);
  expect(await workspace.searchContentCandidates({ ...narrowed, handles: [outside.handle] }))
    .toMatchObject({
      ok: true, coverage: [{ entry: target.handle }], mappings: [{ handle: outside.handle, kind: "outside" }],
    });
  expect(await workspace.prepareRetainedContentSearchDocument({
    entry: outside.handle, expectedHash: outside.hash, roots,
  }, crypto.randomUUID())).toEqual({ ok: false, error: "STALE" });
  expect(await documents.release({ ...documentEnvelope(), handle: outside.handle })).toMatchObject({ ok: true });

  const standalonePath = join(directory, "standalone.md");
  await writeFile(standalonePath, "independent");
  const standalone = await pickSearchFile(standalonePath);
  const leaf = { entry: standalone.handle, expectedHash: standalone.hash, roots };
  const prepareLeaf = (change: Partial<typeof leaf> = {}) =>
    workspace.prepareRetainedContentSearchDocument({ ...leaf, ...change }, crypto.randomUUID());
  const locations = documents.locations();
  documents.setTrashGuard((path) => path === oversizedPath);
  expect(await prepareLeaf()).toMatchObject({ ok: true, target: { kind: "retained", snapshot: {
    handle: standalone.handle, documentId: standalone.documentId, locationId: standalone.locationId,
    revision: standalone.revision, hash: standalone.hash, text: "independent", explicitStandalone: true,
  } } });
  const leafBinding = {
    handle: standalone.handle, documentId: standalone.documentId, revision: standalone.revision, hash: standalone.hash,
  };
  expect(await workspace.prepareRetainedContentSearchDocument({
    ...leaf, binding: leafBinding,
  }, crypto.randomUUID())).toEqual({ ok: true, target: { kind: "reuse", ...leafBinding } });
  expect(await prepareLeaf({ expectedHash: searchHash("wrong") })).toEqual({ ok: false, error: "STALE" });
  expect(documents.locations()).toEqual(locations);

  const sibling = join(directory, "sibling");
  await mkdir(sibling);
  await writeFile(join(sibling, "sibling.md"), "sibling");
  selected = sibling;
  good(await workspace.request(request("select")));
  const ordered = (await settle()).roots.map(({ handle, generation }) => ({ handle, generation }));
  expect(ordered).toHaveLength(2);
  expect(await prepareLeaf()).toEqual({ ok: false, error: "STALE" });
  expect(await prepareLeaf({ roots: [...ordered].reverse() })).toEqual({ ok: false, error: "STALE" });
  expect(await prepareLeaf({ roots: ordered })).toMatchObject({
    ok: true, target: { kind: "retained", snapshot: { handle: standalone.handle, hash: standalone.hash } },
  });
  await writeFile(standalonePath, "independenx");
  expect(await prepareLeaf({ roots: ordered })).toEqual({ ok: false, error: "STALE" });
  expect(documents.captureContentSearchBindings([standalone.handle])?.bindings[0]).toMatchObject(leafBinding);
  expect(await documents.release({ ...documentEnvelope(), handle: standalone.handle })).toMatchObject({ ok: true });

  await writeFile(file, text.replace("target", "change"));
  expect(await reopen()).toEqual({ ok: false, error: "STALE" });
  expect(await workspace.prepareContentSearchDocument({ ...input, binding }, crypto.randomUUID()))
    .toEqual({ ok: false, error: "STALE" });

  const hidden = await pickSearchFile(hiddenPath);
  const prepareHidden = (roots: typeof ordered) => workspace.prepareRetainedContentSearchDocument({
    entry: hidden.handle, expectedHash: hidden.hash, roots,
  }, crypto.randomUUID());
  const beforeVisibility = (await settle()).roots.map(({ handle, generation }) => ({ handle, generation }));
  expect(await prepareHidden(beforeVisibility)).toMatchObject({ ok: true, target: {
    kind: "retained", snapshot: { handle: hidden.handle, locationId: hidden.locationId, text: "hidden target" },
  } });
  good(await workspace.request(request("hidden", { root: root.handle, showHidden: true })));
  const visible = (await settle()).roots.map(({ handle, generation }) => ({ handle, generation }));
  expect(await prepareHidden(beforeVisibility)).toEqual({ ok: false, error: "STALE" });
  expect(await prepareHidden(visible)).toEqual({ ok: false, error: "STALE" });
  expect(await documents.release({ ...documentEnvelope(), handle: hidden.handle })).toMatchObject({ ok: true });
  expect(documents.locations()).toMatchObject([{ handle, documentId }]);
});

test("single filtered direct search counts published folders and files against its metadata bound", async () => {
  for (let index = 0; index < 128; index++) {
    const folder = join(directory, `folder-${index}`);
    await mkdir(folder);
    if (index >= 1 && index <= 3)
      await writeFile(join(folder, `budget-${index}.md`), index === 3 ? "x" : "x".repeat(65_536));
    else await writeFile(join(folder, "doc.md"), index === 0 ? "🎯 target" : "unrelated");
  }
  good(await workspace.request(request("select")));
  const root = (await settle()).roots[0];
  expect(root.status).toBe("complete");
  expect(root.entries).toBe(256);
  const target = (await nodes(root)).find(({ displayPath }) => displayPath.endsWith("/folder-0/doc.md"));
  if (!target) throw Error("Missing target in bounded metadata fixture");
  const narrowed = (generation: number) => workspace.searchContentCandidates({
    root: root.handle, generation, query: "target", handles: [],
    fragments: true, pathFilters: [{ kind: "path", value: "folder-0/" }],
  });
  expect(await narrowed(root.generation)).toMatchObject({
    ok: true, coverage: [{ entry: target.handle, fragments: { matches: [{ from: 3, to: 9 }] } }],
  });
  const byteBudget = {
    root: root.handle, generation: root.generation, query: "target", handles: [],
    fragments: true as const, fileFilters: ["budget-"],
  };
  const exactBytes = await workspace.searchContentCandidates({
    ...byteBudget, pathFilters: [{ kind: "-path", value: "folder-3/" }],
  });
  if (!exactBytes.ok) throw Error(JSON.stringify(exactBytes));
  expect(exactBytes.coverage.map(({ bytes }) => bytes)).toEqual([65_536, 65_536]);
  expect(await workspace.searchContentCandidates(byteBudget)).toEqual({ ok: false, error: "LIMIT" });
  await writeFile(join(directory, "new.md"), "unrelated");
  good(await workspace.request(request("rescan", { root: root.handle })));
  const next = (await settle()).roots[0];
  expect(next.entries).toBe(257);
  expect(await narrowed(root.generation)).toEqual({ ok: false, error: "STALE" });
  expect(await narrowed(next.generation)).toEqual({ ok: false, error: "LIMIT" });
});

test("single filtered direct search preserves narrow legacy scope in deeply nested trees", async () => {
  for (let branch = 0; branch < 16; branch++) {
    const folder = join(directory, `branch-${branch}`, ...Array<string>(16).fill("nested"));
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "doc.md"), branch === 0 ? "🎯 target" : "unrelated");
  }
  good(await workspace.request(request("select")));
  const root = (await settle()).roots[0];
  expect(root.status).toBe("complete");
  expect(root.entries).toBe(288);
  const entries = (await nodes(root)).filter(({ kind }) => kind === "file");
  expect(entries).toHaveLength(16);
  const target = entries.find(({ displayPath }) => displayPath.includes("/branch-0/"));
  if (!target) throw Error("Missing target in deep legacy fixture");
  expect(await workspace.searchContentCandidates({
    root: root.handle, generation: root.generation, query: "target", handles: [], fragments: true,
    pathFilters: [{ kind: "path", value: "branch-0/" }],
  })).toMatchObject({
    ok: true, coverage: [{ entry: target.handle, fragments: { matches: [{ from: 3, to: 9 }] } }],
  });
});

test("typed window search filters two large roots and a retained file within shared bounds", async () => {
  const firstPath = join(directory, "first");
  const secondPath = join(directory, "second");
  const firstNames = ["hit-a.md", "oversized.md", "skip-first.md",
    ...Array.from({ length: 14 }, (_, index) => `first-${index}.md`)];
  const secondNames = ["hit-b.md", "skip-second.md", ...Array.from({ length: 15 }, (_, index) => `second-${index}.md`)];
  const rootRaw = "😀 target root";
  const leafRaw = "\uFEFF😀target";
  async function seed(path: string, names: string[]) {
    const paths = new Map<string, string>();
    for (const [index, name] of names.entries()) {
      const depth = index < 8 ? 7 : 6;
      const folder = join(path, `branch-${index}`, ...Array<string>(depth - 1).fill("nested"));
      await mkdir(folder, { recursive: true });
      const file = join(folder, name);
      paths.set(name, file);
      await writeFile(file, name === "oversized.md" ? "x".repeat(65_537)
        : name.startsWith("hit-") ? rootRaw : "other");
    }
    return paths;
  }
  const firstPaths = await seed(firstPath, firstNames);
  await seed(secondPath, secondNames);
  const absorbedPath = firstPaths.get("hit-a.md");
  if (!absorbedPath) throw Error("Missing absorbed fixture file");
  const absorbed = await pickSearchFile(absorbedPath);
  const leafPath = join(directory, "hit-leaf.md");
  await writeFile(leafPath, leafRaw);
  const leaf = await pickSearchFile(leafPath);
  for (const path of [firstPath, secondPath]) {
    selected = path;
    good(await workspace.request(request("select")));
    await settle();
  }
  const scope = (await settle()).roots;
  expect(scope.map(({ entries }) => entries)).toEqual([127, 127]);
  const roots = scope.map(({ handle, generation }) => ({ handle, generation }));
  const a = (await nodes(scope[0])).find(({ name }) => name === "hit-a.md");
  const b = (await nodes(scope[1])).find(({ name }) => name === "hit-b.md");
  if (!a || !b) throw Error("Missing scanned root matches");
  const progress: ContentSearchProgress[] = [];
  const rpc = createContentSearchRPC(workspace, async handle =>
    (await documents.release({ ...documentEnvelope(), handle })).ok, event => progress.push(event));
  rpc.setReady(true);
  const base = {
    op: "query-workspace" as const, roots, standaloneHandles: [absorbed.handle, leaf.handle],
    handles: [], query: "target",
  };
  const stream = { ...base, fragments: true as const, stream: true as const };
  expect(await rpc.run({ ...documentEnvelope(), ...stream })).toMatchObject({ ok: false, error: "LIMIT" });
  expect(await rpc.run({ ...documentEnvelope(), ...base, fileFilters: ["hit-"] }))
    .toMatchObject({ ok: false, error: "LIMIT" });
  expect(progress).toEqual([]);

  const narrowed = { ...documentEnvelope(), ...stream, fileFilters: ["hit-"] };
  const result = await rpc.run(narrowed);
  expect(validContentSearchResponse(result, narrowed)).toBe(true);
  if (!result.ok || result.op !== "query-workspace") throw Error(JSON.stringify(result));
  expect(result.coverage.map(({ entry }) => entry)).toEqual([a.handle, b.handle, leaf.handle]);
  expect(result.coverage.map(({ hash }) => hash)).toEqual([searchHash(rootRaw), searchHash(rootRaw), searchHash(leafRaw)]);
  expect(result.coverage.map(({ fragments }) => fragments?.matches.map(({ from, to }) => ({ from, to }))))
    .toEqual([[{ from: 3, to: 9 }], [{ from: 3, to: 9 }], [{ from: 3, to: 9 }]]);
  expect(progress.map(({ sequence, entry }) => ({ sequence, entry }))).toEqual(
    [a.handle, b.handle, leaf.handle].map((entry, index) => ({ sequence: index + 1, entry }))
  );
  expect(progress.every((event) => validContentSearchProgress(event, narrowed))).toBe(true);
  expect(result.coverage.some(({ entry }) => entry === absorbed.handle)).toBe(false);
  expect(await rpc.prepare({
    ...documentEnvelope(), root: roots[1].handle, generation: roots[1].generation, entry: b.handle,
    expectedHash: searchHash(rootRaw),
  })).toMatchObject({ ok: true, target: { kind: "open", snapshot: { text: rootRaw } } });
  expect(await rpc.prepare({
    ...documentEnvelope(), op: "prepare-retained", roots, entry: leaf.handle, expectedHash: leaf.hash,
  })).toMatchObject({ ok: true, target: { kind: "retained", snapshot: {
    handle: leaf.handle, locationId: leaf.locationId, text: leafRaw,
  } } });

  const minusLarge = { kind: "-path" as const, value: "oversized.md" };
  const count = (skip: string) => workspace.searchContentCandidatesForWorkspace({
    ...base, fragments: true, pathFilters: [minusLarge, { kind: "-path", value: skip }],
  });
  const exactly32 = await count("skip-");
  if (!exactly32.ok) throw Error(JSON.stringify(exactly32));
  expect(exactly32.coverage).toHaveLength(32);
  expect(await count("skip-first.md")).toEqual({ ok: false, error: "LIMIT" });
  expect(await rpc.run({ ...narrowed, ...documentEnvelope(), roots: [...roots].reverse() }))
    .toMatchObject({ ok: false, error: "STALE" });
  expect(await rpc.run({
    ...narrowed, ...documentEnvelope(), roots: [roots[0], { ...roots[1], generation: roots[1].generation + 1 }],
  })).toMatchObject({ ok: false, error: "STALE" });
  const extraPath = join(directory, "extra.md");
  await writeFile(extraPath, "excluded");
  const extra = await pickSearchFile(extraPath);
  expect(await rpc.run({
    ...narrowed, ...documentEnvelope(), standaloneHandles: [...base.standaloneHandles, extra.handle],
  })).toMatchObject({ ok: false, error: "LIMIT" });
  expect(progress).toHaveLength(3);
  await rpc.drain();
});

async function pickSearchFile(file: string) {
  selected = file;
  const picked = await documents.select(documentEnvelope());
  if (!picked.ok || !picked.snapshot) throw Error("Expected a retained picker grant");
  return picked.snapshot;
}

test("retained search preparation reopens the same closed grant and reuses the exact open version", async () => {
  const file = join(directory, "standalone.md");
  const original = "\uFEFF# 标题\r\n🎯 target\r\n";
  const revised = "\uFEFF# 改写\r\n🎯 target\r\n";
  await writeFile(file, original);
  const initial = await pickSearchFile(file);
  const { handle, documentId, revision, hash, locationId } = initial;
  const active = { handle, documentId, revision, hash, watchEpoch: 1, watchToken: crypto.randomUUID() };
  expect(await documents.observe({ ...documentEnvelope(), ...active, active: true }))
    .toMatchObject({ ok: true });
  const prepare = (
    expectedHash: string,
    binding?: { handle: string; documentId: string; revision: number; hash: string },
  ) => workspace.prepareRetainedContentSearchDocument({
    roots: [], entry: handle, expectedHash, ...(binding ? { binding } : {}),
  }, crypto.randomUUID());
  const locations = documents.locations();
  const assets = documents.assetEpochs();
  const baseline = () => documents.captureContentSearchBindings([handle])?.bindings[0];
  expect(await prepare(hash)).toEqual({ ok: false, error: "BUSY" });
  const version = { handle, documentId, revision, hash };
  expect(await prepare(hash, { ...version, revision: revision + 1 })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare(hash, version)).toEqual({ ok: true, target: { kind: "reuse", ...version } });
  expect(baseline()).toMatchObject(version);
  expect(await documents.observe({ ...documentEnvelope(), ...active, active: false }))
    .toMatchObject({ ok: true });

  const same = await prepare(hash);
  if (!same.ok || !("snapshot" in same.target)) throw Error(JSON.stringify(same));
  expect(same.target).toMatchObject({
    kind: "retained",
    snapshot: { ...version, locationId, text: original, explicitStandalone: true },
  });
  await writeFile(file, revised);
  expect(await prepare(hash)).toEqual({ ok: false, error: "STALE" });
  expect(baseline()).toMatchObject(version);
  const query = await workspace.searchContentCandidatesForWorkspace({
    roots: [], standaloneHandles: [handle], handles: [], query: "target",
  });
  const coverage = query.ok ? query.coverage[0] : undefined;
  if (coverage?.entry !== handle) throw Error("Expected the current retained search hit");
  expect(coverage.hash).toBe(searchHash(revised));
  const updated = await prepare(coverage.hash);
  if (!updated.ok || !("snapshot" in updated.target)) throw Error(JSON.stringify(updated));
  expect(updated.target).toMatchObject({
    kind: "retained",
    snapshot: { handle, documentId, locationId, revision: revision + 1, hash: searchHash(revised), text: revised },
  });
  expect(updated.target.snapshot.mirror).toMatchObject({ revision: 0, hash: searchHash(revised) });
  expect(updated.target.snapshot.mirror?.token).not.toBe(initial.mirror?.token);
  expect(baseline()).toMatchObject({ handle, documentId, revision: revision + 1, hash: searchHash(revised) });
  expect(documents.locations()).toEqual(locations);
  expect(documents.assetEpochs()).toEqual(assets);
  expect(await readFile(file, "utf8")).toBe(revised);
});

test("retained preparation rejects duplicates and requires a verified anchor for an absorbed file", async () => {
  const owner = join(directory, "owner");
  const unrelated = join(directory, "unrelated");
  await mkdir(owner);
  await mkdir(unrelated);
  const originalPath = join(owner, "original.md");
  const aliasPath = join(owner, "alias.md");
  const hiddenPath = join(owner, ".hidden.md");
  await writeFile(originalPath, "target");
  await symlink(originalPath, aliasPath);
  await writeFile(hiddenPath, "hidden target");
  const original = await pickSearchFile(originalPath);
  const alternate = await pickSearchFile(aliasPath);
  const hidden = await pickSearchFile(hiddenPath);
  expect(alternate.handle).not.toBe(original.handle);
  expect(alternate.documentId).toBe(original.documentId);
  const input = { roots: [], entry: original.handle, expectedHash: original.hash };
  const alternateBinding = {
    handle: alternate.handle, documentId: alternate.documentId, revision: alternate.revision, hash: alternate.hash,
  };
  const prepare = (data: Parameters<typeof workspace.prepareRetainedContentSearchDocument>[0] = input) =>
    workspace.prepareRetainedContentSearchDocument(data, crypto.randomUUID());
  expect(await prepare({ ...input, binding: alternateBinding })).toEqual({ ok: false, error: "INVALID" });
  expect(await prepare()).toEqual({ ok: false, error: "STALE" });
  expect(await documents.release({ ...documentEnvelope(), handle: alternate.handle })).toMatchObject({ ok: true });
  expect(await prepare()).toMatchObject({ ok: true, target: { kind: "retained", snapshot: { handle: original.handle } } });

  selected = owner;
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const roots = [{ handle: root.handle, generation: root.generation }];
  expect(await prepare()).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ ...input, roots })).toEqual({ ok: false, error: "STALE" });
  const coverage = await workspace.searchContentCandidatesForWorkspace({
    roots, standaloneHandles: [original.handle], handles: [], query: "target",
  });
  const rootEntry = coverage.ok && coverage.coverage[0]?.entry;
  if (!rootEntry || rootEntry === original.handle) throw Error("Expected absorbed root entry");
  const anchored = { ...input, roots, rootEntry };
  expect(await prepare({ ...anchored, roots: [] })).toEqual({ ok: false, error: "INVALID" });
  expect(await prepare({ ...anchored, rootEntry: crypto.randomUUID() })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ ...anchored, entry: hidden.handle, expectedHash: hidden.hash }))
    .toEqual({ ok: false, error: "STALE" });
  selected = unrelated;
  await workspace.request(request("select"));
  const workspaceRoots = (await settle()).roots.map(({ handle, generation }) => ({ handle, generation }));
  expect(workspaceRoots).toHaveLength(2);
  expect(await prepare({ ...anchored, roots: workspaceRoots })).toEqual({ ok: false, error: "INVALID" });
  expect(await prepare(anchored)).toMatchObject({
    ok: true, target: { kind: "retained", snapshot: {
      handle: original.handle, documentId: original.documentId, locationId: original.locationId, text: "target",
    } },
  });
  expect(await prepare({ roots: workspaceRoots, entry: hidden.handle, expectedHash: hidden.hash }))
    .toMatchObject({ ok: true, target: { kind: "retained", snapshot: { handle: hidden.handle, text: "hidden target" } } });
  expect(documents.locations().map(({ handle }) => handle)).toEqual([original.handle, hidden.handle]);
});

test("anchored search preparation reopens only its exact closed directory grant", async () => {
  await workspace.dispose();
  await documents.dispose();
  const pause = { entered: Promise.withResolvers<void>(), resume: Promise.withResolvers<void>() };
  let pauseCapability = false;
  documents = createDocumentService({
    pickFile: () => Promise.resolve(selected),
    async capability(grant) {
      const result = await checkWriteCapability(grant);
      if (pauseCapability) {
        pauseCapability = false;
        pause.entered.resolve();
        await pause.resume.promise;
      }
      return result;
    },
  });
  workspace = createWorkspaceService({ documents, pickDirectory: () => Promise.resolve(selected) });
  const owner = join(directory, "owner");
  const unrelated = join(directory, "unrelated");
  await mkdir(owner);
  await mkdir(unrelated);
  const text = "\uFEFF# 标题\r\n🎯 target\r\n";
  const file = join(owner, "hit.md");
  await writeFile(file, text);
  await writeFile(join(owner, "other.md"), "other");
  await writeFile(join(unrelated, "hit.md"), text);
  selected = owner;
  good(await workspace.request(request("select")));
  await settle();
  selected = unrelated;
  good(await workspace.request(request("select")));
  const [root, otherRoot] = (await settle()).roots;
  const entries = await nodes(root);
  const rootEntry = entries.find((node) => node.name === "hit.md")!.handle;
  const otherEntry = entries.find((node) => node.name === "other.md")!.handle;
  const roots = [{ handle: root.handle, generation: root.generation }];
  const expectedHash = searchHash(text);
  const opened = await workspace.prepareContentSearchDocument({
    root: root.handle, generation: root.generation, entry: rootEntry, expectedHash,
  }, crypto.randomUUID());
  if (!opened.ok || opened.target.kind !== "open") throw Error(JSON.stringify(opened));
  const { handle, documentId, revision, hash, locationId } = opened.target.snapshot;
  expect(opened.target.snapshot.explicitStandalone).toBe(false);
  const input = { entry: handle, expectedHash, roots, rootEntry };
  const prepare = (change: Partial<typeof input> = {}, signal?: AbortSignal) =>
    workspace.prepareRetainedContentSearchDocument({ ...input, ...change }, crypto.randomUUID(), signal);
  const locations = documents.locations();
  const baseline = () => documents.captureContentSearchBindings([handle])?.bindings[0];
  expect(baseline()?.readStandalone).toBeUndefined();
  expect(baseline()?.verifyStandalone).toBeUndefined();
  const active = { handle, documentId, revision, hash, watchEpoch: 1, watchToken: crypto.randomUUID() };
  expect(await documents.observe({ ...documentEnvelope(), ...active, active: true }))
    .toMatchObject({ ok: true });
  expect(await prepare()).toEqual({ ok: false, error: "BUSY" });
  expect(await documents.observe({ ...documentEnvelope(), ...active, active: false }))
    .toMatchObject({ ok: true });

  const allRoots = [root, otherRoot].map(({ handle, generation }) => ({ handle, generation }));
  expect(await workspace.prepareRetainedContentSearchDocument({
    entry: handle, expectedHash, roots: allRoots,
  }, crypto.randomUUID())).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ rootEntry: otherEntry })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({
    roots: [allRoots[1]], rootEntry: (await nodes(otherRoot))[0].handle,
  })).toEqual({ ok: false, error: "STALE" });
  expect(await prepare({ expectedHash: "0".repeat(64) })).toEqual({ ok: false, error: "STALE" });
  const cancellation = new AbortController();
  const pending = prepare({}, cancellation.signal);
  cancellation.abort();
  expect(await pending).toEqual({ ok: false, error: "CANCELLED" });
  documents.setTrashGuard(() => true);
  expect(await prepare()).toEqual({ ok: false, error: "BUSY" });
  documents.setTrashGuard(() => false);
  expect(baseline()).toMatchObject({ handle, documentId, revision, hash });
  expect(documents.locations()).toEqual(locations);
  const reopened = await prepare();
  expect(reopened).toMatchObject({ ok: true, target: { kind: "retained", snapshot: {
    handle, documentId, locationId, revision, hash, text, explicitStandalone: false,
  } } });
  pauseCapability = true;
  const stale = prepare();
  try {
    await Promise.race([pause.entered.promise, stale.then((result) => {
      throw Error("Expected scoped capability check before completion: " + JSON.stringify(result));
    })]);
    good(await workspace.request(request("hidden", { root: root.handle, showHidden: true })));
  } finally {
    pause.resume.resolve();
  }
  expect(await stale).toEqual({ ok: false, error: "STALE" });
  expect(baseline()).toMatchObject({ handle, documentId, revision, hash });
  expect(documents.locations()).toEqual(locations);
  expect(await readFile(file, "utf8")).toBe(text);
});

test("retained preparation refuses late disk, cancellation and Trash changes without adopting the new baseline", async () => {
  await workspace.dispose();
  await documents.dispose();
  const file = join(directory, "guarded.md");
  const original = "target before";
  const revised = "target after";
  function capabilityGate() {
    return { entered: Promise.withResolvers<void>(), resume: Promise.withResolvers<void>() };
  }
  let gate: ReturnType<typeof capabilityGate> | undefined;
  documents = createDocumentService({
    pickFile: () => Promise.resolve(selected),
    async capability(grant) {
      const result = await checkWriteCapability(grant);
      const state = gate;
      if (state) {
        gate = undefined;
        state.entered.resolve();
        await state.resume.promise;
      }
      return result;
    },
  });
  workspace = createWorkspaceService({ documents, pickDirectory: () => Promise.resolve(null) });
  await writeFile(file, original);
  const initial = await pickSearchFile(file);
  const { handle, documentId, revision, hash, locationId } = initial;
  const otherFile = join(directory, "other.md");
  await writeFile(otherFile, "another document");
  const other = await pickSearchFile(otherFile);
  const locations = documents.locations();
  const prepare = (text: string, signal?: AbortSignal) => workspace.prepareRetainedContentSearchDocument({
    roots: [], entry: handle, expectedHash: searchHash(text),
  }, crypto.randomUUID(), signal);
  async function rejectLate(
    text: string, invalidate: () => void | Promise<void>, code: "CANCELLED" | "BUSY" | "STALE",
    signal?: AbortSignal,
  ) {
    const state = capabilityGate();
    gate = state;
    const pending = prepare(text, signal);
    try {
      await Promise.race([state.entered.promise, pending.then((result) => {
        throw Error("Expected retained capability check before completion: " + JSON.stringify(result));
      })]);
      await invalidate();
    } finally {
      gate = undefined;
      state.resume.resolve();
    }
    expect(await pending).toEqual({ ok: false, error: code });
    expect(documents.locations()).toEqual(locations);
    expect(documents.captureContentSearchBindings([handle])?.bindings[0])
      .toMatchObject({ handle, documentId, revision, hash });
  }

  await rejectLate(original, () => writeFile(file, revised), "STALE");
  const cancel = new AbortController();
  await rejectLate(revised, () => { cancel.abort(); }, "CANCELLED", cancel.signal);
  const canonical = await realpath(file);
  await rejectLate(revised, () => {
    documents.setTrashGuard((path) => path === canonical);
  }, "BUSY");
  documents.setTrashGuard(() => false);

  const state = capabilityGate();
  gate = state;
  const superseded = prepare(revised);
  let queued: ReturnType<typeof documents.read> | undefined;
  try {
    await Promise.race([state.entered.promise, superseded.then(() => { throw Error("Expected held preparation"); })]);
    queued = documents.read({ ...documentEnvelope(), handle: other.handle });
    expect(await Promise.race([
      superseded.then(() => true),
      Bun.sleep(50).then(() => false),
    ])).toBe(false);
  } finally {
    gate = undefined;
    state.resume.resolve();
  }
  expect(await superseded).toEqual({ ok: false, error: "CANCELLED" });
  expect(await queued).toMatchObject({ ok: true, snapshot: { handle: other.handle } });
  expect(documents.captureContentSearchBindings([handle])?.bindings[0])
    .toMatchObject({ handle, documentId, revision, hash });

  expect(await prepare(revised)).toMatchObject({
    ok: true,
    target: { kind: "retained", snapshot: { handle, documentId, locationId, revision: revision + 1, text: revised } },
  });

  const oversized = "x".repeat(65_537);
  await writeFile(file, oversized);
  expect(await prepare(oversized)).toEqual({ ok: false, error: "LIMIT" });
  await rename(file, join(directory, "old.md"));
  await writeFile(file, "replaced target");
  expect(await prepare("replaced target")).toEqual({ ok: false, error: "STALE" });
  expect(documents.locations()).toEqual(locations);
  expect(documents.captureContentSearchBindings([handle])?.bindings[0])
    .toMatchObject({ handle, documentId, revision: revision + 1, hash: searchHash(revised) });
  expect(await documents.release({ ...documentEnvelope(), handle })).toMatchObject({ ok: true });
  expect(await prepare("replaced target")).toEqual({ ok: false, error: "STALE" });
  expect(documents.locations().map(({ handle }) => handle)).toEqual([other.handle]);
});

test("content search reuse respects a Trash receipt left quarantined after its lease", async () => {
  await workspace.dispose();
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
    trashRun: () => Promise.resolve({ status: "unknown", platformSucceeded: false }),
  });
  await writeFile(join(directory, "hit.md"), "target");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const target = { kind: "root", root: root.handle, generation: root.generation, entry: (await nodes(root))[0].handle };
  const opened = await workspace.open({
    protocolVersion: 1, requestId: crypto.randomUUID(), root: target.root, entry: target.entry,
  });
  if (!opened.ok || !opened.snapshot) throw Error(JSON.stringify(opened));
  const { handle, documentId, revision, hash } = opened.snapshot;
  const { root: rootHandle, generation, entry } = target;
  const reuse = () => workspace.prepareContentSearchDocument(
    { root: rootHandle, generation, entry, expectedHash: hash, binding: { handle, documentId, revision, hash } },
    crypto.randomUUID()
  );
  expect((await reuse()).ok).toBe(true);
  const state = await workspace.trashDocument(request("state", { requestId: crypto.randomUUID() }));
  if (state.status !== "state") throw Error(JSON.stringify(state));
  const ticket = { session: state.session, sequence: state.sequence };
  const prepared = await workspace.trashDocument(request("prepare", {
    requestId: crypto.randomUUID(), ...ticket, target,
  }));
  if (prepared.status !== "prepared") throw Error(JSON.stringify(prepared));
  const receipt = await workspace.trashDocument(request("commit", {
    requestId: crypto.randomUUID(), ...ticket, confirmationToken: prepared.confirmationToken,
  }));
  expect(receipt.status).toBe("unknown");
  expect(await reuse()).toEqual({ ok: false, error: "BUSY" });
  expect(documents.locations()).toMatchObject([{ handle, documentId }]);
});

test("a late search grant waits through an unrelated save and write barrier before release", async () => {
  await workspace.dispose();
  await documents.dispose();
  const writing = Promise.withResolvers<void>();
  const writeResult = Promise.withResolvers<{ ok: false; error: "SAVE_FAILED" }>();
  const barrierEntered = Promise.withResolvers<void>();
  const barrierResume = Promise.withResolvers<boolean>();
  documents = createDocumentService({
    pickFile: () => Promise.resolve(selected),
    write: () => {
      writing.resolve();
      return writeResult.promise;
    },
  });
  workspace = createWorkspaceService({ documents, pickDirectory: () => Promise.resolve(directory) });
  await writeFile(join(directory, "hit.md"), "hit");
  await writeFile(join(directory, "other.md"), "other");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const entries = await nodes(root);
  const hit = entries.find((node) => node.name === "hit.md")!;
  const other = entries.find((node) => node.name === "other.md")!;
  const regular = await workspace.open({
    protocolVersion: 1, requestId: crypto.randomUUID(), root: root.handle, entry: other.handle,
  });
  const prepared = await workspace.prepareContentSearchDocument(
    { root: root.handle, generation: root.generation, entry: hit.handle, expectedHash: createHash("sha256").update("hit").digest("hex") },
    crypto.randomUUID()
  );
  if (!regular.ok || !regular.snapshot || !prepared.ok || prepared.target.kind !== "open")
    throw Error("Expected both grants");
  const { handle, documentId, hash, revision, mirror, text } = regular.snapshot;
  const searchHandle = prepared.target.snapshot.handle;
  const release = (handle: string) => documents.release({ protocolVersion: 1, requestId: crypto.randomUUID(), handle });
  const saving = documents.save({
    protocolVersion: 1, requestId: crypto.randomUUID(), handle, documentId, mirror,
    expectedHash: hash, expectedRevision: revision, bufferRevision: 1,
    content: {
      kind: "patch", from: 0, to: text.length, insert: "edited",
      targetHash: createHash("sha256").update("edited").digest("hex"),
    },
  });
  try {
    await Promise.race([writing.promise, saving.then(() => { throw Error("Save ended before reaching writer"); })]);
    let released = false;
    const pending = release(searchHandle).then((value) => { released = true; return value; });
    expect(await release(handle)).toMatchObject({ ok: false, error: "BUSY" });
    expect(released).toBe(false);
    const barrier = documents.withWriteBarrier(() => {
      barrierEntered.resolve();
      return barrierResume.promise;
    });
    writeResult.resolve({ ok: false, error: "SAVE_FAILED" });
    expect(await saving).toMatchObject({ ok: false, error: "SAVE_FAILED" });
    await barrierEntered.promise;
    expect(released).toBe(false);
    expect(documents.locations()).toHaveLength(2);
    barrierResume.resolve(true);
    expect(await barrier).toBe(true);
    expect(await pending).toMatchObject({ ok: true });
    expect(documents.locations()).toMatchObject([{ handle, documentId }]);
  } finally {
    writeResult.resolve({ ok: false, error: "SAVE_FAILED" });
    barrierResume.resolve(true);
  }
});

test("root-local open barrier includes committed document late receipt and always releases on throw", async () => {
  await workspace.dispose();
  await mkdir(join(directory, "one"));
  await mkdir(join(directory, "two"));
  selected = join(directory, "one");
  let entered = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>();
  let throwing = false;
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents: {
      ...documents,
      async openAuthorized(...args) {
        const result = throwing
          ? undefined
          : await documents.openAuthorized(...args);
        entered.resolve();
        await resume.promise;
        if (throwing) throw Error("controlled open failure");
        return result!;
      },
    },
  });
  await writeFile(join(directory, "one/a.md"), "a");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0],
    entry = (await nodes(root))[0];
  selected = join(directory, "two");
  await workspace.request(request("select"));
  const other = (await settle()).roots.find(
    (item) => item.handle !== root.handle
  )!;
  for (const fail of [false, true]) {
    throwing = fail;
    entered = Promise.withResolvers<void>();
    resume = Promise.withResolvers<void>();
    const opening = workspace.open({
      protocolVersion: 1,
      requestId: `blocked-${fail}`,
      root: root.handle,
      entry: entry.handle,
    });
    // Attach rejection before releasing the controlled operation.
    const outcome = opening.then(
      (value) => value,
      (error) => error as Error
    );
    await entered.promise;
    const candidate = await workspace.reconciliation.prepare(root.handle);
    if (!candidate.ok) throw Error(candidate.reason);
    expect(
      await workspace.reconciliation.accept(
        workspace.reconciliation.issue(candidate.summary.token)!
      )
    ).toEqual({ status: "rejected", reason: "BUSY" });
    expect((await settle()).roots[0].generation).toBe(root.generation);
    const otherCandidate = await workspace.reconciliation.prepare(other.handle);
    if (!otherCandidate.ok) throw Error(otherCandidate.reason);
    expect(
      await workspace.reconciliation.accept(
        workspace.reconciliation.issue(otherCandidate.summary.token)!
      )
    ).toMatchObject({ status: "committed" });
    resume.resolve();
    const result = await outcome;
    if (fail) expect(result).toBeInstanceOf(Error);
    else expect(result).toMatchObject({ ok: true });
  }
  const candidate = await workspace.reconciliation.prepare(root.handle);
  if (!candidate.ok) throw Error(candidate.reason);
  expect(
    await workspace.reconciliation.accept(
      workspace.reconciliation.issue(candidate.summary.token)!
    )
  ).toMatchObject({ status: "committed" });
});

test("internal acceptance publishes stable identities once without changing opened scopes or assets", async () => {
  await writeFile(join(directory, "keep.md"), "# keep");
  await writeFile(join(directory, "gone.md"), "# gone");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const original = await nodes(root);
  const keep = original.find((n) => n.name === "keep.md")!;
  const opened = await workspace.open({
    protocolVersion: 1,
    requestId: "accept-open",
    root: root.handle,
    entry: keep.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error("open");
  const locations = documents.locations(),
    assets = documents.assetEpochs();
  await rm(join(directory, "gone.md"));
  await writeFile(join(directory, "new.md"), "# new");
  const candidate = await workspace.reconciliation.prepare(root.handle);
  if (!candidate.ok) throw Error(candidate.reason);
  const op = workspace.reconciliation.issue(candidate.summary.token)!;
  expect(await workspace.reconciliation.accept(op)).toEqual({
    status: "committed",
    root: root.handle,
    generation: root.generation + 1,
  });
  expect(documents.locations()).toEqual(locations);
  expect(documents.assetEpochs()).toEqual(assets);
  const current = (await settle()).roots[0];
  const entries = await nodes(current);
  expect(entries.find((n) => n.name === "keep.md")!.handle).toBe(keep.handle);
  expect(entries.map((n) => n.name).sort()).toEqual(["keep.md", "new.md"]);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "after-accept",
      handle: opened.snapshot.handle,
    })
  ).toMatchObject({
    ok: true,
    snapshot: { documentId: opened.snapshot.documentId, text: "# keep" },
  });
  await workspace.request(request("rescan", { root: root.handle }));
  const after = (await settle()).roots[0];
  expect(await workspace.reconciliation.accept(op)).toMatchObject({
    status: "committed",
    generation: current.generation,
  });
  expect((await settle()).roots[0].generation).toBe(after.generation);
});

test("internal acceptance refuses changed inventory and accepts a complete empty candidate", async () => {
  await writeFile(join(directory, "a.md"), "a");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const first = await workspace.reconciliation.prepare(root.handle);
  if (!first.ok) throw Error(first.reason);
  await writeFile(join(directory, "b.md"), "b");
  expect(
    await workspace.reconciliation.accept(
      workspace.reconciliation.issue(first.summary.token)!
    )
  ).toMatchObject({ status: "rejected" });
  expect((await settle()).roots[0].generation).toBe(root.generation);
  await rm(join(directory, "a.md"));
  await rm(join(directory, "b.md"));
  let empty = await workspace.reconciliation.prepare(root.handle);
  for (let i = 0; !empty.ok && empty.reason === "BUSY" && i < 100; i++) {
    await Bun.sleep(2);
    empty = await workspace.reconciliation.prepare(root.handle);
  }
  if (!empty.ok) throw Error(empty.reason);
  expect(
    await workspace.reconciliation.accept(
      workspace.reconciliation.issue(empty.summary.token)!
    )
  ).toMatchObject({ status: "committed" });
  const current = (await settle()).roots[0];
  expect(current.entries).toBe(0);
  expect(current.generation).toBe(root.generation + 1);
});

test("trusted reconciliation scans real changes without publishing tree or document state", async () => {
  await mkdir(join(directory, "nested"));
  await writeFile(join(directory, "nested/keep.md"), "# keep");
  await writeFile(join(directory, "gone.md"), "# gone");
  await writeFile(join(directory, "replace.md"), "# before");
  await workspace.request(request("select"));
  const before = await settle(),
    root = before.roots[0],
    original = await nodes(root);
  const keep = original.find((node) => node.name === "keep.md")!;
  const opened = await workspace.open({
    protocolVersion: 1,
    requestId: "candidate-open",
    root: root.handle,
    entry: keep.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error("open");
  const locations = documents.locations();
  const assets = documents.assetEpochs();
  await rm(join(directory, "gone.md"));
  await rename(join(directory, "replace.md"), join(directory, "replace.bak"));
  await writeFile(join(directory, "replace.md"), "# after");
  await writeFile(join(directory, "new.md"), "# new");
  const result = await workspace.reconciliation.prepare(root.handle);
  if (!result.ok) throw Error(result.reason);
  expect(result.summary).toMatchObject({ added: 1, removed: 1, replaced: 1 });
  expect(result.summary.retainedHandles.sort()).toEqual(
    original
      .filter((node) => node.name === "keep.md" || node.name === "nested")
      .map((node) => node.handle)
      .sort()
  );
  expect((await settle()).roots).toEqual(before.roots);
  expect(await nodes(root)).toEqual(original);
  expect(documents.locations()).toEqual(locations);
  expect(documents.assetEpochs()).toEqual(assets);
  // Existing explicit rescan retains its old semantics and invalidates the candidate.
  await workspace.request(request("rescan", { root: root.handle }));
  expect(workspace.reconciliation.get(result.summary.token)).toBeUndefined();
  const current = await settle();
  expect(current.roots[0].generation).toBe(root.generation + 1);
});

test("trusted candidates reject initial scans and preserve multi-page baseline and identity chain", async () => {
  await mkdir(join(directory, "nested"));
  for (let i = 0; i < 135; i++)
    await writeFile(join(directory, `nested/file-${i}.md`), "body");
  const selectedState = good(await workspace.request(request("select")));
  expect(
    await workspace.reconciliation.prepare(selectedState.roots[0].handle)
  ).toEqual({ ok: false, reason: "NOT_READY" });
  const before = await settle(),
    root = before.roots[0],
    original = await nodes(root);
  const result = await workspace.reconciliation.prepare(root.handle);
  if (!result.ok) throw Error(result.reason);
  expect(result.summary.retainedHandles).toHaveLength(136);
  expect(await nodes(root)).toEqual(original);
  expect(
    await workspace.reconciliation.accept(
      workspace.reconciliation.issue(result.summary.token)!
    )
  ).toMatchObject({ status: "committed" });
  const acceptedRoot = (await settle()).roots[0];
  const acceptedNodes = await nodes(acceptedRoot);
  expect(acceptedNodes).toEqual(original);
  const directoryNode = acceptedNodes.find(
    (node) => node.kind === "directory"
  )!;
  expect(
    acceptedNodes
      .filter((node) => node.kind === "file")
      .every((node) => node.parent === directoryNode.handle)
  ).toBe(true);
  workspace.reconciliation.release(result.summary.token);
  await rename(join(directory, "nested"), join(directory, "old-nested"));
  await mkdir(join(directory, "nested"));
  for (let i = 0; i < 135; i++)
    await writeFile(join(directory, `nested/file-${i}.md`), "body");
  let observedReplacement = false;
  // Cleanup is deliberately drained before requesting a new private task.
  for (let i = 0; i < 100; i++) {
    const retry = await workspace.reconciliation.prepare(root.handle);
    if (retry.ok) {
      expect(retry.summary.replaced).toBe(136);
      expect(retry.summary.retainedHandles).toHaveLength(0);
      observedReplacement = true;
      expect(
        await workspace.reconciliation.accept(
          workspace.reconciliation.issue(retry.summary.token)!
        )
      ).toMatchObject({ status: "committed" });
      const replaced = await nodes((await settle()).roots[0]);
      const oldHandles = new Set(original.map((node) => node.handle));
      expect(replaced.every((node) => !oldHandles.has(node.handle))).toBe(true);
      const parents = new Set([
        root.handle,
        ...replaced
          .filter((node) => node.kind === "directory")
          .map((node) => node.handle),
      ]);
      expect(replaced.every((node) => parents.has(node.parent))).toBe(true);
      workspace.reconciliation.release(retry.summary.token);
      break;
    }
    expect(retry.reason).toBe("BUSY");
    await Bun.sleep(2);
  }
  expect(observedReplacement).toBe(true);
  await workspace.request(
    request("hidden", { root: root.handle, showHidden: true })
  );
  expect(workspace.reconciliation.get(result.summary.token)).toBeUndefined();
});
test("hidden toggle shares scan/link/open policy and preserves explicit provenance across handles", async () => {
  await mkdir(join(directory, ".secret"));
  await mkdir(join(directory, ".git"));
  for (const name of [
    "plain.md",
    ".hidden.md",
    ".secret/nested.md",
    ".git/bad.md",
  ])
    await writeFile(join(directory, name), `# ${name}`);
  await symlink(".hidden.md", join(directory, "alias.md"));
  await symlink(".git/bad.md", join(directory, "git-alias.md"));
  selected = join(directory, ".hidden.md");
  const explicit = await documents.select(request("select"));
  // Document requests deliberately exclude workspace's op field.
  expect(explicit.ok).toBe(false);
  const picked = await documents.select({
    protocolVersion: 1,
    requestId: "pick-hidden",
  });
  if (!picked.ok || !picked.snapshot) throw Error("pick");
  expect(picked.snapshot.explicitStandalone).toBe(true);
  selected = directory;
  await workspace.request(request("select"));
  let state = await settle();
  expect((await nodes(state.roots[0])).map((n) => n.name)).not.toContain(
    ".hidden.md"
  );
  await workspace.request(
    request("hidden", { root: state.roots[0].handle, showHidden: true })
  );
  state = await settle();
  const all = await nodes(state.roots[0]);
  expect(state.roots[0].errors).toBe(0);
  expect(state.roots[0].status).toBe("complete");
  expect(all.map((n) => n.name)).toContain(".hidden.md");
  expect(all.map((n) => n.name)).toContain("nested.md");
  expect(all.map((n) => n.name)).not.toContain(".git");
  expect(all.map((n) => n.name)).not.toContain("git-alias.md");
  const treeOpen = await workspace.open({
    protocolVersion: 1,
    requestId: "tree-hidden",
    root: state.roots[0].handle,
    entry: all.find((n) => n.name === ".hidden.md")!.handle,
  });
  if (!treeOpen.ok || !treeOpen.snapshot) throw Error("tree");
  expect(treeOpen.snapshot.explicitStandalone).toBe(true);
  expect(treeOpen.snapshot.documentId).toBe(picked.snapshot.documentId);
  await documents.release({
    protocolVersion: 1,
    requestId: "release-old-explicit",
    handle: picked.snapshot.handle,
  });
  const derived = await workspace.open({
    protocolVersion: 1,
    requestId: "derived-hidden",
    root: state.roots[0].handle,
    entry: all.find((n) => n.name === "nested.md")!.handle,
  });
  if (!derived.ok || !derived.snapshot) throw Error("derived");
  expect(derived.snapshot.explicitStandalone).toBe(false);
  const assetEpoch = documents.assetEpochs()[derived.snapshot.handle];
  await workspace.request(
    request("hidden", { root: state.roots[0].handle, showHidden: false })
  );
  state = await settle();
  expect(state.coveredHandles).not.toContain(treeOpen.snapshot.handle);
  expect(documents.assetEpochs()[derived.snapshot.handle]).toBe(assetEpoch);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "read-still-open",
      handle: derived.snapshot.handle,
    })
  ).toMatchObject({ ok: true, snapshot: { explicitStandalone: false } });
  selected = join(directory, ".secret/nested.md");
  const promoted = await documents.select({
    protocolVersion: 1,
    requestId: "promote-explicit",
  });
  expect(promoted).toMatchObject({
    ok: true,
    snapshot: {
      documentId: derived.snapshot.documentId,
      explicitStandalone: true,
    },
  });
  await workspace.request(request("clear"));
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "explicit-authority-survives",
      handle: treeOpen.snapshot.handle,
    })
  ).toMatchObject({ ok: true, snapshot: { explicitStandalone: true } });
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "derived-authority-revoked",
      handle: derived.snapshot.handle,
    })
  ).toMatchObject({ ok: false });
});
test("serialized hidden preferences survive reauthorization and cannot revive cleared roots", async () => {
  await workspace.dispose();
  const prefs = createHiddenPreferences(join(directory, "app-settings"));
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
    preferences: prefs,
  });
  await workspace.request(request("select"));
  let state = await settle();
  const root = state.roots[0].handle;
  await Promise.all(
    [true, false, true].map((showHidden) =>
      workspace.request(request("hidden", { root, showHidden }))
    )
  );
  state = await settle();
  expect(state.roots[0].showHidden).toBe(true);
  await workspace.request(request("clear"));
  await workspace.request(request("select"));
  state = await settle();
  expect(state.roots[0].showHidden).toBe(true);
  expect(
    await createHiddenPreferences(join(directory, "app-settings")).get(
      await realpath(directory)
    )
  ).toBe(true);
});
test("late preference completion after clear cannot revive a root, failed writes retain old policy", async () => {
  await workspace.dispose();
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  let fail = true;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(selected),
    preferences: {
      get: () => Promise.resolve(false),
      async set() {
        if (fail) throw Error("disk");
        entered();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    },
  });
  await workspace.request(request("select"));
  const state = await settle(),
    root = state.roots[0].handle;
  expect(
    await workspace.request(request("hidden", { root, showHidden: true }))
  ).toMatchObject({ ok: false });
  expect((await settle()).roots[0].showHidden).toBe(false);
  fail = false;
  const pending = workspace.request(
    request("hidden", { root, showHidden: true })
  );
  await started;
  await workspace.request(request("clear"));
  release();
  expect(await pending).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
  expect((await settle()).roots).toEqual([]);
});
test("real Worker finds only valid branches, canonical link dedup and explicit hidden standalone", async () => {
  for (const part of ["child", "empty", "nonmd", ".hidden", ".git", "other"])
    await mkdir(join(directory, part));
  for (const part of [
    "a.md",
    "child/b.markdown",
    ".hidden/h.md",
    ".git/g.md",
    ".secret.md",
    "other/c.md",
  ])
    await writeFile(join(directory, part), `# ${part}`);
  await writeFile(join(directory, "nonmd/a.txt"), "text");
  await symlink("a.md", join(directory, "alias.md"));
  await symlink("child", join(directory, "linked"));
  await symlink("missing.md", join(directory, "broken.md"));
  await symlink("cycle.md", join(directory, "cycle.md"));
  selected = join(directory, ".secret.md");
  const hidden = await documents.select({
    protocolVersion: 1,
    requestId: "hidden",
  });
  expect(hidden.ok).toBe(true);
  selected = directory;
  const added = good(await workspace.request(request("select")));
  expect(added.roots[0].status).toBe("scanning");
  const state = await settle(),
    all = await nodes(state.roots[0]);
  expect(
    all
      .filter((n) => n.kind === "file")
      .map((n) => n.name)
      .sort()
  ).toEqual(["a.md", "b.markdown", "c.md"]);
  expect(
    all
      .filter((n) => n.kind === "directory")
      .map((n) => n.name)
      .sort()
  ).toEqual(["child", "other"]);
  expect(state.coveredHandles).toEqual([]);
  selected = join(directory, ".git/g.md");
  expect(
    await documents.select({ protocolVersion: 1, requestId: "git" })
  ).toMatchObject({ ok: false, error: "UNSUPPORTED_FILE" });
});
test("parent absorption preserves scoped open identity; stale handles revoke on rescan/clear", async () => {
  await mkdir(join(directory, "child"));
  const path = join(directory, "child/a.md");
  await writeFile(path, "# a");
  selected = join(directory, "child");
  await workspace.request(request("select"));
  let state = await settle();
  const child = state.roots[0],
    leaf = (await nodes(child)).find((n) => n.kind === "file")!;
  const open = await workspace.open({
    protocolVersion: 1,
    requestId: "open",
    root: child.handle,
    entry: leaf.handle,
  });
  if (!open.ok || !open.snapshot) throw Error(JSON.stringify(open));
  selected = directory;
  await workspace.request(request("select"));
  state = await settle();
  expect(state.roots).toHaveLength(1);
  expect(state.roots[0].handle).not.toBe(child.handle);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "read",
      handle: open.snapshot.handle,
    })
  ).toMatchObject({
    ok: true,
    snapshot: { documentId: open.snapshot.documentId },
  });
  const root = state.roots[0],
    entry = (await nodes(root)).find((n) => n.kind === "file")!;
  await workspace.request(request("rescan", { root: root.handle }));
  expect(
    await workspace.open({
      protocolVersion: 1,
      requestId: "stale",
      root: root.handle,
      entry: entry.handle,
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
  await workspace.request(request("clear"));
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "revoked",
      handle: open.snapshot.handle,
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
});
test("W25 absorbs an explicit hidden directory root in either order while retaining its opened grant", async () => {
  const hidden = join(directory, ".hidden");
  await mkdir(hidden);
  await writeFile(join(hidden, "a.md"), "# hidden root");
  selected = hidden;
  await workspace.request(request("select"));
  let state = await settle();
  const child = state.roots[0],
    leaf = (await nodes(child))[0];
  const opened = await workspace.open({
    protocolVersion: 1,
    requestId: "hidden-root-open",
    root: child.handle,
    entry: leaf.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error(JSON.stringify(opened));
  selected = directory;
  await workspace.request(request("select"));
  state = await settle();
  expect(state.roots).toHaveLength(1);
  expect(state.roots[0].displayPath).not.toBe(child.displayPath);
  expect(state.roots[0].entries).toBe(0);
  expect(state.coveredHandles).not.toContain(opened.snapshot.handle);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "hidden-root-still-open",
      handle: opened.snapshot.handle,
    })
  ).toMatchObject({
    ok: true,
    snapshot: { documentId: opened.snapshot.documentId, text: "# hidden root" },
  });
  selected = hidden;
  await workspace.request(request("select"));
  expect(good(await workspace.request(request("state"))).roots).toHaveLength(1);
});
test("root renamed with pending directories terminates and releases the queue", async () => {
  await mkdir(join(directory, "child"));
  await writeFile(join(directory, "child/a.md"), "# a");
  const scan = createScan(
    await authorizeRoot(directory),
    join(import.meta.dir, "../../../dist-native/save-primitives.node")
  );
  try {
    const initial = await scan.next();
    expect(initial.done).toBe(false);
    expect(initial.queueBytes).toBeGreaterThan(0);
    await rename(directory, `${directory}-moved`);
    try {
      const stopped = await scan.next();
      expect(stopped.done).toBe(true);
      expect(stopped.errors).toBe(1);
      expect(stopped.queueBytes).toBe(0);
      expect((await scan.next()).done).toBe(true);
    } finally {
      await rename(`${directory}-moved`, directory);
    }
  } finally {
    scan.close();
  }
});
test("link resolver refuses scope escapes and symlink-dotdot without following foreign metadata", async () => {
  await mkdir(join(directory, "root"));
  await mkdir(join(directory, "foreign"));
  await writeFile(join(directory, "root/local.md"), "local");
  await writeFile(join(directory, "foreign/out.md"), "foreign");
  await symlink("../foreign", join(directory, "root/exit"));
  await symlink("exit/out.md", join(directory, "root/out.md"));
  await symlink(
    `${directory}/root/exit/../local.md`,
    join(directory, "root/dotdot.md")
  );
  await symlink(
    `${directory}/foreign/out.md`,
    join(directory, "root/absolute.md")
  );
  selected = join(directory, "root");
  await workspace.request(request("select"));
  const state = await settle();
  expect(
    (await nodes(state.roots[0]))
      .filter((node) => node.kind === "file")
      .map((node) => node.name)
  ).toEqual(["local.md"]);
});
test("scanned directory replacement rejects before reading the foreign body", async () => {
  await mkdir(join(directory, "child"));
  await mkdir(join(directory, "outside"));
  await writeFile(join(directory, "child/a.md"), "inside");
  await writeFile(join(directory, "outside/a.md"), "FOREIGN");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0],
    entry = (await nodes(root)).find((n) =>
      n.displayPath.endsWith("child/a.md")
    )!;
  await rename(join(directory, "child"), join(directory, "old"));
  await symlink("outside", join(directory, "child"));
  expect(
    await workspace.open({
      protocolVersion: 1,
      requestId: "changed",
      root: root.handle,
      entry: entry.handle,
    })
  ).toMatchObject({ ok: false, error: "FILE_CHANGED" });
});
test("bounded cache explicitly pauses without reporting completion; malformed and forged requests reject", async () => {
  await workspace.dispose();
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents,
    cacheLimit: 100,
  });
  await writeFile(join(directory, "a.md"), "# a");
  await workspace.request(request("select"));
  const state = await settle();
  expect(state.roots[0].status).toBe("paused");
  expect(state.cacheBytes).toBeLessThanOrEqual(100);
  expect(
    await workspace.request({ ...request("state"), path: directory })
  ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
  expect(
    await workspace.open({
      protocolVersion: 1,
      requestId: "forged",
      root: crypto.randomUUID(),
      entry: crypto.randomUUID(),
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
});
test("two roots and explicit single-file targets keep one canonical visible owner", async () => {
  for (const name of ["one", "two"]) await mkdir(join(directory, name));
  await writeFile(join(directory, "two/target.md"), "# target");
  await writeFile(join(directory, "single.md"), "# single");
  await symlink("../two/target.md", join(directory, "one/cross.md"));
  await symlink("../single.md", join(directory, "one/standalone.md"));
  selected = join(directory, "single.md");
  const single = await documents.select({
    protocolVersion: 1,
    requestId: "single",
  });
  expect(single.ok).toBe(true);
  selected = join(directory, "one");
  await workspace.request(request("select"));
  selected = join(directory, "two");
  await workspace.request(request("select"));
  const state = await settle(),
    all = (await Promise.all(state.roots.map(nodes))).flat();
  expect(all.filter((n) => n.kind === "file").map((n) => n.name)).toEqual([
    "target.md",
  ]);
  expect(state.coveredHandles).toHaveLength(0);
});
test("all directory entries count toward native batches and tree pages do not truncate", async () => {
  for (let index = 0; index < 270; index++)
    await writeFile(join(directory, `note-${index}.md`), "# note");
  for (let index = 0; index < 140; index++)
    await writeFile(join(directory, `.hidden-${index}`), "");
  await workspace.request(request("select"));
  const state = await settle(),
    root = state.roots[0];
  expect(root.status).toBe("complete");
  expect(root.examined).toBeGreaterThanOrEqual(410);
  expect(root.entries).toBe(270);
  const all = await nodes(root);
  expect(new Set(all.map((node) => node.handle)).size).toBe(270);
  expect(state.cacheBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
});
test("native cursor is branded, bounded and closed idempotently", () => {
  const native = createRequire(import.meta.url)(
    join(import.meta.dir, "../../../dist-native/save-primitives.node")
  ) as {
    scanOpen(fd: number): object;
    scanBatch(cursor: object, size: number): unknown;
    scanClose(cursor: object): void;
  };
  expect(() => native.scanBatch({}, 1)).toThrow();
  expect(() => native.scanClose({})).toThrow();
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY),
    cursor = native.scanOpen(fd);
  try {
    expect(() => native.scanBatch(cursor, 129)).toThrow();
    native.scanClose(cursor);
    native.scanClose(cursor);
    expect(() => native.scanBatch(cursor, 1)).toThrow();
  } finally {
    native.scanClose(cursor);
    closeSync(fd);
  }
});
test("late batches cannot repopulate cleared roots", async () => {
  await workspace.dispose();
  let deliver: ((value: unknown) => void) | undefined;
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents,
    worker: {
      call(message) {
        return message.op === "next"
          ? new Promise((resolve) => {
              deliver = resolve;
            })
          : Promise.resolve(null);
      },
      dispose() {
        /* Controlled fake owns no resources. */
      },
    },
  });
  await workspace.request(request("select"));
  while (!deliver) await Bun.sleep(1);
  const cleared = good(await workspace.request(request("clear")));
  expect(cleared.roots).toEqual([]);
  deliver({
    files: [],directories: [],
    examined: 1,
    errors: 0,
    done: true,
    paused: false,
    queueBytes: 0,
  });
  await Bun.sleep(3);
  expect(good(await workspace.request(request("state"))).roots).toEqual([]);
});
test("candidate batches yield to a simultaneous root scan on the same Worker", async () => {
  await workspace.dispose();
  const paths = [join(directory, "A"), join(directory, "B")];
  await mkdir(paths[0]);
  await mkdir(paths[1]);
  selected = paths[0];
  let firstKey = "",
    candidateKey = "",
    otherKey = "",
    active = 0,
    maximum = 0;
  let resume: (() => void) | undefined;
  const count = new Map<string, number>(),
    nexts: string[] = [];
  const empty = {
    files: [],directories: [],
    examined: 0,
    errors: 0,
    done: true,
    paused: false,
    queueBytes: 0,
  };
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
    worker: {
      async call(message) {
        active++;
        maximum = Math.max(maximum, active);
        const key = String(message.key);
        try {
          if (message.op === "start") {
            if (!firstKey) firstKey = key;
            else if (!candidateKey) candidateKey = key;
            else otherKey = key;
          }
          if (message.op !== "next") return empty;
          nexts.push(key);
          const n = (count.get(key) ?? 0) + 1;
          count.set(key, n);
          if (key === candidateKey && n === 1)
            await new Promise<void>((resolve) => {
              resume = resolve;
            });
          return { ...empty, done: key === firstKey || n >= 3 };
        } finally {
          active--;
        }
      },
      dispose() {
        return undefined;
      },
    },
  });
  await workspace.request(request("select"));
  const root = (await settle()).roots[0];
  const pending = workspace.reconciliation.prepare(root.handle);
  for (let i = 0; !resume && i < 100; i++) await Bun.sleep(1);
  expect(resume).toBeDefined();
  selected = paths[1];
  await workspace.request(request("select"));
  resume!();
  expect((await pending).ok).toBe(true);
  await settle();
  expect(maximum).toBe(1);
  expect(nexts.indexOf(otherKey)).toBeGreaterThan(nexts.indexOf(candidateKey));
  expect(nexts.indexOf(otherKey)).toBeLessThan(nexts.lastIndexOf(candidateKey));
});

test("owner drain serializes pending candidate and acceptance invalidation with rescan, hidden, clear and disposal", async () => {
  for (const phase of ["prepare", "accept"] as const) {
    for (const action of ["rescan", "hidden", "clear", "dispose"] as const) {
      await workspace.dispose();
      let rootKey = "",
        candidateKey = "",
        active = 0,
        maximum = 0,
        hold = phase === "prepare";
      let delivered: ((value: unknown) => void) | undefined;
      const closed: string[] = [];
      const empty = {
        files: [],directories: [],
        examined: 0,
        errors: 0,
        done: true,
        paused: false,
        queueBytes: 0,
      };
      workspace = createWorkspaceService({
        pickDirectory: () => Promise.resolve(directory),
        documents,
        worker: {
          async call(message) {
            active++;
            maximum = Math.max(maximum, active);
            try {
              if (message.op === "start" && !rootKey)
                rootKey = String(message.key).split(":")[0];
              if (
                message.op === "next" &&
                !String(message.key).startsWith(rootKey) &&
                hold
              ) {
                candidateKey = String(message.key);
                return await new Promise((resolve) => {
                  delivered = resolve;
                });
              }
              if (message.op === "close") closed.push(String(message.key));
              return empty;
            } finally {
              active--;
            }
          },
          dispose() {
            return undefined;
          },
        },
      });
      await workspace.request(request("select"));
      const root = (await settle()).roots[0];
      const prepared =
        phase === "accept"
          ? await workspace.reconciliation.prepare(root.handle)
          : undefined;
      if (prepared && !prepared.ok) throw Error(prepared.reason);
      hold = true;
      const pending = prepared?.ok
        ? workspace.reconciliation.accept(
            workspace.reconciliation.issue(prepared.summary.token)!
          )
        : workspace.reconciliation.prepare(root.handle);
      for (let i = 0; !delivered && i < 100; i++) await Bun.sleep(1);
      expect(delivered).toBeDefined();
      const operation =
        action === "dispose"
          ? workspace.dispose()
          : workspace.request(
              request(
                action,
                action === "clear"
                  ? {}
                  : action === "hidden"
                    ? { root: root.handle, showHidden: true }
                    : { root: root.handle }
              )
            );
      // Let asynchronous root verification/hidden preference reach invalidation.
      await Bun.sleep(5);
      delivered!(empty);
      await operation;
      expect(await pending).toEqual(
        phase === "prepare"
          ? { ok: false, reason: "INVALIDATED" }
          : { status: "rejected", reason: "INVALIDATED" }
      );
      expect(maximum).toBe(1);
      for (let i = 0; !closed.includes(candidateKey) && i < 100; i++)
        await Bun.sleep(1);
      expect(closed).toContain(candidateKey);
      if (action !== "dispose") await settle();
    }
  }
});
test("clear closes a worker session whose start reply is still pending", async () => {
  await workspace.dispose();
  let started: ((value: unknown) => void) | undefined;
  const closed: unknown[] = [];
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents,
    worker: {
      call(message) {
        if (message.op === "start")
          return new Promise((resolve) => {
            started = resolve;
          });
        if (message.op === "close") closed.push(message.key);
        return Promise.resolve(null);
      },
      dispose() {
        /* Fake has no native cursor. */
      },
    },
  });
  const root = good(await workspace.request(request("select"))).roots[0];
  while (!started) await Bun.sleep(1);
  await workspace.request(request("clear"));
  started(null);
  await Bun.sleep(3);
  expect(closed).toEqual([`${root.handle}:1`]);
  expect(good(await workspace.request(request("state"))).roots).toEqual([]);
});
test("actual volume case and Unicode aliases retain canonical owners", async () => {
  const root = join(directory, "CaseRoot"),
    variant = join(directory, "caseroot");
  await mkdir(root);
  await writeFile(join(root, "Café.md"), "# text");
  await symlink("Cafe\u0301.md", join(root, "unicode.md"));
  await symlink("CAFÉ.MD", join(root, "case.md"));
  selected = root;
  await workspace.request(request("select"));
  const initial = await settle(),
    all = await nodes(initial.roots[0]);
  expect(all.filter((node) => node.kind === "file")).toHaveLength(1);
  const sameVolumeAlias = await stat(variant).then(
    () => true,
    () => false
  );
  if (!sameVolumeAlias) await mkdir(variant);
  selected = variant;
  await workspace.request(request("select"));
  expect((await settle()).roots).toHaveLength(sameVolumeAlias ? 1 : 2);
});
test("derived document saves through existing service and root removal revokes all consumers", async () => {
  const path = join(directory, "a.md");
  await writeFile(path, "old");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0],
    leaf = (await nodes(root))[0];
  const opened = await workspace.open({
    protocolVersion: 1,
    requestId: "open-save",
    root: root.handle,
    entry: leaf.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error(JSON.stringify(opened));
  const snapshot = opened.snapshot,
    text = "saved";
  const saved = await documents.save({
    protocolVersion: 1,
    requestId: "save-scoped",
    handle: snapshot.handle,
    documentId: snapshot.documentId,
    expectedHash: snapshot.hash,
    expectedRevision: snapshot.revision,
    bufferRevision: 1,
    mirror: snapshot.mirror,
    content: {
      kind: "patch",
      from: 0,
      to: snapshot.text.length,
      insert: text,
      targetHash: createHash("sha256").update(text).digest("hex"),
    },
  });
  expect(saved).toMatchObject({ ok: true });
  expect(await readFile(path, "utf8")).toBe(text);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "read-saved",
      handle: snapshot.handle,
    })
  ).toMatchObject({
    ok: true,
    snapshot: { documentId: snapshot.documentId, text },
  });
  await workspace.request(request("clear"));
  expect(
    await documents.checkWriteCapability({
      protocolVersion: 1,
      requestId: "cap-revoked",
      handle: snapshot.handle,
    })
  ).toMatchObject({ capability: { writable: false } });
  expect(
    await documents.readLocalImage({
      protocolVersion: 1,
      requestId: "image-revoked",
      handle: snapshot.handle,
      reference: "a.png",
    })
  ).toMatchObject({ ok: false });
  expect(
    await documents.save({
      protocolVersion: 1,
      requestId: "save-revoked",
      handle: snapshot.handle,
      documentId: snapshot.documentId,
      expectedHash: snapshot.hash,
      expectedRevision: 1,
      bufferRevision: 1,
      mirror: snapshot.mirror,
      content: {
        kind: "resync",
        text,
        targetHash: createHash("sha256").update(text).digest("hex"),
      },
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
});
