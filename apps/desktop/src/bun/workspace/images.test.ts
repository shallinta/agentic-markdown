import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";
import {
  readLocalImage,
  type ImageJob,
} from "../documents/local-image-operation";

import { createWorkspaceService } from ".";

const native = join(
  import.meta.dir,
  "../../../dist-native/save-primitives.node"
);
const png = await readFile(
  join(import.meta.dir, "../../../icon.iconset/icon_128x128.png")
);
let dir: string,
  selected: string,
  docs: ReturnType<typeof createDocumentService>,
  workspace: ReturnType<typeof createWorkspaceService>;
let beforeImage: (job: ImageJob) => Promise<void>;
let serial = 0;
const envelope = () => ({
  protocolVersion: 1 as const,
  requestId: `images-${++serial}`,
});
const state = async () => {
  const result = await workspace.request({ ...envelope(), op: "state" });
  if (!result.ok) throw Error("state");
  return result;
};
const settle = async () => {
  for (let i = 0; i < 2000; i++) {
    const result = await state();
    if (result.roots.every((root) => root.status !== "scanning")) return result;
    await Bun.sleep(2);
  }
  throw Error("scan timeout");
};
const selectFile = async (path: string) => {
  selected = path;
  const result = await docs.select(envelope());
  if (!result.ok || !result.snapshot) throw Error("file");
  return result.snapshot;
};
const selectRoot = async (path: string) => {
  selected = path;
  const result = await workspace.request({ ...envelope(), op: "select" });
  expect(result.ok).toBe(true);
  return settle();
};
const image = (handle: string, reference = "../assets/a.png") =>
  docs.readLocalImage({ ...envelope(), handle, reference });
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "directory-images-"));
  await mkdir(join(dir, "root/notes"), { recursive: true });
  await mkdir(join(dir, "root/assets"));
  await writeFile(join(dir, "root/notes/a.md"), "![image](../assets/a.png)");
  await writeFile(
    join(dir, "root/notes/.hidden.md"),
    "![image](../assets/a.png)"
  );
  await writeFile(join(dir, "root/assets/a.png"), png);
  await writeFile(join(dir, "outside.png"), png);
  beforeImage = () => Promise.resolve();
  docs = createDocumentService({
    pickFile: () => Promise.resolve(selected),
    imageReader: {
      async read(job) {
        await beforeImage(job);
        return readLocalImage(job, native);
      },
      dispose() { /* Direct source reader owns no persistent worker. */ },
    },
  });
  workspace = createWorkspaceService({
    documents: docs,
    pickDirectory: () => Promise.resolve(selected),
  });
});
afterEach(async () => {
  await workspace.dispose();
  await docs.dispose();
  await rm(dir, { recursive: true, force: true });
});
test("only scanned visible standalone coverage expands asset scope without rereading body", async () => {
  const a = await selectFile(join(dir, "root/notes/a.md"));
  const hidden = await selectFile(join(dir, "root/notes/.hidden.md"));
  const initial = docs.assetEpochs();
  expect((await image(a.handle)).ok).toBe(false);
  expect((await image(hidden.handle)).ok).toBe(false);
  await selectRoot(join(dir, "root"));
  expect((await image(a.handle)).ok).toBe(true);
  expect((await image(hidden.handle)).ok).toBe(false);
  expect(docs.assetEpochs()[a.handle]).not.toBe(initial[a.handle]);
  expect(docs.assetEpochs()[hidden.handle]).toBe(initial[hidden.handle]);
  expect(
    docs.locations().find((item) => item.handle === a.handle)?.documentId
  ).toBe(a.documentId);
  expect((await image(a.handle, "../../outside.png")).ok).toBe(false);
  await symlink(join(dir, "outside.png"), join(dir, "root/assets/escape.png"));
  expect((await image(a.handle, "../assets/escape.png")).ok).toBe(false);
  const epoch = docs.assetEpochs()[a.handle];
  const roots = (await state()).roots;
  await workspace.request({
    ...envelope(),
    op: "rescan",
    root: roots[0].handle,
  });
  await settle();
  expect(docs.assetEpochs()[a.handle]).toBe(epoch);
  await workspace.request({ ...envelope(), op: "clear" });
  expect((await image(a.handle)).ok).toBe(false);
  expect(docs.assetEpochs()[a.handle]).not.toBe(epoch);
});
test("parent absorption changes an opened child scope and rejects in-flight old receipts", async () => {
  const child = await selectRoot(join(dir, "root/notes"));
  const page = await workspace.request({
    ...envelope(),
    op: "page",
    root: child.roots[0].handle,
    generation: child.roots[0].generation,
    cursor: 0,
  });
  if (!page.ok || !page.nodes) throw Error("page");
  const opened = await workspace.open({
    ...envelope(),
    root: child.roots[0].handle,
    entry: page.nodes.find((node) => node.name === "a.md")!.handle,
  });
  if (!opened.ok || !opened.snapshot) throw Error("open");
  const handle = opened.snapshot.handle;
  const oldEpoch = docs.assetEpochs()[handle];
  let finish: () => void = () => undefined;
  let started: () => void = () => undefined;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  beforeImage = async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const pending = image(handle);
  await start;
  await selectRoot(join(dir, "root"));
  finish();
  expect((await pending).ok).toBe(false);
  beforeImage = () => Promise.resolve();
  expect(docs.assetEpochs()[handle]).not.toBe(oldEpoch);
  expect((await image(handle)).ok).toBe(true);
  expect(
    docs.locations().find((item) => item.handle === handle)?.documentId
  ).toBe(opened.snapshot.documentId);
  await workspace.request({ ...envelope(), op: "clear" });
  expect((await image(handle)).ok).toBe(false);
  expect(docs.assetEpochs()[handle]).toBeUndefined();
});
test("save changes asset epoch and discards old reads without dropping directory scope", async () => {
  const a = await selectFile(join(dir, "root/notes/a.md"));
  await selectRoot(join(dir, "root"));
  const oldEpoch = docs.assetEpochs()[a.handle];
  let finish: () => void = () => undefined;
  let started: () => void = () => undefined;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  beforeImage = async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const pending = image(a.handle);
  await start;
  const text = `${a.text}\nnew text`;
  const saved = await docs.save({
    ...envelope(),
    handle: a.handle,
    documentId: a.documentId,
    expectedHash: a.hash,
    expectedRevision: a.revision,
    bufferRevision: 1,
    mirror: a.mirror,
    content: {
      kind: "patch",
      from: a.text.length,
      to: a.text.length,
      insert: "\nnew text",
      targetHash: createHash("sha256").update(text).digest("hex"),
    },
  });
  expect(saved.ok).toBe(true);
  finish();
  expect((await pending).ok).toBe(false);
  expect(docs.assetEpochs()[a.handle]).not.toBe(oldEpoch);
  beforeImage = () => Promise.resolve();
  expect((await image(a.handle)).ok).toBe(true);
  expect(await readFile(join(dir, "root/notes/a.md"), "utf8")).toBe(text);
});
test("clear while a scoped image is in flight rejects late bytes and preserves explicit file grant", async () => {
  const a = await selectFile(join(dir, "root/notes/a.md"));
  await selectRoot(join(dir, "root"));
  let finish: () => void = () => undefined;
  let started: () => void = () => undefined;
  const start = new Promise<void>((resolve) => {
    started = resolve;
  });
  beforeImage = async () => {
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  };
  const pending = image(a.handle);
  await start;
  await workspace.request({ ...envelope(), op: "clear" });
  finish();
  expect((await pending).ok).toBe(false);
  beforeImage = () => Promise.resolve();
  expect(
    docs.locations().find((item) => item.handle === a.handle)?.documentId
  ).toBe(a.documentId);
  expect((await image(a.handle)).ok).toBe(false);
  await docs.release({ ...envelope(), handle: a.handle });
  expect(docs.assetEpochs()[a.handle]).toBeUndefined();
});
