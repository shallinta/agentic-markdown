import { expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { lstat, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fileFingerprint } from "../documents/path-authorization";

import { createGuardedMixedMainTabCheckpoint } from "./main-tab-mixed-checkpoint";
import type { MixedMainTabMetadata } from "./main-tab-mixed-metadata";
import {
  fixture,
  inputTab,
  request,
  text,
} from "./main-tab-mixed-test-fixture";

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
