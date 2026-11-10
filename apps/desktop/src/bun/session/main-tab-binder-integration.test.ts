import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import {
  createMainTabMetadataBinder,
  type MainTabSourceInput,
} from "./main-tab-binder";
import { createMainTabMetadataStore } from "./main-tab-metadata";

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

test("actual directory grants bind same-name roots in visual order and roundtrip isolated metadata", async () => {
  const f = await fixture();
  const store = createMainTabMetadataStore(join(f.dir, "metadata"));
  try {
    const a = await f.open(f.paths[0]),
      b = await f.open(f.paths[1]);
    const input = {
      tabs: [{ ...b.tab, pinned: true, mode: "source" }, a.tab],
      activeIndex: 1,
    };
    const receipt = await f.binder.bind(input);
    if (receipt.status !== "ready") throw Error(receipt.status);
    const first = await f.roster.confirmExpansionIdentity(f.paths[0]),
      second = await f.roster.confirmExpansionIdentity(f.paths[1]);
    expect(receipt.data.tabs.map((tab) => tab.rootId)).toEqual([
      second!.id,
      first!.id,
    ]);
    expect(receipt.data.tabs.map((tab) => tab.relativePath)).toEqual([
      "a.md",
      "a.md",
    ]);
    expect(receipt.data.tabs.map((tab) => tab.mode)).toEqual([
      "source",
      "editing",
    ]);
    expect(receipt.data.tabs.map((tab) => tab.pinned)).toEqual([true, false]);
    expect(receipt.data.activeIndex).toBe(1);
    expect(await store.write(receipt.data)).toEqual({ status: "committed" });
    expect(await store.read()).toEqual({ status: "valid", data: receipt.data });
    for (const change of [
      { documentId: crypto.randomUUID() },
      { revision: a.tab.revision + 1 },
      { hash: "f".repeat(64) },
    ])
      expect(
        (
          await f.binder.bind({
            tabs: [{ ...a.tab, ...change }],
            activeIndex: 0,
          })
        ).status
      ).not.toBe("ready");
    expect(receipt.current()).toBe(true);
    await f.call("hidden", { root: a.root.handle, showHidden: true });
    expect(receipt.current()).toBe(false);
  } finally {
    await store.close();
    await f.close();
  }
});

test("standalone grant visually absorbed by a directory remains ineligible for root metadata", async () => {
  const f = await fixture();
  try {
    f.setFile(join(f.paths[0], "a.md"));
    const opened = await f.documents.select(f.request());
    if (!opened.ok || !opened.snapshot) throw Error(JSON.stringify(opened));
    await f.pick(f.paths[0]);
    const valid = await f.open(f.paths[1]);
    const { handle, documentId, revision, hash } = opened.snapshot;
    expect(
      (
        await f.binder.bind({
          tabs: [
            valid.tab,
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
        })
      ).status
    ).toBe("unavailable");
  } finally {
    await f.close();
  }
});

test("actual grant batch becomes unusable on roster changes, lifecycle release and cancellation", async () => {
  const f = await fixture();
  try {
    const { tab } = await f.open(f.paths[0]);
    const input = { tabs: [tab], activeIndex: 0 };
    const abort = new AbortController();
    const aborting = createMainTabMetadataBinder({
      workspace: f.workspace,
      roster: {
        async confirmExpansionIdentity(path) {
          const proof = await f.roster.confirmExpansionIdentity(path);
          abort.abort();
          return proof;
        },
      },
    });
    expect((await aborting.bind(input, abort.signal)).status).toBe("stale");
    const changed = createMainTabMetadataBinder({
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
    expect((await changed.bind(input)).status).toBe("stale");
    await f.documents.release({ ...f.request(), handle: tab.handle });
    expect((await f.binder.bind(input)).status).not.toBe("ready");
  } finally {
    await f.close();
  }
});

test("save admitted during source confirmation invalidates the whole previous baseline", async () => {
  const f = await fixture();
  try {
    const { tab, snapshot } = await f.open(f.paths[0]);
    const text = "# Saved replacement";
    let saveOutcome: unknown;
    const binder = createMainTabMetadataBinder({
      workspace: f.workspace,
      roster: {
        async confirmExpansionIdentity(path) {
          const proof = await f.roster.confirmExpansionIdentity(path);
          const saved = await f.documents.save({
            ...f.request(),
            handle: snapshot.handle,
            documentId: snapshot.documentId,
            expectedRevision: snapshot.revision,
            expectedHash: snapshot.hash,
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
          saveOutcome = saved;
          return proof;
        },
      },
    });
    expect((await binder.bind({ tabs: [tab], activeIndex: 0 })).status).toBe(
      "stale"
    );
    expect(saveOutcome).toMatchObject({ ok: true });
    expect(
      (await f.binder.bind({ tabs: [tab], activeIndex: 0 })).status
    ).not.toBe("ready");
  } finally {
    await f.close();
  }
});

test("second-root rescan completed during first-file proof rejects the staged batch", async () => {
  const f = await fixture();
  try {
    const a = await f.open(f.paths[0]),
      b = await f.open(f.paths[1]);
    const capture = f.documents.captureContentSearchBindings.bind(f.documents);
    let rescanned = false;
    f.documents.captureContentSearchBindings = (handles) => {
      const proof = capture(handles);
      if (!proof) return;
      return {
        ...proof,
        bindings: proof.bindings.map((binding, index) =>
          !binding || index !== 0
            ? binding
            : {
                ...binding,
                async verify(check) {
                  await binding.verify(check);
                  await f.call("hidden", {
                    root: b.root.handle,
                    showHidden: true,
                  });
                  for (let attempt = 0; attempt < 1000; attempt++) {
                    const root = (await f.call("state")).roots.find(
                      (root) => root.handle === b.root.handle
                    );
                    if (root?.status === "complete") {
                      rescanned = true;
                      return;
                    }
                    await Bun.sleep(2);
                  }
                  throw Error("Rescan incomplete");
                },
              }
        ),
      };
    };
    expect(
      (await f.binder.bind({ tabs: [a.tab, b.tab], activeIndex: 0 })).status
    ).not.toBe("ready");
    expect(rescanned).toBe(true);
  } finally {
    await f.close();
  }
});
