import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { openSync, closeSync, constants } from "node:fs";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rename,
  rm,
  readFile,
  stat,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  WorkspaceResponse,
  WorkspaceNode,
  WorkspaceRoot,
} from "../../shared/workspace";
import { createDocumentService } from "../documents";

import { authorizeRoot } from "./authorization";
import { createScan } from "./scan";

import { createWorkspaceService } from ".";

let directory: string,
  selected: string | null,
  documents: ReturnType<typeof createDocumentService>,
  workspace: ReturnType<typeof createWorkspaceService>;
let serial = 0;
const request = (op: string, extra: Record<string, unknown> = {}) => ({
  protocolVersion: 1,
  requestId: `test-${++serial}`,
  op,
  ...extra,
});
const good = (response: WorkspaceResponse) => {
  if (!response.ok) throw Error(JSON.stringify(response));
  return response;
};
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "workspace-test-"));
  selected = directory;
  documents = createDocumentService({
    pickFile: () => Promise.resolve(selected),
  });
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(selected),
    documents,
  });
});
afterEach(async () => {
  await workspace.dispose();
  await documents.dispose();
  await rm(directory, { recursive: true, force: true });
});
async function settle(): Promise<Extract<WorkspaceResponse, { ok: true }>> {
  for (let i = 0; i < 3000; i++) {
    const state = good(await workspace.request(request("state")));
    if (state.roots.every((root) => root.status !== "scanning")) return state;
    await Bun.sleep(2);
  }
  throw Error("scan did not settle");
}
async function nodes(root: WorkspaceRoot) {
  const result: WorkspaceNode[] = [];
  while (result.length < root.entries) {
    const page = good(
      await workspace.request(
        request("page", {
          root: root.handle,
          generation: root.generation,
          cursor: result.length,
        })
      )
    );
    result.push(...page.nodes!);
  }
  return result;
}
test("real Worker finds only valid branches, canonical link dedup and explicit hidden standalone", async () => {
  for (const part of ["child", "empty", "nonmd", ".hidden", ".git", "other"])
    await mkdir(join(directory, part));
  for (const part of [
    "a.md",
    "child/b.markdown",
    ".hidden/h.md",
    ".git/g.md",
    ".secret.md",
    "other/c.md",
  ])
    await writeFile(join(directory, part), `# ${part}`);
  await writeFile(join(directory, "nonmd/a.txt"), "text");
  await symlink("a.md", join(directory, "alias.md"));
  await symlink("child", join(directory, "linked"));
  await symlink("missing.md", join(directory, "broken.md"));
  await symlink("cycle.md", join(directory, "cycle.md"));
  selected = join(directory, ".secret.md");
  const hidden = await documents.select({
    protocolVersion: 1,
    requestId: "hidden",
  });
  expect(hidden.ok).toBe(true);
  selected = directory;
  const added = good(await workspace.request(request("select")));
  expect(added.roots[0].status).toBe("scanning");
  const state = await settle(),
    all = await nodes(state.roots[0]);
  expect(
    all
      .filter((n) => n.kind === "file")
      .map((n) => n.name)
      .sort()
  ).toEqual(["a.md", "b.markdown", "c.md"]);
  expect(
    all
      .filter((n) => n.kind === "directory")
      .map((n) => n.name)
      .sort()
  ).toEqual(["child", "other"]);
  expect(state.coveredHandles).toEqual([]);
  selected = join(directory, ".git/g.md");
  expect(
    await documents.select({ protocolVersion: 1, requestId: "git" })
  ).toMatchObject({ ok: false, error: "UNSUPPORTED_FILE" });
});
test("parent absorption preserves scoped open identity; stale handles revoke on rescan/clear", async () => {
  await mkdir(join(directory, "child"));
  const path = join(directory, "child/a.md");
  await writeFile(path, "# a");
  selected = join(directory, "child");
  await workspace.request(request("select"));
  let state = await settle();
  const child = state.roots[0],
    leaf = (await nodes(child)).find((n) => n.kind === "file")!;
  const open = await workspace.open({
    protocolVersion: 1,
    requestId: "open",
    root: child.handle,
    entry: leaf.handle,
  });
  if (!open.ok || !open.snapshot) throw Error(JSON.stringify(open));
  selected = directory;
  await workspace.request(request("select"));
  state = await settle();
  expect(state.roots).toHaveLength(1);
  expect(state.roots[0].handle).not.toBe(child.handle);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "read",
      handle: open.snapshot.handle,
    })
  ).toMatchObject({
    ok: true,
    snapshot: { documentId: open.snapshot.documentId },
  });
  const root = state.roots[0],
    entry = (await nodes(root)).find((n) => n.kind === "file")!;
  await workspace.request(request("rescan", { root: root.handle }));
  expect(
    await workspace.open({
      protocolVersion: 1,
      requestId: "stale",
      root: root.handle,
      entry: entry.handle,
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
  await workspace.request(request("clear"));
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "revoked",
      handle: open.snapshot.handle,
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
});
test("W25 absorbs an explicit hidden directory root in either order while retaining its opened grant", async () => {
  const hidden = join(directory, ".hidden");
  await mkdir(hidden);
  await writeFile(join(hidden, "a.md"), "# hidden root");
  selected = hidden;
  await workspace.request(request("select"));
  let state = await settle();
  const child = state.roots[0],
    leaf = (await nodes(child))[0];
  const opened = await workspace.open({
    protocolVersion: 1,
    requestId: "hidden-root-open",
    root: child.handle,
    entry: leaf.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error(JSON.stringify(opened));
  selected = directory;
  await workspace.request(request("select"));
  state = await settle();
  expect(state.roots).toHaveLength(1);
  expect(state.roots[0].displayPath).not.toBe(child.displayPath);
  expect(state.roots[0].entries).toBe(0);
  expect(state.coveredHandles).not.toContain(opened.snapshot.handle);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "hidden-root-still-open",
      handle: opened.snapshot.handle,
    })
  ).toMatchObject({
    ok: true,
    snapshot: { documentId: opened.snapshot.documentId, text: "# hidden root" },
  });
  selected = hidden;
  await workspace.request(request("select"));
  expect(good(await workspace.request(request("state"))).roots).toHaveLength(1);
});
test("root renamed with pending directories terminates and releases the queue", async () => {
  await mkdir(join(directory, "child"));
  await writeFile(join(directory, "child/a.md"), "# a");
  const scan = createScan(
    await authorizeRoot(directory),
    join(import.meta.dir, "../../../dist-native/save-primitives.node")
  );
  try {
    const initial = await scan.next();
    expect(initial.done).toBe(false);
    expect(initial.queueBytes).toBeGreaterThan(0);
    await rename(directory, `${directory}-moved`);
    try {
      const stopped = await scan.next();
      expect(stopped.done).toBe(true);
      expect(stopped.errors).toBe(1);
      expect(stopped.queueBytes).toBe(0);
      expect((await scan.next()).done).toBe(true);
    } finally {
      await rename(`${directory}-moved`, directory);
    }
  } finally {
    scan.close();
  }
});
test("link resolver refuses scope escapes and symlink-dotdot without following foreign metadata", async () => {
  await mkdir(join(directory, "root"));
  await mkdir(join(directory, "foreign"));
  await writeFile(join(directory, "root/local.md"), "local");
  await writeFile(join(directory, "foreign/out.md"), "foreign");
  await symlink("../foreign", join(directory, "root/exit"));
  await symlink("exit/out.md", join(directory, "root/out.md"));
  await symlink(
    `${directory}/root/exit/../local.md`,
    join(directory, "root/dotdot.md")
  );
  await symlink(
    `${directory}/foreign/out.md`,
    join(directory, "root/absolute.md")
  );
  selected = join(directory, "root");
  await workspace.request(request("select"));
  const state = await settle();
  expect(
    (await nodes(state.roots[0]))
      .filter((node) => node.kind === "file")
      .map((node) => node.name)
  ).toEqual(["local.md"]);
});
test("scanned directory replacement rejects before reading the foreign body", async () => {
  await mkdir(join(directory, "child"));
  await mkdir(join(directory, "outside"));
  await writeFile(join(directory, "child/a.md"), "inside");
  await writeFile(join(directory, "outside/a.md"), "FOREIGN");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0],
    entry = (await nodes(root)).find((n) =>
      n.displayPath.endsWith("child/a.md")
    )!;
  await rename(join(directory, "child"), join(directory, "old"));
  await symlink("outside", join(directory, "child"));
  expect(
    await workspace.open({
      protocolVersion: 1,
      requestId: "changed",
      root: root.handle,
      entry: entry.handle,
    })
  ).toMatchObject({ ok: false, error: "FILE_CHANGED" });
});
test("bounded cache explicitly pauses without reporting completion; malformed and forged requests reject", async () => {
  await workspace.dispose();
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents,
    cacheLimit: 100,
  });
  await writeFile(join(directory, "a.md"), "# a");
  await workspace.request(request("select"));
  const state = await settle();
  expect(state.roots[0].status).toBe("paused");
  expect(state.cacheBytes).toBeLessThanOrEqual(100);
  expect(
    await workspace.request({ ...request("state"), path: directory })
  ).toMatchObject({ ok: false, error: "INVALID_REQUEST" });
  expect(
    await workspace.open({
      protocolVersion: 1,
      requestId: "forged",
      root: crypto.randomUUID(),
      entry: crypto.randomUUID(),
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
});
test("two roots and explicit single-file targets keep one canonical visible owner", async () => {
  for (const name of ["one", "two"]) await mkdir(join(directory, name));
  await writeFile(join(directory, "two/target.md"), "# target");
  await writeFile(join(directory, "single.md"), "# single");
  await symlink("../two/target.md", join(directory, "one/cross.md"));
  await symlink("../single.md", join(directory, "one/standalone.md"));
  selected = join(directory, "single.md");
  const single = await documents.select({
    protocolVersion: 1,
    requestId: "single",
  });
  expect(single.ok).toBe(true);
  selected = join(directory, "one");
  await workspace.request(request("select"));
  selected = join(directory, "two");
  await workspace.request(request("select"));
  const state = await settle(),
    all = (await Promise.all(state.roots.map(nodes))).flat();
  expect(all.filter((n) => n.kind === "file").map((n) => n.name)).toEqual([
    "target.md",
  ]);
  expect(state.coveredHandles).toHaveLength(0);
});
test("all directory entries count toward native batches and tree pages do not truncate", async () => {
  for (let index = 0; index < 270; index++)
    await writeFile(join(directory, `note-${index}.md`), "# note");
  for (let index = 0; index < 140; index++)
    await writeFile(join(directory, `.hidden-${index}`), "");
  await workspace.request(request("select"));
  const state = await settle(),
    root = state.roots[0];
  expect(root.status).toBe("complete");
  expect(root.examined).toBeGreaterThanOrEqual(410);
  expect(root.entries).toBe(270);
  const all = await nodes(root);
  expect(new Set(all.map((node) => node.handle)).size).toBe(270);
  expect(state.cacheBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
});
test("native cursor is branded, bounded and closed idempotently", () => {
  const native = createRequire(import.meta.url)(
    join(import.meta.dir, "../../../dist-native/save-primitives.node")
  ) as {
    scanOpen(fd: number): object;
    scanBatch(cursor: object, size: number): unknown;
    scanClose(cursor: object): void;
  };
  expect(() => native.scanBatch({}, 1)).toThrow();
  expect(() => native.scanClose({})).toThrow();
  const fd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY),
    cursor = native.scanOpen(fd);
  try {
    expect(() => native.scanBatch(cursor, 129)).toThrow();
    native.scanClose(cursor);
    native.scanClose(cursor);
    expect(() => native.scanBatch(cursor, 1)).toThrow();
  } finally {
    native.scanClose(cursor);
    closeSync(fd);
  }
});
test("late batches cannot repopulate cleared roots", async () => {
  await workspace.dispose();
  let deliver: ((value: unknown) => void) | undefined;
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents,
    worker: {
      call(message) {
        return message.op === "next"
          ? new Promise((resolve) => {
              deliver = resolve;
            })
          : Promise.resolve(null);
      },
      dispose() {
        /* Controlled fake owns no resources. */
      },
    },
  });
  await workspace.request(request("select"));
  while (!deliver) await Bun.sleep(1);
  const cleared = good(await workspace.request(request("clear")));
  expect(cleared.roots).toEqual([]);
  deliver({
    files: [],
    examined: 1,
    errors: 0,
    done: true,
    paused: false,
    queueBytes: 0,
  });
  await Bun.sleep(3);
  expect(good(await workspace.request(request("state"))).roots).toEqual([]);
});
test("clear closes a worker session whose start reply is still pending", async () => {
  await workspace.dispose();
  let started: ((value: unknown) => void) | undefined;
  const closed: unknown[] = [];
  workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents,
    worker: {
      call(message) {
        if (message.op === "start")
          return new Promise((resolve) => {
            started = resolve;
          });
        if (message.op === "close") closed.push(message.key);
        return Promise.resolve(null);
      },
      dispose() {
        /* Fake has no native cursor. */
      },
    },
  });
  const root = good(await workspace.request(request("select"))).roots[0];
  while (!started) await Bun.sleep(1);
  await workspace.request(request("clear"));
  started(null);
  await Bun.sleep(3);
  expect(closed).toEqual([`${root.handle}:1`]);
  expect(good(await workspace.request(request("state"))).roots).toEqual([]);
});
test("actual volume case and Unicode aliases retain canonical owners", async () => {
  const root = join(directory, "CaseRoot"),
    variant = join(directory, "caseroot");
  await mkdir(root);
  await writeFile(join(root, "Café.md"), "# text");
  await symlink("Cafe\u0301.md", join(root, "unicode.md"));
  await symlink("CAFÉ.MD", join(root, "case.md"));
  selected = root;
  await workspace.request(request("select"));
  const initial = await settle(),
    all = await nodes(initial.roots[0]);
  expect(all.filter((node) => node.kind === "file")).toHaveLength(1);
  const sameVolumeAlias = await stat(variant).then(
    () => true,
    () => false
  );
  if (!sameVolumeAlias) await mkdir(variant);
  selected = variant;
  await workspace.request(request("select"));
  expect((await settle()).roots).toHaveLength(sameVolumeAlias ? 1 : 2);
});
test("derived document saves through existing service and root removal revokes all consumers", async () => {
  const path = join(directory, "a.md");
  await writeFile(path, "old");
  await workspace.request(request("select"));
  const root = (await settle()).roots[0],
    leaf = (await nodes(root))[0];
  const opened = await workspace.open({
    protocolVersion: 1,
    requestId: "open-save",
    root: root.handle,
    entry: leaf.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error(JSON.stringify(opened));
  const snapshot = opened.snapshot,
    text = "saved";
  const saved = await documents.save({
    protocolVersion: 1,
    requestId: "save-scoped",
    handle: snapshot.handle,
    documentId: snapshot.documentId,
    expectedHash: snapshot.hash,
    expectedRevision: snapshot.revision,
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
  expect(saved).toMatchObject({ ok: true });
  expect(await readFile(path, "utf8")).toBe(text);
  expect(
    await documents.read({
      protocolVersion: 1,
      requestId: "read-saved",
      handle: snapshot.handle,
    })
  ).toMatchObject({
    ok: true,
    snapshot: { documentId: snapshot.documentId, text },
  });
  await workspace.request(request("clear"));
  expect(
    await documents.checkWriteCapability({
      protocolVersion: 1,
      requestId: "cap-revoked",
      handle: snapshot.handle,
    })
  ).toMatchObject({ capability: { writable: false } });
  expect(
    await documents.readLocalImage({
      protocolVersion: 1,
      requestId: "image-revoked",
      handle: snapshot.handle,
      reference: "a.png",
    })
  ).toMatchObject({ ok: false });
  expect(
    await documents.save({
      protocolVersion: 1,
      requestId: "save-revoked",
      handle: snapshot.handle,
      documentId: snapshot.documentId,
      expectedHash: snapshot.hash,
      expectedRevision: 1,
      bufferRevision: 1,
      mirror: snapshot.mirror,
      content: {
        kind: "resync",
        text,
        targetHash: createHash("sha256").update(text).digest("hex"),
      },
    })
  ).toMatchObject({ ok: false, error: "INVALID_HANDLE" });
});
