import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readMainTabCheckpointCoexistence } from "./main-tab-checkpoint-coexistence";
import {
  createMainTabCheckpointMetadataStore,
  type MainTabSessionMetadata,
  type PositionedMainTabSessionMetadata,
} from "./main-tab-metadata";
import type { MixedMainTabMetadata } from "./main-tab-mixed-metadata";
import { createMixedMainTabMetadataStore } from "./main-tab-mixed-metadata-store";

const directoryFile = "main-tab-session-checkpoint.json";
const mixedFile = "main-tab-session-mixed-probe.json";
const row = {
  rootId: "00000000-0000-4000-8000-000000000001",
  relativePath: "old.md",
  fingerprint: "1:2:3",
  pinned: true,
  mode: "source",
} as const;
const v1: MainTabSessionMetadata = { tabs: [row], activeIndex: 0 };
const v2: PositionedMainTabSessionMetadata = {
  schemaVersion: 2,
  tabs: [{ ...row, position: { from: 42, offset: -3.5, ratio: 0.4 } }],
  activeIndex: 0,
};
const mixedTabs: MixedMainTabMetadata = {
  schemaVersion: 3,
  tabs: [
    { kind: "root", ...row, relativePath: "mixed.md" },
    {
      kind: "standalone",
      path: "/synthetic/独立.md",
      fingerprint: "1:4:5",
      pinned: false,
      mode: "editing",
    },
  ],
  activeIndex: 1,
};
const emptyMixed: MixedMainTabMetadata = {
  schemaVersion: 3,
  tabs: [],
  activeIndex: null,
};
const encode = (data: unknown) =>
  Buffer.from(` {"data":${JSON.stringify(data)},"version":1}\r\n`);

async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "checkpoint-coexistence-"));
  const directory = createMainTabCheckpointMetadataStore(path);
  const mixed = createMixedMainTabMetadataStore(path);
  return {
    path,
    directory,
    mixed,
    directoryPath: join(path, directoryFile),
    mixedPath: join(path, mixedFile),
    async close() {
      await Promise.all([mixed.close(), directory.close()]);
      await rm(path, { recursive: true, force: true });
    },
  };
}

test("a valid mixed record, even when empty, wins without reading the old directory checkpoint", async () => {
  const f = await fixture();
  try {
    const oldBytes = encode(v2);
    await writeFile(f.directoryPath, oldBytes);
    const backup = `${f.mixedPath}.bak`;
    const backupBytes = encode(mixedTabs);
    await writeFile(backup, backupBytes);
    let directoryReads = 0;
    const directory = {
      read() {
        directoryReads++;
        return f.directory.read();
      },
    };
    for (const data of [mixedTabs, emptyMixed]) {
      const bytes = encode(data);
      await writeFile(f.mixedPath, bytes);
      expect(
        await readMainTabCheckpointCoexistence({ mixed: f.mixed, directory })
      ).toEqual({ status: "valid", source: "mixed", data });
      expect(await readFile(f.mixedPath)).toEqual(bytes);
    }
    expect(directoryReads).toBe(0);
    expect(await readFile(f.directoryPath)).toEqual(oldBytes);
    expect(await readFile(backup)).toEqual(backupBytes);
    expect((await readdir(f.path)).sort()).toEqual(
      [directoryFile, mixedFile + ".bak", mixedFile].sort()
    );
  } finally {
    await f.close();
  }
});

test("only a missing mixed authority falls back to the old directory format, with no migration", async () => {
  const f = await fixture();
  try {
    const backup = `${f.mixedPath}.bak`;
    const backupBytes = encode(mixedTabs);
    await writeFile(backup, backupBytes);
    for (const old of [v1, v2]) {
      const oldBytes = encode(old);
      await writeFile(f.directoryPath, oldBytes);
      const projected: MixedMainTabMetadata = {
        schemaVersion: 3,
        tabs: old.tabs.map((tab) => ({ kind: "root", ...tab })),
        activeIndex: 0,
      };
      expect(await readMainTabCheckpointCoexistence(f)).toEqual({
        status: "valid",
        source: "directory",
        data: projected,
      });
      expect(await readFile(f.directoryPath)).toEqual(oldBytes);
      expect(await readFile(backup)).toEqual(backupBytes);
      expect((await readdir(f.path)).sort()).toEqual([
        directoryFile,
        `${mixedFile}.bak`,
      ]);
    }
    await rm(f.directoryPath);
    expect(await readMainTabCheckpointCoexistence(f)).toEqual({
      status: "missing",
    });
  } finally {
    await f.close();
  }
});

test("future and corrupt mixed authorities preserve their errors and bytes despite valid older records", async () => {
  const f = await fixture();
  try {
    const oldBytes = encode(v2);
    await writeFile(f.directoryPath, oldBytes);
    let directoryReads = 0;
    const directory = {
      read() {
        directoryReads++;
        return f.directory.read();
      },
    };
    for (const [bytes, status] of [
      [encode({ schemaVersion: 4, tabs: [] }), "future"],
      [Buffer.from('{"version":2,"data":{}}\n'), "future"],
      [Buffer.from("{broken\r\n"), "corrupt"],
    ] as const) {
      await writeFile(f.mixedPath, bytes);
      expect(
        await readMainTabCheckpointCoexistence({ mixed: f.mixed, directory })
      ).toEqual({ status });
      expect(await readFile(f.mixedPath)).toEqual(bytes);
      expect(await readFile(f.directoryPath)).toEqual(oldBytes);
    }
    expect(directoryReads).toBe(0);
    expect((await readdir(f.path)).sort()).toEqual([directoryFile, mixedFile]);
  } finally {
    await f.close();
  }
});

test("a mixed authority first appearing while the directory response is held supersedes it", async () => {
  const f = await fixture();
  try {
    const oldBytes = encode(v2);
    await writeFile(f.directoryPath, oldBytes);
    for (const late of ["valid", "corrupt"] as const) {
      const entered = Promise.withResolvers<void>();
      const resume = Promise.withResolvers<void>();
      const pending = readMainTabCheckpointCoexistence({
        mixed: f.mixed,
        directory: {
          async read() {
            const prior = await f.directory.read();
            entered.resolve();
            await resume.promise;
            return prior;
          },
        },
      });
      try {
        await Promise.race([
          entered.promise,
          pending.then(() => {
            throw Error("Read settled before directory pause");
          }),
        ]);
        if (late === "valid")
          expect(await f.mixed.write(mixedTabs, () => true)).toEqual({
            status: "committed",
          });
        else await writeFile(f.mixedPath, "{late corrupt\r\n");
        const published = await readFile(f.mixedPath);
        resume.resolve();
        expect(await pending).toEqual(
          late === "valid"
            ? { status: "valid", source: "mixed", data: mixedTabs }
            : { status: "corrupt" }
        );
        expect(await readFile(f.mixedPath)).toEqual(published);
        expect(await readFile(f.directoryPath)).toEqual(oldBytes);
        expect((await readdir(f.path)).sort()).toEqual([
          directoryFile,
          mixedFile,
        ]);
      } finally {
        resume.resolve();
      }
      await rm(f.mixedPath);
    }
  } finally {
    await f.close();
  }
});
