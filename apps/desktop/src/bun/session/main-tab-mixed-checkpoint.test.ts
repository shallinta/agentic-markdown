import { expect, test } from "bun:test";
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import {
  lstat,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import type { DocumentSnapshot } from "../../shared/documents";
import { fileFingerprint } from "../documents/path-authorization";

import { captureMainTabBlockAnchor } from "./main-tab-anchor-worker-client";
import { createGuardedMixedMainTabCheckpoint } from "./main-tab-mixed-checkpoint";
import type { MixedMainTabMetadata } from "./main-tab-mixed-metadata";
import {
  fixture,
  inputTab,
  request,
  text,
} from "./main-tab-mixed-test-fixture";
import { encodeMainTabPosition } from "./main-tab-position-codec";
import { createMarkdownBlockAnchorProbe } from "./markdown-block-anchor-probe";

const officialName = "main-tab-session-mixed-checkpoint.json";
const directoryName = "main-tab-session-checkpoint.json";
const probeName = "main-tab-session-mixed-probe.json";
const empty: MixedMainTabMetadata = {
  schemaVersion: 3,
  tabs: [],
  activeIndex: null,
};
const envelope = (data: unknown) =>
  Buffer.from(` {"data":${JSON.stringify(data)},"version":1}\r\n`);

async function openMixed(f: Awaited<ReturnType<typeof fixture>>) {
  const standalone = await f.openExplicit();
  const root = await f.openFolderTab(0);
  return [root, standalone] as const;
}

const closedTab = ({ documentId, handle }: DocumentSnapshot) => ({
  documentId,
  handle,
});

async function childRead(directory: string, expectedPath: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      join(import.meta.dir, "main-tab-mixed-metadata-child.ts"),
      "read-official",
      directory,
      expectedPath,
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(exit).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as unknown;
}

test("actual mixed grants commit to the dedicated slot and a second process reads the updated record", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const [root, standalone] = await openMixed(f);
    const durable = await f.roster.confirmExpansionIdentity(f.roots[0]);
    if (!durable) throw Error("Missing durable root fixture");
    const rootRow = {
      rootId: durable.id,
      relativePath: "a.md",
      mode: "source",
      pinned: true,
      fingerprint: fileFingerprint(await lstat(f.files[0], { bigint: true })),
    } as const;
    const standaloneRow = {
      kind: "standalone",
      path: f.explicitPath,
      mode: "editing",
      pinned: false,
      fingerprint: fileFingerprint(
        await lstat(f.explicitPath, { bigint: true })
      ),
    } as const;
    const mixed: MixedMainTabMetadata = {
      schemaVersion: 3,
      tabs: [{ kind: "root", ...rootRow }, standaloneRow],
      activeIndex: 1,
    };
    const oldDirectory = envelope({ tabs: [rootRow], activeIndex: 0 });
    const oldProbe = envelope(empty);
    const directoryPath = join(f.settingsDir, directoryName);
    const probePath = join(f.settingsDir, probeName);
    const officialPath = join(f.settingsDir, officialName);
    await writeFile(directoryPath, oldDirectory);
    await writeFile(probePath, oldProbe);
    await writeFile(`${directoryPath}.bak`, oldDirectory);
    await writeFile(`${probePath}.bak`, oldProbe);
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "directory",
      data: {
        schemaVersion: 3,
        tabs: [{ kind: "root", ...rootRow }],
        activeIndex: 0,
      },
    });
    const missing = await stat(officialPath).then(
      () => undefined,
      (error: unknown) => error
    );
    expect(missing).toMatchObject({ code: "ENOENT" });

    const input = {
      tabs: [inputTab(root, "source", true), inputTab(standalone)],
      activeIndex: 1,
    };
    const writing = writer.write(input, () => true);
    input.activeIndex = 0;
    input.tabs[1].mode = "source";
    expect(await writing).toEqual({ status: "committed" });
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "mixed",
      data: mixed,
    });
    const firstBytes = await readFile(officialPath);

    const updated: MixedMainTabMetadata = {
      schemaVersion: 3,
      tabs: [mixed.tabs[0], { ...standaloneRow, mode: "source" }],
      activeIndex: 0,
    };
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    expect(await readFile(`${officialPath}.bak`)).toEqual(firstBytes);
    const expectedPath = join(f.settingsDir, "expected-mixed-fixture.json");
    await writeFile(expectedPath, JSON.stringify(updated));
    expect(await childRead(f.settingsDir, expectedPath)).toEqual({
      status: "valid",
      matches: true,
    });
    for (const path of [directoryPath, `${directoryPath}.bak`])
      expect(await readFile(path)).toEqual(oldDirectory);
    for (const path of [probePath, `${probePath}.bak`])
      expect(await readFile(path)).toEqual(oldProbe);
    expect(await readFile(f.files[0])).toEqual(Buffer.from(text));
    expect(await readFile(f.explicitPath)).toEqual(Buffer.from(text));
  } finally {
    await writer.close();
    await f.close();
  }
});

test("future format, in-flight cancellation and lost document authority leave the dedicated slot unchanged", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  let pause = false;
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, {
    ...f,
    roster: {
      async confirmExpansionIdentity(path) {
        const proof = await f.roster.confirmExpansionIdentity(path);
        if (pause) {
          entered.resolve();
          await resume.promise;
        }
        return proof;
      },
    },
  });
  try {
    const [root, standalone] = await openMixed(f);
    const input = {
      tabs: [inputTab(root), inputTab(standalone)],
      activeIndex: 1,
    };
    const path = join(f.settingsDir, officialName);
    const backup = `${path}.bak`;
    const future = envelope({ schemaVersion: 4, tabs: [] });
    const backupBytes = Buffer.from("original backup\n");
    await writeFile(path, future);
    await writeFile(backup, backupBytes);
    expect(await writer.write(input, () => true)).toEqual({
      status: "rejected",
      reason: "future",
    });
    expect(await writer.read()).toEqual({ status: "future" });
    expect(await readFile(path)).toEqual(future);
    expect(await readFile(backup)).toEqual(backupBytes);

    const original = envelope(empty);
    await writeFile(path, original);
    pause = true;
    const abort = new AbortController();
    const pending = writer.write(input, () => true, abort.signal);
    await Promise.race([
      entered.promise,
      pending.then((result) => {
        throw Error(`Write settled before binding pause: ${result.status}`);
      }),
    ]);
    abort.abort();
    resume.resolve();
    expect(await pending).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(path)).toEqual(original);
    expect(await readFile(backup)).toEqual(backupBytes);

    expect(
      (await f.documents.release({ ...request(), handle: standalone.handle }))
        .ok
    ).toBe(true);
    expect(await writer.write(input, () => true)).toEqual({
      status: "rejected",
      reason: "unavailable",
    });
    expect(await readFile(path)).toEqual(original);
    expect(await readFile(backup)).toEqual(backupBytes);
  } finally {
    resume.resolve();
    await writer.close();
    await f.close();
  }
});

test("a late competing publication remains authoritative after a fully bound mixed write prepared its backup", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const [root, standalone] = await openMixed(f);
    const input = {
      tabs: [inputTab(root), inputTab(standalone)],
      activeIndex: 1,
    };
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const path = join(f.settingsDir, officialName);
    const backup = `${path}.bak`;
    const previous = await readFile(path);
    const competing = envelope({ schemaVersion: 4, tabs: [], extra: "latest" });
    let observed: { authority: Buffer; backup: Buffer } | undefined;
    const result = await writer.write({ ...input, activeIndex: 0 }, () => {
      if (observed) return true;
      const staged = readdirSync(f.settingsDir).some(
        (file) =>
          file.startsWith(`${officialName}.`) &&
          !file.startsWith(`${officialName}.bak.`) &&
          file.endsWith(".tmp")
      );
      if (!staged) return true;
      const before = {
        authority: readFileSync(path),
        backup: readFileSync(backup),
      };
      writeFileSync(path, competing);
      observed = before;
      return true;
    });
    if (!observed)
      throw Error("No late competitor at the authoritative publication point");
    expect(observed.authority).toEqual(previous);
    expect(observed.backup).toEqual(previous);
    expect(result).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(path)).toEqual(competing);
    expect(await readFile(backup)).toEqual(previous);
    expect(await writer.read()).toEqual({ status: "future" });
    expect(
      (await readdir(f.settingsDir))
        .filter((file) => file.startsWith(officialName))
        .sort()
    ).toEqual([officialName, `${officialName}.bak`]);
  } finally {
    await writer.close();
    await f.close();
  }
});

const directoryGeometry = { from: 0, offset: -4.25, ratio: 0.6 };
const standaloneGeometry = { from: 1, offset: 2.5, ratio: 0.25 };

async function seedPositionedDirectory(
  f: Awaited<ReturnType<typeof fixture>>,
  root: DocumentSnapshot
) {
  const durable = await f.roster.confirmExpansionIdentity(f.roots[0]);
  if (!durable) throw Error("Missing durable root fixture");
  const probe = createMarkdownBlockAnchorProbe(root.text);
  const position =
    probe.status === "ready" &&
    encodeMainTabPosition(probe.capturePosition(directoryGeometry));
  if (
    !position ||
    position.block?.contentHash !== root.hash ||
    position.block.offset !== directoryGeometry.offset
  )
    throw Error("Missing measured block fixture");
  const row = {
    rootId: durable.id,
    relativePath: "a.md",
    fingerprint: fileFingerprint(await lstat(f.files[0], { bigint: true })),
    pinned: true,
    mode: "source" as const,
    position,
  };
  const path = join(f.settingsDir, directoryName);
  const bytes = envelope({ schemaVersion: 2, tabs: [row], activeIndex: 0 });
  await writeFile(path, bytes);
  return { row, path, bytes };
}

test("mixed positions follow the authorized file through inheritance, reordering and a real content revision", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const [root, standalone] = await openMixed(f);
    const old = await seedPositionedDirectory(f, root);
    const standaloneRow = {
      kind: "standalone" as const,
      path: f.explicitPath,
      fingerprint: fileFingerprint(
        await lstat(f.explicitPath, { bigint: true })
      ),
      mode: "editing" as const,
      pinned: false,
      position: standaloneGeometry,
    };
    const initial: MixedMainTabMetadata = {
      schemaVersion: 3,
      tabs: [{ kind: "root", ...old.row, mode: "editing" }, standaloneRow],
      activeIndex: 0,
    };
    expect(
      await writer.write(
        {
          tabs: [
            inputTab(root, "editing", true),
            { ...inputTab(standalone), viewport: standaloneGeometry },
          ],
          activeIndex: 0,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "mixed",
      data: initial,
    });
    const officialPath = join(f.settingsDir, officialName);
    const initialBytes = await readFile(officialPath);

    const reordered: MixedMainTabMetadata = {
      schemaVersion: 3,
      tabs: [
        { ...standaloneRow, mode: "source", pinned: true },
        { kind: "root", ...old.row, pinned: false },
      ],
      activeIndex: 1,
    };
    expect(
      await writer.write(
        {
          tabs: [
            inputTab(standalone, "source", true),
            { ...inputTab(root, "source"), viewport: directoryGeometry },
          ],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(await readFile(`${officialPath}.bak`)).toEqual(initialBytes);
    const expectedPath = join(
      f.settingsDir,
      "expected-positioned-fixture.json"
    );
    await writeFile(expectedPath, JSON.stringify(reordered));
    expect(await childRead(f.settingsDir, expectedPath)).toEqual({
      status: "valid",
      matches: true,
    });
    expect(await readFile(old.path)).toEqual(old.bytes);
    expect(await readFile(f.files[0])).toEqual(Buffer.from(text));
    expect(await readFile(f.explicitPath)).toEqual(Buffer.from(text));

    const revisedText = `${text}\n## 外部新增\n`;
    await writeFile(f.files[0], revisedText);
    const revised = await f.documents.read({
      ...request(),
      handle: root.handle,
    });
    if (!revised.ok || !revised.snapshot)
      throw Error("Could not read changed directory fixture");
    expect(revised.snapshot.documentId).toBe(root.documentId);
    expect(revised.snapshot.hash).not.toBe(root.hash);
    expect(
      await writer.write(
        {
          tabs: [
            inputTab(standalone, "source", true),
            {
              ...inputTab(revised.snapshot, "source"),
              viewport: directoryGeometry,
            },
          ],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "mixed",
      data: {
        ...reordered,
        tabs: [
          reordered.tabs[0],
          { ...reordered.tabs[1], position: directoryGeometry },
        ],
      },
    });
    expect(await readFile(old.path)).toEqual(old.bytes);
    expect(await readFile(f.files[0])).toEqual(Buffer.from(revisedText));
  } finally {
    await writer.close();
    await f.close();
  }
});

test("an owned reset follows the reordered target, preserves the peer, and cannot inherit to a replacement file", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  const other = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const path = join(dirname(f.settingsDir), "outside.md");
    await writeFile(path, text);
    const root = await f.openFolderTab(0);
    const former = await f.openExplicit(path);
    const priorFingerprint = fileFingerprint(
      await lstat(path, { bigint: true })
    );
    const input = {
      tabs: [
        { ...inputTab(root), viewport: directoryGeometry },
        { ...inputTab(former), viewport: standaloneGeometry },
      ],
      activeIndex: 1,
    };
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const officialPath = join(f.settingsDir, officialName);
    const reordered = {
      tabs: [inputTab(former, "source", true), inputTab(root)],
      activeIndex: 0,
    };
    expect(await writer.write(reordered, () => true)).toEqual({
      status: "committed",
    });
    const beforeReset = await readFile(officialPath);
    const saved = await writer.read();
    if (saved.status !== "valid")
      throw Error("Missing positioned mixed checkpoint");
    expect(saved.data.tabs.map((tab) => tab.position)).toEqual([
      standaloneGeometry,
      directoryGeometry,
    ]);
    expect(
      await writer.write(
        {
          tabs: [
            { ...reordered.tabs[0], resetViewport: true },
            reordered.tabs[1],
          ],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    const cleared = await writer.read();
    if (cleared.status !== "valid")
      throw Error("Missing cleared mixed checkpoint");
    expect(cleared.data.activeIndex).toBe(1);
    expect(cleared.data.tabs[0]).toEqual({
      kind: "standalone",
      path,
      fingerprint: priorFingerprint,
      pinned: true,
      mode: "source",
    });
    expect(cleared.data.tabs[1]).toEqual(saved.data.tabs[1]);
    expect(await readFile(`${officialPath}.bak`)).toEqual(beforeReset);
    const expectedPath = join(f.settingsDir, "expected-reset-fixture.json");
    await writeFile(expectedPath, JSON.stringify(cleared.data));
    expect(await childRead(f.settingsDir, expectedPath)).toEqual({
      status: "valid",
      matches: true,
    });

    expect(
      await writer.write(
        {
          tabs: [
            { ...reordered.tabs[0], viewport: standaloneGeometry },
            reordered.tabs[1],
          ],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    const beforeReplacement = await readFile(officialPath);

    await rename(path, `${path}.prior`);
    await writeFile(path, text);
    const replacement = await f.openExplicit(path);
    const currentFingerprint = fileFingerprint(
      await lstat(path, { bigint: true })
    );
    expect(replacement.documentId).not.toBe(former.documentId);
    expect(replacement.displayPath).toBe(former.displayPath);
    expect(currentFingerprint).not.toBe(priorFingerprint);
    expect(
      await other.write(
        {
          tabs: [
            inputTab(root),
            { ...inputTab(replacement), resetViewport: true },
          ],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    const current = await writer.read();
    if (current.status !== "valid")
      throw Error("Missing replacement mixed checkpoint");
    expect(current.data.tabs[1]).toEqual({
      kind: "standalone",
      path,
      fingerprint: currentFingerprint,
      pinned: false,
      mode: "editing",
    });
    expect(current.data.tabs[0]).toEqual(saved.data.tabs[1]);
    expect(await readFile(`${officialPath}.bak`)).toEqual(beforeReplacement);
  } finally {
    await other.close();
    await writer.close();
    await f.close();
  }
});

test("no-op writes do not claim ownership, exact external changes and a late competitor protect old mixed positions", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  const other = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const [root, standalone] = await openMixed(f);
    const input = {
      tabs: [
        { ...inputTab(root), viewport: directoryGeometry },
        { ...inputTab(standalone), viewport: standaloneGeometry },
      ],
      activeIndex: 1,
    };
    const reset = {
      tabs: [{ ...inputTab(root), resetViewport: true }, inputTab(standalone)],
      activeIndex: 0,
    };
    const path = join(f.settingsDir, officialName);
    const backup = `${path}.bak`;
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const before = await readFile(path);
    const saved = await other.read();
    if (saved.status !== "valid") throw Error("Missing saved mixed positions");
    const backupSentinel = Buffer.from("earlier backup\n");
    await writeFile(backup, backupSentinel);
    expect(await other.write(input, () => true)).toEqual({
      status: "committed",
    });
    expect(await other.write(reset, () => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(backup)).toEqual(backupSentinel);

    const reformatted = envelope(saved.data);
    expect(reformatted).not.toEqual(before);
    await writeFile(path, reformatted);
    expect(await writer.write(reset, () => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(path)).toEqual(reformatted);
    expect(await readFile(backup)).toEqual(backupSentinel);

    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(backup)).toEqual(reformatted);
    const newer = envelope({ ...saved.data, activeIndex: 0 });
    let observed: Buffer | undefined;
    const result = await writer.write(reset, () => {
      if (observed) return true;
      const staged = readdirSync(f.settingsDir).find(
        (file) =>
          file.startsWith(`${officialName}.`) &&
          !file.startsWith(`${officialName}.bak.`) &&
          file.endsWith(".tmp")
      );
      if (!staged) return true;
      const prepared = readFileSync(join(f.settingsDir, staged));
      writeFileSync(path, newer);
      observed = prepared;
      return true;
    });
    if (!observed) throw Error("No late competitor before publishing reset");
    const { position, ...resetRow } = saved.data.tabs[0];
    expect(position).toEqual(directoryGeometry);
    expect(JSON.parse(observed.toString("utf8"))).toEqual({
      version: 1,
      data: {
        ...saved.data,
        activeIndex: 0,
        tabs: [resetRow, saved.data.tabs[1]],
      },
    });
    expect(result).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(path)).toEqual(newer);
    expect(await readFile(backup)).toEqual(before);
    await writeFile(path, before);
    expect(await writer.write(reset, () => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(backup)).toEqual(before);
  } finally {
    await other.close();
    await writer.close();
    await f.close();
  }
});

test("the first mixed write cannot clear a directory position, and an owned new measurement does not reuse its old block", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const [root, standalone] = await openMixed(f);
    const old = await seedPositionedDirectory(f, root);
    const input = {
      tabs: [inputTab(root), inputTab(standalone)],
      activeIndex: 0,
    };
    for (const viewport of [undefined, directoryGeometry]) {
      expect(
        await writer.write(
          {
            tabs: [
              {
                ...input.tabs[0],
                resetViewport: true,
                ...(viewport ? { viewport } : {}),
              },
              input.tabs[1],
            ],
            activeIndex: 0,
          },
          () => true
        )
      ).toEqual({ status: "rejected", reason: "not-owned" });
    }
    expect(await readFile(old.path)).toEqual(old.bytes);
    expect(
      (await readdir(f.settingsDir)).filter((file) =>
        file.startsWith(officialName)
      )
    ).toEqual([]);
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const path = join(f.settingsDir, officialName);
    const inherited = await readFile(path);
    expect(await writer.read()).toMatchObject({
      status: "valid",
      source: "mixed",
      data: { tabs: [{ position: old.row.position }, {}] },
    });
    expect(
      await writer.write(
        {
          tabs: [
            {
              ...input.tabs[0],
              resetViewport: true,
              viewport: directoryGeometry,
            },
            input.tabs[1],
          ],
          activeIndex: 0,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    const replaced = await writer.read();
    if (replaced.status !== "valid")
      throw Error("Missing newly measured position");
    expect(replaced.data.tabs[0].position).toEqual(directoryGeometry);
    expect(await readFile(`${path}.bak`)).toEqual(inherited);
    expect(await readFile(old.path)).toEqual(old.bytes);
  } finally {
    await writer.close();
    await f.close();
  }
});

test("changing the directory checkpoint during first mixed publication preserves the newer directory bytes", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const [root, standalone] = await openMixed(f);
    const old = await seedPositionedDirectory(f, root);
    const backupBytes = Buffer.from("directory backup sentinel\n");
    await writeFile(`${old.path}.bak`, backupBytes);
    const newer = envelope({
      schemaVersion: 2,
      tabs: [{ ...old.row, position: { from: 2, offset: 1, ratio: 0.25 } }],
      activeIndex: 0,
    });
    let observed: Buffer | undefined;
    const result = await writer.write(
      { tabs: [inputTab(root), inputTab(standalone)], activeIndex: 1 },
      () => {
        if (observed) return true;
        const staged = readdirSync(f.settingsDir).find(
          (file) =>
            file.startsWith(`${officialName}.`) &&
            !file.startsWith(`${officialName}.bak.`) &&
            file.endsWith(".tmp")
        );
        if (!staged) return true;
        const prepared = readFileSync(join(f.settingsDir, staged));
        writeFileSync(old.path, newer);
        observed = prepared;
        return true;
      }
    );
    if (!observed)
      throw Error("No staged first mixed write before directory change");
    expect(JSON.parse(observed.toString("utf8"))).toMatchObject({
      data: { tabs: [{ position: old.row.position }, {}] },
    });
    expect(result).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(old.path)).toEqual(newer);
    expect(await readFile(`${old.path}.bak`)).toEqual(backupBytes);
    expect(
      (await readdir(f.settingsDir)).filter((file) =>
        file.startsWith(officialName)
      )
    ).toEqual([]);
  } finally {
    await writer.close();
    await f.close();
  }
});

async function observeSources(
  f: Awaited<ReturnType<typeof fixture>>,
  snapshots: readonly DocumentSnapshot[]
) {
  for (const { handle, documentId, revision, hash } of snapshots)
    expect(
      (
        await f.documents.observe({
          ...request(),
          handle,
          documentId,
          revision,
          hash,
          active: true,
          watchToken: crypto.randomUUID(),
          watchEpoch: 1,
        })
      ).ok
    ).toBe(true);
}

test("the actual worker anchors one measured mixed source at a time, preferring the active source", async () => {
  const f = await fixture();
  const sources: string[] = [];
  const workerResults: boolean[] = [];
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, {
    ...f,
    captureViewportSource(tab, current) {
      sources.push(tab.handle);
      return f.documents.captureViewportSource(tab, current, "mixed");
    },
    async captureViewportAnchor(raw, viewport, signal) {
      const result = await captureMainTabBlockAnchor(raw, viewport, signal);
      workerResults.push(!!result?.block);
      return result;
    },
  });
  try {
    const standaloneText = "\uFEFF前段 😀\r\n\r\n## 独立目标\r\n\r\n后段\r\n";
    await writeFile(f.explicitPath, standaloneText);
    const [root, standalone] = await openMixed(f);
    await observeSources(f, [root, standalone]);
    expect(
      await f.documents.captureViewportSource(inputTab(standalone), () => true)
    ).toBeUndefined();
    const mixedProof = await f.documents.captureViewportSource(
      inputTab(standalone),
      () => true,
      "mixed"
    );
    expect(mixedProof?.raw).toBe(standaloneText);
    expect(mixedProof?.current()).toBe(true);
    const explicitGeometry = {
      from: standaloneText.indexOf("##"),
      offset: -6.25,
      ratio: 0.55,
    };
    const first = {
      tabs: [
        { ...inputTab(root, "source", true), viewport: directoryGeometry },
        { ...inputTab(standalone), viewport: explicitGeometry },
      ],
      activeIndex: 1,
    };
    expect(await writer.write(first, () => true)).toEqual({
      status: "committed",
    });
    expect(sources).toEqual([standalone.handle]);
    expect(workerResults).toEqual([true]);
    let state = await writer.read();
    if (state.status !== "valid")
      throw Error("Missing first mixed anchor record");
    expect(state.data.tabs[0].position).toEqual(directoryGeometry);
    expect(state.data.tabs[1].position).toMatchObject({
      ...explicitGeometry,
      block: {
        contentHash: standalone.hash,
        uniqueAtCapture: true,
        offset: explicitGeometry.offset,
      },
    });
    const standalonePosition = state.data.tabs[1].position;

    const newRootGeometry = { ...directoryGeometry, offset: -5.5, ratio: 0.7 };
    const second = {
      tabs: [{ ...first.tabs[0], viewport: newRootGeometry }, first.tabs[1]],
      activeIndex: 0,
    };
    expect(await writer.write(second, () => true)).toEqual({
      status: "committed",
    });
    expect(sources).toEqual([standalone.handle, root.handle]);
    expect(workerResults).toEqual([true, true]);
    expect(
      await writer.write({ ...second, activeIndex: 1 }, () => true)
    ).toEqual({ status: "committed" });
    expect(sources).toEqual([standalone.handle, root.handle]);
    expect(workerResults).toEqual([true, true]);
    state = await writer.read();
    if (state.status !== "valid") throw Error("Missing both mixed anchors");
    expect(state.data.tabs[0].position).toMatchObject({
      ...newRootGeometry,
      block: {
        contentHash: root.hash,
        uniqueAtCapture: true,
        offset: newRootGeometry.offset,
      },
    });
    expect(state.data.tabs[1].position).toEqual(standalonePosition);
    const expected = join(f.settingsDir, "expected-anchor-fixture.json");
    await writeFile(expected, JSON.stringify(state.data));
    expect(await childRead(f.settingsDir, expected)).toEqual({
      status: "valid",
      matches: true,
    });

    const endGeometry = { from: standaloneText.length, offset: 1.5, ratio: 1 };
    expect(
      await writer.write(
        {
          tabs: [second.tabs[0], { ...second.tabs[1], viewport: endGeometry }],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(sources).toEqual([
      standalone.handle,
      root.handle,
      standalone.handle,
    ]);
    expect(workerResults).toEqual([true, true, false]);
    const fallback = await writer.read();
    if (fallback.status !== "valid") throw Error("Missing EOF geometry");
    expect(fallback.data.tabs[1].position).toEqual(endGeometry);
    expect(fallback.data.tabs[0].position).toEqual(state.data.tabs[0].position);
    expect(await readFile(f.explicitPath)).toEqual(Buffer.from(standaloneText));
    expect(await readFile(f.files[0])).toEqual(Buffer.from(text));
  } finally {
    await writer.close();
    await f.close();
  }
});

test("replacing a trusted standalone source while its actual worker result is held preserves mixed authority and backup", async () => {
  const f = await fixture();
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  let replaced = false;
  let sourceCurrentAfterReplacement: boolean | undefined;
  let computedContentHash: string | undefined;
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, {
    ...f,
    async captureViewportSource(tab, current) {
      const proof = await f.documents.captureViewportSource(
        tab,
        current,
        "mixed"
      );
      if (!proof) return;
      return {
        raw: proof.raw,
        current() {
          const valid = proof.current();
          if (replaced) sourceCurrentAfterReplacement = valid;
          return valid;
        },
      };
    },
    async captureViewportAnchor(raw, viewport, signal) {
      const actual = captureMainTabBlockAnchor(raw, viewport, signal);
      entered.resolve();
      await resume.promise;
      const result = await actual;
      computedContentHash = result?.block?.contentHash;
      return result;
    },
  });
  try {
    const root = await f.openFolderTab(0);
    const path = join(dirname(f.settingsDir), "outside-anchor.md");
    await writeFile(path, text);
    const standalone = await f.openExplicit(path);
    await observeSources(f, [root, standalone]);
    const input = {
      tabs: [inputTab(root), inputTab(standalone)],
      activeIndex: 1,
    };
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const authority = join(f.settingsDir, officialName);
    const backup = `${authority}.bak`;
    const before = await readFile(authority);
    const backupBytes = Buffer.from("retained mixed backup\n");
    await writeFile(backup, backupBytes);
    const pending = writer.write(
      {
        tabs: [
          input.tabs[0],
          { ...input.tabs[1], viewport: directoryGeometry },
        ],
        activeIndex: 1,
      },
      () => true
    );
    await Promise.race([
      entered.promise,
      pending.then((result) => {
        throw Error(`Write settled before worker pause: ${result.status}`);
      }),
    ]);
    const registry = f.documents.captureContentSearchBindings([
      root.handle,
      standalone.handle,
    ]);
    const displaced = `${path}.prior`;
    const replacement = "# 另一篇文档\n";
    renameSync(path, displaced);
    writeFileSync(path, replacement);
    replaced = true;
    expect(registry?.current()).toBe(true);
    resume.resolve();
    expect(await pending).toEqual({ status: "rejected", reason: "stale" });
    expect(computedContentHash).toBe(standalone.hash);
    expect(sourceCurrentAfterReplacement).toBe(false);
    expect(await readFile(authority)).toEqual(before);
    expect(await readFile(backup)).toEqual(backupBytes);
    expect(await readFile(displaced)).toEqual(Buffer.from(text));
    expect(await readFile(path)).toEqual(Buffer.from(replacement));
  } finally {
    resume.resolve();
    await writer.close();
    await f.close();
  }
});

test("owned mixed prune uses released handles, preserves positioned peers, and ends with an authoritative empty record", async () => {
  const f = await fixture();
  let binds = 0;
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, {
    ...f,
    documents: {
      captureContentSearchBindings(handles) {
        binds++;
        return f.documents.captureContentSearchBindings(handles);
      },
    },
    workspace: {
      captureMainTabSources(...args) {
        binds++;
        return f.workspace.captureMainTabSources(...args);
      },
    },
  });
  try {
    const [first, standalone] = await openMixed(f);
    const last = await f.openFolderTab(1);
    const oldDirectory = await seedPositionedDirectory(f, first);
    const lastGeometry = { from: 2, offset: 4.5, ratio: 0.75 };
    expect(
      await writer.write(
        {
          tabs: [
            inputTab(first, "source", true),
            { ...inputTab(standalone, "source"), viewport: standaloneGeometry },
            { ...inputTab(last), viewport: lastGeometry },
          ],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "committed" });
    expect(binds).toBeGreaterThan(0);
    const previousBinds = binds;
    const original = await writer.read();
    if (original.status !== "valid") throw Error("Missing three mixed rows");
    expect(original.data.tabs.map((row) => row.position)).toEqual([
      oldDirectory.row.position,
      standaloneGeometry,
      lastGeometry,
    ]);
    const path = join(f.settingsDir, officialName);
    const backup = `${path}.bak`;
    const threeBytes = await readFile(path);

    expect(
      (await f.documents.release({ ...request(), handle: standalone.handle }))
        .ok
    ).toBe(true);
    expect(
      f.documents.locations().some(({ handle }) => handle === standalone.handle)
    ).toBe(false);
    expect(await writer.prune(closedTab(standalone), () => true)).toEqual({
      status: "committed",
    });
    const successor: MixedMainTabMetadata = {
      schemaVersion: 3,
      tabs: [original.data.tabs[0], original.data.tabs[2]],
      activeIndex: 1,
    };
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "mixed",
      data: successor,
    });
    expect(await readFile(backup)).toEqual(threeBytes);
    const expectedPath = join(f.settingsDir, "expected-pruned-fixture.json");
    await writeFile(expectedPath, JSON.stringify(successor));
    expect(await childRead(f.settingsDir, expectedPath)).toEqual({
      status: "valid",
      matches: true,
    });
    const twoBytes = await readFile(path);

    expect(
      (await f.documents.release({ ...request(), handle: last.handle })).ok
    ).toBe(true);
    expect(await writer.prune(closedTab(last), () => true)).toEqual({
      status: "committed",
    });
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "mixed",
      data: { schemaVersion: 3, tabs: [original.data.tabs[0]], activeIndex: 0 },
    });
    expect(await readFile(backup)).toEqual(twoBytes);
    const oneBytes = await readFile(path);

    expect(
      (await f.documents.release({ ...request(), handle: first.handle })).ok
    ).toBe(true);
    expect(await writer.prune(closedTab(first), () => true)).toEqual({
      status: "committed",
    });
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "mixed",
      data: empty,
    });
    expect(await readFile(backup)).toEqual(oneBytes);
    expect(await readFile(oldDirectory.path)).toEqual(oldDirectory.bytes);
    expect(binds).toBe(previousBinds);
    expect(f.documents.locations()).toEqual([]);
    for (const source of [...f.files, f.explicitPath])
      expect(await readFile(source)).toEqual(Buffer.from(text));
  } finally {
    await writer.close();
    await f.close();
  }
});

test("mixed close rejects a wrong handle, a no-op peer, cancellation and a late external writer", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  const other = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
  try {
    const [root, standalone] = await openMixed(f);
    const input = {
      tabs: [
        { ...inputTab(root), viewport: directoryGeometry },
        { ...inputTab(standalone), viewport: standaloneGeometry },
      ],
      activeIndex: 1,
    };
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const path = join(f.settingsDir, officialName);
    const backup = `${path}.bak`;
    const before = await readFile(path);
    const backupSentinel = Buffer.from("kept backup\n");
    await writeFile(backup, backupSentinel);
    expect(await other.write(input, () => true)).toEqual({
      status: "committed",
    });
    expect(await other.prune(closedTab(root), () => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await other.clear(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(
      await writer.prune(
        { documentId: root.documentId, handle: standalone.handle },
        () => true
      )
    ).toEqual({ status: "rejected", reason: "not-owned" });
    expect(await writer.prune(closedTab(root), () => false)).toEqual({
      status: "rejected",
      reason: "stale",
    });
    expect(await writer.clear(() => false)).toEqual({
      status: "rejected",
      reason: "stale",
    });
    expect(await readFile(path)).toEqual(before);
    expect(await readFile(backup)).toEqual(backupSentinel);

    const saved = await writer.read();
    if (saved.status !== "valid") throw Error("Missing positioned mixed rows");
    const competing = envelope({ ...saved.data, activeIndex: 0 });
    let proposed: Buffer | undefined;
    const late = await writer.prune(closedTab(root), () => {
      if (proposed) return true;
      const staged = readdirSync(f.settingsDir).find(
        (file) =>
          file.startsWith(`${officialName}.`) &&
          !file.startsWith(`${officialName}.bak.`) &&
          file.endsWith(".tmp")
      );
      if (!staged) return true;
      const candidate = readFileSync(join(f.settingsDir, staged));
      writeFileSync(path, competing);
      proposed = candidate;
      return true;
    });
    if (!proposed)
      throw Error("Missing late competitor before prune publication");
    expect(JSON.parse(proposed.toString("utf8"))).toEqual({
      version: 1,
      data: { schemaVersion: 3, tabs: [saved.data.tabs[1]], activeIndex: 0 },
    });
    expect(late).toEqual({ status: "rejected", reason: "stale" });
    expect(await readFile(path)).toEqual(competing);
    expect(await readFile(backup)).toEqual(before);
    await writeFile(path, before);
    expect(await writer.clear(() => true)).toEqual({
      status: "rejected",
      reason: "not-owned",
    });
    expect(await readFile(path)).toEqual(before);

    expect(
      await writer.write({ ...input, activeIndex: 0 }, () => true)
    ).toEqual({ status: "committed" });
    const owned = await readFile(path);
    for (const file of [root, standalone])
      expect(
        (await f.documents.release({ ...request(), handle: file.handle })).ok
      ).toBe(true);
    expect(await writer.clear(() => true)).toEqual({ status: "committed" });
    expect(await writer.read()).toEqual({
      status: "valid",
      source: "mixed",
      data: empty,
    });
    expect(await readFile(backup)).toEqual(owned);
  } finally {
    await other.close();
    await writer.close();
    await f.close();
  }
});
