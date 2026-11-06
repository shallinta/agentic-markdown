import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRasterPasteResponse, type RasterPasteRequest } from "../../shared/raster-paste";
import { createDocumentService } from "../documents";

import { createWorkspaceService } from ".";

const png = await readFile(join(import.meta.dir, "../../../icon.iconset/icon_128x128.png"));
const markdown = "\uFEFF# 位图夹具\r\n";
const envelope = () => ({ protocolVersion: 1 as const, requestId: randomUUID() });

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "agentic-workspace-raster-"));
  const parent = join(directory, "nested");
  const path = join(parent, "document.md");
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(path),
    probe: () => Promise.resolve({ status: "unchanged" }),
  });
  const workspace = createWorkspaceService({ documents, pickDirectory: () => Promise.resolve(directory) });
  const dispose = async () => {
    await workspace.dispose();
    await documents.dispose();
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await mkdir(parent);
    await writeFile(path, markdown);
    const selected = await documents.select(envelope());
    if (!selected.ok || !selected.snapshot) throw Error("Fixture select failed");
    const { handle, documentId, revision, hash } = selected.snapshot;
    const observed = await documents.observe({
      ...envelope(), active: true, handle, documentId, revision, hash, watchEpoch: 1, watchToken: randomUUID(),
    });
    if (!observed.ok) throw Error("Fixture observation failed");
    return {
      documents, workspace, directory, parent, path, dispose,
      async joinRoot() {
        const joined = await workspace.request({ ...envelope(), op: "select" });
        if (!joined.ok) throw Error("Fixture root select failed");
        for (let i = 0; i < 500; i++) {
          const state = await workspace.request({ ...envelope(), op: "state" });
          if (state.ok && state.roots[0]?.status === "complete") return;
          await Bun.sleep(2);
        }
        throw Error("Fixture root scan did not settle");
      },
      request(sequence: number): RasterPasteRequest {
        return { ...envelope(), sequence, handle, documentId, expectedRevision: revision, expectedHash: hash, data: png.toString("base64") };
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

test("existing standalone grant needs separate exact scan coverage and publishes beside the nested document", async () => {
  const f = await fixture();
  try {
    expect(f.workspace.getRasterPasteSequence()).toEqual({ ok: true, sequence: 0 });
    const standalone = f.request(1);
    expect(await f.workspace.publishRasterPaste(standalone)).toEqual({
      ok: false, requestId: standalone.requestId, error: "UNAUTHORIZED",
    });
    expect(await readdir(f.parent)).toEqual(["document.md"]);
    await f.joinRoot();
    expect(await f.workspace.publishRasterPaste(standalone)).toEqual({
      ok: false, requestId: standalone.requestId, error: "STALE",
    });
    const request = f.request(2);
    const result = parseRasterPasteResponse(await f.workspace.publishRasterPaste(request), request.requestId);
    if (!result?.ok) throw Error(`Publish fixture failed ${result?.error}`);
    expect(await readFile(join(f.parent, result.relativePath))).toEqual(png);
    expect(await readFile(f.path, "utf8")).toBe(markdown);
    expect(await readdir(f.directory)).toEqual(["nested"]);
    expect(await readdir(join(f.parent, "assets"))).toHaveLength(1);
    expect(f.workspace.getRasterPasteSequence()).toEqual({ ok: true, sequence: 2 });
  } finally { await f.dispose(); }
});

test("one active raster receipt consumes its sequence and a refused busy request does not", async () => {
  const f = await fixture();
  try {
    await f.joinRoot();
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const barrier = f.documents.withCreateBarrier(() => {
      acquired.resolve();
      return release.promise;
    });
    try {
      await acquired.promise;
      const first = f.request(1), second = f.request(2);
      const pending = f.workspace.publishRasterPaste(first);
      expect(f.workspace.getRasterPasteSequence()).toEqual({ ok: true, sequence: 1 });
      expect(await f.workspace.publishRasterPaste(first)).toEqual({ ok: false, requestId: first.requestId, error: "STALE" });
      expect(await f.workspace.publishRasterPaste(second)).toEqual({ ok: false, requestId: second.requestId, error: "BUSY" });
      expect(await pending).toEqual({ ok: false, requestId: first.requestId, error: "ADMITTED_BUSY" });
      expect(f.workspace.getRasterPasteSequence()).toEqual({ ok: true, sequence: 1 });
      expect(await readdir(f.parent)).toEqual(["document.md"]);
      release.resolve();
      expect(await barrier).toBe(true);
      expect(await f.workspace.publishRasterPaste(second)).toMatchObject({ ok: true, requestId: second.requestId });
      expect(await readdir(join(f.parent, "assets"))).toHaveLength(1);
    } finally { release.resolve(); await barrier; }
  } finally { await f.dispose(); }
});
