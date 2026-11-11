import { expect, test } from "bun:test";
import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { fileFingerprint } from "../documents/path-authorization";

import { createMainTabMixedMetadataBinder } from "./main-tab-mixed-binder";
import { fixture, inputTab, request, text } from "./main-tab-mixed-test-fixture";

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
