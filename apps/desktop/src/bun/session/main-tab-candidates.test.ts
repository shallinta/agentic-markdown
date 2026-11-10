import { expect, test } from "bun:test";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";
import { fileFingerprint } from "../documents/path-authorization";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createMainTabCandidateResolver } from "./main-tab-candidates";
import { createMainTabMetadataStore } from "./main-tab-metadata";

async function fixture() {
  const dir = await realpath(
    await mkdtemp(join(tmpdir(), "main-tab-candidates-"))
  );
  const paths = [join(dir, "one/same"), join(dir, "two/same")];
  for (const path of paths) {
    await mkdir(path, { recursive: true });
    for (const name of [
      "same.md",
      "extra.md",
      "missing.md",
      "replaced.md",
      ".hidden.md",
    ])
      await writeFile(join(path, name), "synthetic");
  }
  const store = createMainTabMetadataStore(join(dir, "metadata"));
  const session = () => {
    let selected = paths[0];
    const documents = createDocumentService({
      pickFile: () => Promise.resolve(null),
    });
    const roster = createRootRosterService(
      join(dir, "roster"),
      () => false,
      () => undefined
    );
    const workspace = createWorkspaceService({
      documents,
      pickDirectory: () => Promise.resolve(selected),
      onRootRosterCommitted: (event) => roster.committed(event),
    });
    const call = async (op: string, more: object = {}) => {
      const result = await workspace.request({
        protocolVersion: 1,
        requestId: crypto.randomUUID(),
        op,
        ...more,
      });
      if (!result.ok) throw Error(JSON.stringify(result));
      return result;
    };
    const pick = async (path: string) => {
      selected = path;
      await call("select");
      for (let attempt = 0; attempt < 1000; attempt++) {
        const root = (await call("state")).roots.find(
          (root) => root.displayPath === path
        );
        if (root?.status === "complete") {
          await roster.drain();
          return root;
        }
        await Bun.sleep(2);
      }
      throw Error("Scan did not finish");
    };
    return {
      documents,
      workspace,
      roster,
      call,
      pick,
      resolver: createMainTabCandidateResolver({ workspace, roster, store }),
      async close() {
        await workspace.dispose();
        await documents.dispose();
        await roster.close();
      },
    };
  };
  return {
    dir,
    paths,
    store,
    session,
    async close() {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

test("reopened real picker roots prove only current same-identity scan candidates in saved order", async () => {
  const f = await fixture();
  let s = f.session();
  try {
    const ids: string[] = [];
    for (const path of f.paths) {
      await s.pick(path);
      const identity = await s.roster.confirmExpansionIdentity(path);
      if (!identity) throw Error("Missing roster identity");
      ids.push(identity.id);
    }
    const entries = [
      [1, "same.md"],
      [0, "extra.md"],
      [0, "same.md"],
      [0, "missing.md"],
      [0, "replaced.md"],
      [0, ".hidden.md"],
    ] as const;
    const tabs = await Promise.all(
      entries.map(async ([root, relativePath]) => ({
        rootId: ids[root],
        relativePath,
        fingerprint: fileFingerprint(
          await stat(join(f.paths[root], relativePath), { bigint: true })
        ),
        pinned: false,
        mode: "editing" as const,
      }))
    );
    expect(await f.store.write({ tabs, activeIndex: 1 })).toEqual({
      status: "committed",
    });
    const before = await readFile(
      join(f.dir, "metadata/main-tab-session-probe.json")
    );
    await s.close();
    await rm(join(f.paths[0], "missing.md"));
    await rename(join(f.paths[0], "replaced.md"), join(f.paths[0], "old.md"));
    await writeFile(join(f.paths[0], "replaced.md"), "replacement");
    s = f.session();
    expect(await s.roster.confirmExpansionIdentity(f.paths[0])).toBeUndefined();
    expect((await s.resolver.resolve(crypto.randomUUID(), 1)).status).toBe(
      "stale"
    );
    const first = await s.pick(f.paths[0]);
    const result = await s.resolver.resolve(first.handle, first.generation);
    if (result.status !== "ready") throw Error(result.status);
    expect(result.items.map((item) => item.savedIndex)).toEqual([1, 2]);
    const nodes = (
      await s.call("page", {
        root: first.handle,
        generation: first.generation,
        cursor: 0,
      })
    ).nodes!;
    const expected = nodes.find((node) => node.name === "extra.md");
    if (!expected) throw Error("Missing current node");
    expect(result.items[0].entry).toBe(expected.handle);
    expect(result.current()).toBe(true);
    expect(await s.roster.confirmExpansionIdentity(f.paths[1])).toBeUndefined();
    const second = await s.pick(f.paths[1]);
    const other = await s.resolver.resolve(second.handle, second.generation);
    if (other.status !== "ready") throw Error(other.status);
    expect(other.items.map((item) => item.savedIndex)).toEqual([0]);
    expect(other.items[0].entry).not.toBe(result.items[0].entry);
    const lease = await s.documents.acquireFolderMutationLease();
    expect(lease?.bindings()).toEqual([]);
    lease?.release();
    expect(
      await readFile(join(f.dir, "metadata/main-tab-session-probe.json"))
    ).toEqual(before);
    await s.call("clear");
    expect(other.current()).toBe(false);
    expect(
      (await s.resolver.resolve(second.handle, second.generation)).status
    ).toBe("stale");
  } finally {
    await s.close();
    await f.close();
  }
});

test("current scan proof rechecks disk and lifecycle around metadata awaits without grants", async () => {
  const f = await fixture();
  const s = f.session();
  try {
    const root = await s.pick(f.paths[0]);
    const identity = await s.roster.confirmExpansionIdentity(f.paths[0]);
    if (!identity) throw Error("Missing identity");
    const path = join(f.paths[0], "same.md");
    await f.store.write({
      tabs: [
        {
          rootId: identity.id,
          relativePath: "same.md",
          fingerprint: fileFingerprint(await stat(path, { bigint: true })),
          pinned: true,
          mode: "source",
        },
      ],
      activeIndex: 0,
    });
    const fresh = await s.resolver.resolve(root.handle, root.generation);
    expect(fresh.status).toBe("ready");
    await rename(path, join(f.paths[0], "previous.md"));
    await writeFile(path, "new inode after scan");
    const replaced = await s.resolver.resolve(root.handle, root.generation);
    if (replaced.status !== "ready") throw Error(replaced.status);
    expect(replaced.items).toEqual([]);
    const delayed = createMainTabCandidateResolver({
      workspace: s.workspace,
      roster: s.roster,
      store: {
        async read() {
          const saved = await f.store.read();
          const resume = s.workspace.suspendRootMutations();
          resume();
          return saved;
        },
      },
    });
    expect((await delayed.resolve(root.handle, root.generation)).status).toBe(
      "stale"
    );
    const rosterChanged = createMainTabCandidateResolver({
      workspace: s.workspace,
      roster: s.roster,
      store: {
        async read() {
          const saved = await f.store.read();
          s.roster.committed({ paths: [], explicitClear: true });
          await s.roster.drain();
          return saved;
        },
      },
    });
    expect(
      (await rosterChanged.resolve(root.handle, root.generation)).status
    ).toBe("stale");
    const abort = new AbortController();
    abort.abort();
    expect(
      (await s.resolver.resolve(root.handle, root.generation, abort.signal))
        .status
    ).toBe("stale");
    await s.call("hidden", { root: root.handle, showHidden: true });
    expect(fresh.status === "ready" && fresh.current()).toBe(false);
    expect(
      (await s.resolver.resolve(root.handle, root.generation)).status
    ).toBe("stale");
    const lease = await s.documents.acquireFolderMutationLease();
    expect(lease?.bindings()).toEqual([]);
    lease?.release();
  } finally {
    await s.close();
    await f.close();
  }
});
