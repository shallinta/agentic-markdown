import { expect, test } from "bun:test";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { DocumentSnapshot } from "../../shared/documents";
import type { MainTabSourceInput } from "../../shared/main-tab-checkpoint";
import { createDocumentService } from "../documents";
import { fileFingerprint } from "../documents/path-authorization";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createMainTabMixedMetadataBinder } from "./main-tab-mixed-binder";

const text = "# 同名文档\r\n合成内容\n";
const request = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});
const inputTab = (
  { handle, documentId, revision, hash }: DocumentSnapshot,
  mode: MainTabSourceInput["mode"] = "editing",
  pinned = false
): MainTabSourceInput => ({ handle, documentId, revision, hash, mode, pinned });

async function fixture() {
  const directory = await realpath(
    await mkdtemp(join(tmpdir(), "mixed-tab-binder-"))
  );
  const roots = [
    join(directory, "one/same"),
    join(directory, "two/same"),
  ] as const;
  const files = roots.map((root) => join(root, "a.md"));
  const explicitPath = join(roots[0], "nested/a.md");
  for (const path of [...files, explicitPath]) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  let pickedFile = explicitPath;
  let pickedFolder: string = roots[0];
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(pickedFile),
  });
  const roster = createRootRosterService(
    join(directory, "settings"),
    () => false,
    () => undefined
  );
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(pickedFolder),
    onRootRosterCommitted: (event) => roster.committed(event),
  });
  const binder = createMainTabMixedMetadataBinder({
    documents,
    workspace,
    roster,
  });
  const call = async (op: string, more: object = {}) => {
    const result = await workspace.request({ ...request(), op, ...more });
    if (!result.ok) throw Error(`Workspace fixture failed: ${op}`);
    return result;
  };
  const openFolderTab = async (index: 0 | 1) => {
    pickedFolder = roots[index];
    await call("select");
    for (let attempt = 0; attempt < 1000; attempt++) {
      const root = (await call("state")).roots.find(
        (candidate) => candidate.displayPath === roots[index]
      );
      if (root?.status !== "complete") {
        await Bun.sleep(2);
        continue;
      }
      await roster.drain();
      const page = await call("page", {
        root: root.handle,
        generation: root.generation,
        cursor: 0,
      });
      const entry = page.nodes?.find(
        (node) => node.kind === "file" && node.displayPath === files[index]
      );
      if (!entry) throw Error("Missing directory fixture file");
      const opened = await workspace.open({
        ...request(),
        root: root.handle,
        entry: entry.handle,
      });
      if (!opened.ok || !opened.snapshot)
        throw Error("Could not open directory fixture file");
      return opened.snapshot;
    }
    throw Error("Directory fixture scan incomplete");
  };
  const openExplicit = async (path = explicitPath) => {
    pickedFile = path;
    const opened = await documents.select(request());
    if (!opened.ok || !opened.snapshot)
      throw Error("Could not open explicit fixture file");
    return opened.snapshot;
  };
  return {
    documents,
    workspace,
    roster,
    binder,
    roots,
    files,
    explicitPath,
    openFolderTab,
    openExplicit,
    async close() {
      await workspace.dispose();
      await documents.dispose();
      await roster.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("mixed binding preserves visual order, active tab and authority for three same-named files", async () => {
  const f = await fixture();
  try {
    // Add the containing root after selecting the independent file explicitly.
    const explicit = await f.openExplicit();
    const a = await f.openFolderTab(0);
    const b = await f.openFolderTab(1);
    const tabs = [
      inputTab(a, "source", true),
      inputTab(explicit),
      inputTab(b, "source"),
    ];
    expect([a, explicit, b].map((file) => file.fileName)).toEqual([
      "a.md",
      "a.md",
      "a.md",
    ]);
    expect([a, explicit, b].map((file) => file.explicitStandalone)).toEqual([
      false,
      true,
      false,
    ]);
    const baseline = f.documents.locations();
    const receipt = await f.binder.bind({ tabs, activeIndex: 1 });
    if (receipt.status !== "ready")
      throw Error(`Binding failed: ${receipt.status}`);
    const firstRoot = await f.roster.confirmExpansionIdentity(f.roots[0]);
    const secondRoot = await f.roster.confirmExpansionIdentity(f.roots[1]);
    if (!firstRoot || !secondRoot) throw Error("Missing durable root identity");
    const orderedPaths = [f.files[0], f.explicitPath, f.files[1]];
    const fingerprints = await Promise.all(
      orderedPaths.map(async (path) =>
        fileFingerprint(await lstat(path, { bigint: true }))
      )
    );
    expect(receipt.data).toEqual({
      schemaVersion: 3,
      activeIndex: 1,
      tabs: [
        {
          kind: "root",
          rootId: firstRoot.id,
          relativePath: "a.md",
          fingerprint: fingerprints[0],
          mode: "source",
          pinned: true,
        },
        {
          kind: "standalone",
          path: f.explicitPath,
          fingerprint: fingerprints[1],
          mode: "editing",
          pinned: false,
        },
        {
          kind: "root",
          rootId: secondRoot.id,
          relativePath: "a.md",
          fingerprint: fingerprints[2],
          mode: "source",
          pinned: false,
        },
      ],
    });
    expect(receipt.current()).toBe(true);
    expect(f.documents.locations()).toEqual(baseline);
    expect(
      await Promise.all(orderedPaths.map((path) => readFile(path, "utf8")))
    ).toEqual([text, text, text]);
  } finally {
    await f.close();
  }
});

test("mixed binding rejects repeated file authority from the directory and picker and refuses a wrong revision", async () => {
  const f = await fixture();
  try {
    const directory = await f.openFolderTab(0);
    const duplicate = await f.openExplicit(f.files[0]);
    const independent = await f.openExplicit();
    expect(directory.explicitStandalone).toBe(false);
    expect(duplicate.explicitStandalone).toBe(true);
    expect(duplicate.handle).not.toBe(directory.handle);
    expect(duplicate.documentId).toBe(directory.documentId);
    expect(
      await f.binder.bind({
        tabs: [inputTab(directory), inputTab(duplicate)],
        activeIndex: 0,
      })
    ).toEqual({ status: "invalid" });

    const tabs = [inputTab(directory), inputTab(independent)];
    for (const index of [0, 1]) {
      const stale = tabs.map((tab, position) =>
        position === index ? { ...tab, revision: tab.revision + 1 } : tab
      );
      expect(await f.binder.bind({ tabs: stale, activeIndex: 1 })).toEqual({
        status: "unavailable",
      });
    }
    expect(f.documents.locations()).toHaveLength(3);
  } finally {
    await f.close();
  }
});

test("one canonical path with two actual document identities is rejected before either source proof", async () => {
  const f = await fixture();
  try {
    const former = await f.openFolderTab(0);
    const path = f.files[0];
    await rename(path, join(dirname(path), "retained-fixture"));
    await writeFile(path, text);
    const replacement = await f.openExplicit(path);
    expect(former.documentId).not.toBe(replacement.documentId);
    expect(former.explicitStandalone).toBe(false);
    expect(replacement.explicitStandalone).toBe(true);
    const bindings = f.documents.captureContentSearchBindings([
      former.handle,
      replacement.handle,
    ]);
    expect(bindings?.current()).toBe(true);
    expect(bindings?.bindings.map((binding) => binding?.path)).toEqual([
      path,
      path,
    ]);

    let rootProofs = 0;
    const binder = createMainTabMixedMetadataBinder({
      documents: f.documents,
      roster: f.roster,
      workspace: {
        captureMainTabSources(...args) {
          rootProofs++;
          return f.workspace.captureMainTabSources(...args);
        },
      },
    });
    expect(
      await binder.bind({
        tabs: [inputTab(former), inputTab(replacement)],
        activeIndex: 0,
      })
    ).toEqual({ status: "unavailable" });
    expect(rootProofs).toBe(0);
    expect(f.documents.locations()).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("revoking the standalone grant during durable directory confirmation discards the entire mixed candidate", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  try {
    const directory = await f.openFolderTab(0);
    const standalone = await f.openExplicit();
    const binder = createMainTabMixedMetadataBinder({
      documents: f.documents,
      workspace: f.workspace,
      roster: {
        async confirmExpansionIdentity(path) {
          const proof = await f.roster.confirmExpansionIdentity(path);
          entered.resolve();
          await resume.promise;
          return proof;
        },
      },
    });
    const pending = binder.bind({
      tabs: [inputTab(directory), inputTab(standalone)],
      activeIndex: 1,
    });
    await Promise.race([
      entered.promise,
      pending.then((result) => {
        throw Error(`Binding settled before the proof pause: ${result.status}`);
      }),
    ]);
    expect(
      (await f.documents.release({ ...request(), handle: standalone.handle }))
        .ok
    ).toBe(true);
    resume.resolve();
    expect(await pending).toEqual({ status: "stale" });
    expect(f.documents.locations().map(({ handle }) => handle)).toEqual([
      directory.handle,
    ]);
  } finally {
    resume.resolve();
    await f.close();
  }
});
