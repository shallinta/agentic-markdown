import { expect, test } from "bun:test";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { DocumentSnapshot } from "../../shared/documents";

import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";
import { createMixedMainTabCheckpointMetadataStore } from "./main-tab-mixed-metadata-store";
import {
  fixture,
  inputTab,
  request,
  text,
} from "./main-tab-mixed-test-fixture";
import { createRoutedMainTabCheckpoint } from "./main-tab-routed-checkpoint";

const mixedName = "main-tab-session-mixed-checkpoint.json";
const directoryName = "main-tab-session-checkpoint.json";
const emptyMixed = { schemaVersion: 3 as const, tabs: [], activeIndex: null };
const allowed = () => true;
const closed = ({ documentId, handle }: DocumentSnapshot) => ({
  documentId,
  handle,
});

function readers(dataDir: string) {
  const directory = createMainTabCheckpointMetadataStore(dataDir);
  const mixed = createMixedMainTabCheckpointMetadataStore(dataDir);
  return {
    directory,
    mixed,
    directoryPath: join(dataDir, directoryName),
    mixedPath: join(dataDir, mixedName),
    async close() {
      await Promise.all([directory.close(), mixed.close()]);
    },
  };
}

async function expectMissing(path: string) {
  const result = await stat(path).then(
    () => undefined,
    (error: unknown) => error
  );
  expect(result).toMatchObject({ code: "ENOENT" });
}

test("an actual standalone grant can write from an empty workspace and remains explicit once its directory is added", async () => {
  const f = await fixture();
  const writer = createRoutedMainTabCheckpoint(f.settingsDir, f);
  const persisted = readers(f.settingsDir);
  try {
    const standalone = await f.openExplicit();
    const workspace = await f.workspace.request({ ...request(), op: "state" });
    if (!workspace.ok) throw Error("Missing empty workspace fixture state");
    expect(workspace.roots).toEqual([]);
    expect(
      await writer.write(
        { tabs: [inputTab(standalone, "source")], activeIndex: 0 },
        allowed
      )
    ).toEqual({ status: "committed" });
    const first = await persisted.mixed.read();
    expect(first).toMatchObject({
      status: "valid",
      data: {
        schemaVersion: 3,
        tabs: [{ kind: "standalone", path: f.explicitPath, mode: "source" }],
        activeIndex: 0,
      },
    });
    await expectMissing(persisted.directoryPath);

    const root = await f.openFolderTab(0);
    expect(
      await writer.write(
        {
          tabs: [
            inputTab(root, "editing", true),
            inputTab(standalone, "source"),
          ],
          activeIndex: 1,
        },
        allowed
      )
    ).toEqual({ status: "committed" });
    const mixed = await persisted.mixed.read();
    if (mixed.status !== "valid" || first.status !== "valid")
      throw Error("Missing routed mixed records");
    expect(mixed.data.activeIndex).toBe(1);
    expect(mixed.data.tabs[0]).toMatchObject({
      kind: "root",
      relativePath: "a.md",
      mode: "editing",
      pinned: true,
    });
    expect(mixed.data.tabs[1]).toEqual(first.data.tabs[0]);
    await expectMissing(persisted.directoryPath);
  } finally {
    await writer.close();
    await persisted.close();
    await f.close();
  }
});

test("legacy-only directory writes turn into two owned directory views after a mixed publication", async () => {
  const f = await fixture();
  const writer = createRoutedMainTabCheckpoint(f.settingsDir, f);
  const other = createRoutedMainTabCheckpoint(f.settingsDir, f);
  const persisted = readers(f.settingsDir);
  try {
    const first = await f.openFolderTab(0);
    const last = await f.openFolderTab(1);
    const both = {
      tabs: [inputTab(first, "source", true), inputTab(last)],
      activeIndex: 1,
    };
    expect(await writer.write(both, allowed)).toEqual({ status: "committed" });
    expect(await persisted.directory.read()).toMatchObject({
      status: "valid",
      data: {
        activeIndex: 1,
        tabs: [
          { mode: "source", pinned: true },
          { mode: "editing", pinned: false },
        ],
      },
    });
    await expectMissing(persisted.mixedPath);
    const oldDirectory = await readFile(persisted.directoryPath);

    const explicit = await f.openExplicit();
    expect(
      await writer.write(
        {
          tabs: [both.tabs[0], inputTab(explicit), both.tabs[1]],
          activeIndex: 1,
        },
        allowed
      )
    ).toEqual({ status: "committed" });
    expect(await readFile(persisted.directoryPath)).toEqual(oldDirectory);
    expect(
      (await f.documents.release({ ...request(), handle: explicit.handle })).ok
    ).toBe(true);
    expect(await writer.prune(closed(explicit), allowed)).toEqual({
      status: "committed",
    });
    expect(await readFile(persisted.directoryPath)).toEqual(oldDirectory);
    const mixedBefore = await readFile(persisted.mixedPath);

    const reordered = {
      tabs: [inputTab(last, "source", true), inputTab(first)],
      activeIndex: 0,
    };
    expect(await writer.write(reordered, allowed)).toEqual({
      status: "committed",
    });
    const directory = await persisted.directory.read();
    const mixed = await persisted.mixed.read();
    if (directory.status !== "valid" || mixed.status !== "valid")
      throw Error("Missing dual directory checkpoint");
    expect(mixed.data).toEqual({
      schemaVersion: 3,
      activeIndex: directory.data.activeIndex,
      tabs: directory.data.tabs.map((row) => ({ kind: "root", ...row })),
    });
    expect(mixed.data.tabs.map(({ mode, pinned }) => [mode, pinned])).toEqual([
      ["source", true],
      ["editing", false],
    ]);
    expect(await readFile(`${persisted.directoryPath}.bak`)).toEqual(
      oldDirectory
    );
    expect(await readFile(`${persisted.mixedPath}.bak`)).toEqual(mixedBefore);

    const dualBytes = await Promise.all([
      readFile(persisted.directoryPath),
      readFile(persisted.mixedPath),
    ]);
    expect(await other.clear(allowed)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(
      await Promise.all([
        readFile(persisted.directoryPath),
        readFile(persisted.mixedPath),
      ])
    ).toEqual(dualBytes);
    expect(
      (await f.documents.release({ ...request(), handle: last.handle })).ok
    ).toBe(true);
    expect(await writer.prune(closed(last), allowed)).toEqual({
      status: "committed",
    });
    expect(await persisted.directory.read()).toEqual({
      status: "valid",
      data: { activeIndex: 0, tabs: [directory.data.tabs[1]] },
    });
    expect(await persisted.mixed.read()).toEqual({
      status: "valid",
      data: { schemaVersion: 3, activeIndex: 0, tabs: [mixed.data.tabs[1]] },
    });
    expect(await readFile(`${persisted.directoryPath}.bak`)).toEqual(
      dualBytes[0]
    );
    expect(await readFile(`${persisted.mixedPath}.bak`)).toEqual(dualBytes[1]);

    expect(
      (await f.documents.release({ ...request(), handle: first.handle })).ok
    ).toBe(true);
    expect(await writer.clear(allowed)).toEqual({ status: "committed" });
    expect(await persisted.directory.read()).toEqual({
      status: "valid",
      data: { activeIndex: null, tabs: [] },
    });
    expect(await persisted.mixed.read()).toEqual({
      status: "valid",
      data: emptyMixed,
    });
    for (const path of [...f.files, f.explicitPath])
      expect(await readFile(path)).toEqual(Buffer.from(text));
  } finally {
    await other.close();
    await writer.close();
    await persisted.close();
    await f.close();
  }
});

test("wrong trusted identity and a rejected mixed publication do not fall back or enable mixed routing", async () => {
  const f = await fixture();
  const checked: string[][] = [];
  const writer = createRoutedMainTabCheckpoint(f.settingsDir, {
    ...f,
    workspace: {
      captureMainTabSources(tabs, check) {
        checked.push(tabs.map(({ handle }) => handle));
        return f.workspace.captureMainTabSources(tabs, check);
      },
    },
  });
  const persisted = readers(f.settingsDir);
  try {
    const root = await f.openFolderTab(0);
    const standalone = await f.openExplicit();
    const rootOnly = { tabs: [inputTab(root)], activeIndex: 0 };
    expect(await writer.write(rootOnly, allowed)).toEqual({
      status: "committed",
    });
    const original = await readFile(persisted.directoryPath);
    const protectedBytes = Buffer.from(
      '{"version":1,"data":{"schemaVersion":4,"tabs":[]}}\r\n'
    );
    await writeFile(persisted.mixedPath, protectedBytes);
    checked.length = 0;
    expect(
      await writer.write(
        {
          tabs: [
            inputTab(root),
            { ...inputTab(standalone), revision: standalone.revision + 1 },
          ],
          activeIndex: 1,
        },
        allowed
      )
    ).toEqual({ status: "rejected", reason: "unavailable" });
    expect(checked).toEqual([]);
    expect(
      await writer.write(
        { tabs: [inputTab(root), inputTab(standalone)], activeIndex: 1 },
        allowed
      )
    ).toEqual({ status: "rejected", reason: "future" });
    expect(
      checked.every((handles) => !handles.includes(standalone.handle))
    ).toBe(true);
    expect(await readFile(persisted.directoryPath)).toEqual(original);
    await expectMissing(`${persisted.directoryPath}.bak`);
    expect(await readFile(persisted.mixedPath)).toEqual(protectedBytes);
    expect(
      await writer.write(
        { tabs: [inputTab(root, "source")], activeIndex: 0 },
        allowed
      )
    ).toEqual({ status: "committed" });
    expect(await persisted.directory.read()).toMatchObject({
      status: "valid",
      data: { tabs: [{ mode: "source" }] },
    });
    expect(await readFile(persisted.mixedPath)).toEqual(protectedBytes);
  } finally {
    await writer.close();
    await persisted.close();
    await f.close();
  }
});

test("closing the router fences its in-flight mixed binding and queued directory write", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const writer = createRoutedMainTabCheckpoint(f.settingsDir, {
    ...f,
    roster: {
      async confirmExpansionIdentity(path) {
        const receipt = await f.roster.confirmExpansionIdentity(path);
        entered.resolve();
        await resume.promise;
        return receipt;
      },
    },
  });
  try {
    const root = await f.openFolderTab(0);
    const standalone = await f.openExplicit();
    const input = {
      tabs: [inputTab(root), inputTab(standalone)],
      activeIndex: 1,
    };
    const first = writer.write(input, allowed);
    await Promise.race([
      entered.promise,
      first.then((result) => {
        throw Error(
          `Routed write settled before lifecycle pause: ${result.status}`
        );
      }),
    ]);
    const queued = writer.write(
      { tabs: [inputTab(root)], activeIndex: 0 },
      allowed
    );
    const closing = writer.close();
    resume.resolve();
    expect(await Promise.all([first, queued])).toEqual([
      { status: "rejected", reason: "stale" },
      { status: "rejected", reason: "stale" },
    ]);
    await closing;
    expect(await writer.write(input, allowed)).toEqual({
      status: "rejected",
      reason: "closed",
    });
    await expectMissing(join(f.settingsDir, directoryName));
    await expectMissing(join(f.settingsDir, mixedName));
  } finally {
    resume.resolve();
    await writer.close();
    await f.close();
  }
});

test("a mixed-first pure-directory update reports unknown when compatibility publication is protected", async () => {
  const f = await fixture();
  const writer = createRoutedMainTabCheckpoint(f.settingsDir, f);
  const persisted = readers(f.settingsDir);
  try {
    const standalone = await f.openExplicit();
    expect(
      await writer.write(
        { tabs: [inputTab(standalone)], activeIndex: 0 },
        allowed
      )
    ).toEqual({ status: "committed" });
    const previous = await readFile(persisted.mixedPath);
    const root = await f.openFolderTab(0);
    const protectedBytes = Buffer.from(
      '{"version":99,"data":{"future":true}}\r\n'
    );
    await writeFile(persisted.directoryPath, protectedBytes);
    expect(
      await writer.write(
        { tabs: [inputTab(root, "source")], activeIndex: 0 },
        allowed
      )
    ).toEqual({ status: "unknown", reason: "io" });
    expect(await persisted.mixed.read()).toMatchObject({
      status: "valid",
      data: { activeIndex: 0, tabs: [{ kind: "root", mode: "source" }] },
    });
    expect(await readFile(`${persisted.mixedPath}.bak`)).toEqual(previous);
    expect(await readFile(persisted.directoryPath)).toEqual(protectedBytes);
    await expectMissing(`${persisted.directoryPath}.bak`);
  } finally {
    await writer.close();
    await persisted.close();
    await f.close();
  }
});

test("a pure-directory update does not overwrite a mixed checkpoint replaced by another writer", async () => {
  const f = await fixture();
  const former = createRoutedMainTabCheckpoint(f.settingsDir, f);
  const peer = createRoutedMainTabCheckpoint(f.settingsDir, f);
  const persisted = readers(f.settingsDir);
  try {
    const standalone = await f.openExplicit();
    expect(
      await former.write(
        { tabs: [inputTab(standalone)], activeIndex: 0 },
        allowed
      )
    ).toEqual({ status: "committed" });
    const first = await readFile(persisted.mixedPath);
    expect(
      await peer.write(
        { tabs: [inputTab(standalone, "source")], activeIndex: 0 },
        allowed
      )
    ).toEqual({ status: "committed" });
    const newer = await readFile(persisted.mixedPath);
    expect(newer).not.toEqual(first);
    expect(await readFile(`${persisted.mixedPath}.bak`)).toEqual(first);
    const root = await f.openFolderTab(0);
    expect(
      await former.write(
        { tabs: [inputTab(root, "source")], activeIndex: 0 },
        allowed
      )
    ).toEqual({ status: "unknown", reason: "io" });
    expect(await persisted.directory.read()).toMatchObject({
      status: "valid",
      data: {
        activeIndex: 0,
        tabs: [{ relativePath: "a.md", mode: "source" }],
      },
    });
    expect(await readFile(persisted.mixedPath)).toEqual(newer);
    expect(await readFile(`${persisted.mixedPath}.bak`)).toEqual(first);
  } finally {
    await peer.close();
    await former.close();
    await persisted.close();
    await f.close();
  }
});
