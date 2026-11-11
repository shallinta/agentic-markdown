import { expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
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

test("reset intents are rejected and a new file at the same standalone path does not inherit its predecessor's position", async () => {
  const f = await fixture();
  const writer = createGuardedMixedMainTabCheckpoint(f.settingsDir, f);
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
        inputTab(root),
        { ...inputTab(former), viewport: standaloneGeometry },
      ],
      activeIndex: 1,
    };
    expect(await writer.write(input, () => true)).toEqual({
      status: "committed",
    });
    const officialPath = join(f.settingsDir, officialName);
    const before = await readFile(officialPath);
    expect(await writer.read()).toMatchObject({
      status: "valid",
      source: "mixed",
      data: { tabs: [{}, { position: standaloneGeometry }] },
    });
    expect(
      await writer.write(
        {
          tabs: [input.tabs[0], { ...input.tabs[1], resetViewport: true }],
          activeIndex: 1,
        },
        () => true
      )
    ).toEqual({ status: "rejected", reason: "invalid" });
    expect(await readFile(officialPath)).toEqual(before);

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
      await writer.write(
        { tabs: [inputTab(root), inputTab(replacement)], activeIndex: 1 },
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
    expect(await readFile(`${officialPath}.bak`)).toEqual(before);
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
