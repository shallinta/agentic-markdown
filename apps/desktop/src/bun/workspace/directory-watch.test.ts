import { afterEach, beforeEach, expect, test } from "bun:test";
import { fstatSync } from "node:fs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileFingerprint } from "../documents/path-authorization";

import { authorizeRoot } from "./authorization";
import { createDirectoryWatch } from "./directory-watch";

const nativePath = join(
  import.meta.dir,
  "../../../dist-native/save-primitives.node"
);
let directory: string, watch: ReturnType<typeof createDirectoryWatch>;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "watch-inventory-"));
  watch = createDirectoryWatch(nativePath);
});
afterEach(async () => {
  watch.close();
  await rm(directory, { recursive: true, force: true });
});
async function settle(key: string) {
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const result = await watch.tick(2 * 1024 * 1024);
    seen.push(result);
    if (result.roots.find((root) => root.key === key)?.status === "watching")
      return seen;
  }
  throw Error("watch not established");
}
test("complete empty inventory catches initial and newly nested directories without perpetual dirty", async () => {
  await mkdir(join(directory, "empty"));
  watch.add("root", await authorizeRoot(directory), false);
  const initial = await settle("root");
  expect(initial.some((result) => result.roots[0].dirty)).toBe(true);
  for (let i = 0; i < 8; i++)
    expect((await watch.tick(2 * 1024 * 1024)).roots[0].dirty).toBe(false);
  await mkdir(join(directory, "empty/new/deep"), { recursive: true });
  await writeFile(join(directory, "empty/new/deep/first.md"), "first");
  let dirty = 0;
  for (let i = 0; i < 15; i++)
    dirty += Number((await watch.tick(2 * 1024 * 1024)).roots[0].dirty);
  expect(dirty).toBeGreaterThan(0);
  await writeFile(join(directory, "empty/new/deep/second.md"), "second");
  dirty = 0;
  for (let i = 0; i < 15; i++)
    dirty += Number((await watch.tick(2 * 1024 * 1024)).roots[0].dirty);
  expect(dirty).toBeGreaterThan(0);
  for (let i = 0; i < 8; i++)
    expect((await watch.tick(2 * 1024 * 1024)).roots[0].dirty).toBe(false);
});
test("hidden/.git/symlink enumeration excludes registrations; policy epoch can reinstall", async () => {
  await mkdir(join(directory, ".hidden"));
  await mkdir(join(directory, ".git"));
  await symlink(join(directory, ".hidden"), join(directory, "alias"));
  const authorization = await authorizeRoot(directory);
  watch.close();
  const registered: string[] = [];
  watch = createDirectoryWatch(nativePath, (item, fd) => {
    expect(fileFingerprint(fstatSync(fd, { bigint: true }))).toBe(
      item.chain.length
        ? item.chain[item.chain.length - 1].fingerprint
        : authorization.directories[authorization.directories.length - 1]
            .fingerprint
    );
    registered.push(item.path);
  });
  watch.add("old", authorization, false);
  await settle("old");
  expect(registered).toEqual([authorization.path]);
  const without = watch.bytes();
  watch.remove("old");
  registered.length = 0;
  watch.add("new", authorization, true);
  await settle("new");
  expect(registered.sort()).toEqual(
    [authorization.path, join(authorization.path, ".hidden")].sort()
  );
  expect(watch.bytes()).toBeGreaterThan(without);
  // Two allowed directories, not .git or the alias. Actual native count checked separately.
  watch.remove("new");
  expect(watch.bytes()).toBe(0);
  expect((await watch.tick(2 * 1024 * 1024)).roots).toEqual([]);
});
test("root replacement degrades rather than authorizing replacement; metadata budget fails closed", async () => {
  const root = join(directory, "root");
  await mkdir(root);
  watch.add("root", await authorizeRoot(root), false);
  await settle("root");
  await rename(root, join(directory, "old"));
  await mkdir(root);
  expect((await watch.tick(2 * 1024 * 1024)).roots[0].status).toBe("limited");
  watch.remove("root");
  watch.add("replacement", await authorizeRoot(root), false);
  expect((await watch.tick(2 * 1024 * 1024, 0)).roots[0].status).toBe(
    "limited"
  );
});
