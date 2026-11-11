import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";
import { createWorkspaceService } from "../workspace";

import { captureMainTabStandaloneSource } from "./main-tab-standalone-source";

const request = () => ({ protocolVersion: 1, requestId: crypto.randomUUID() });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "standalone-source-"));
  const path = join(directory, "one", "same.md");
  const other = join(directory, "two", "same.md");
  for (const [folder, file] of [
    ["one", path],
    ["two", other],
  ]) {
    await mkdir(join(directory, folder));
    await writeFile(file, "# 中文\r\nsource 😀\n");
  }
  const services: ReturnType<typeof createDocumentService>[] = [];
  const open = async (file = path) => {
    const documents = createDocumentService({
      pickFile: () => Promise.resolve(file),
    });
    services.push(documents);
    const response = await documents.select(request());
    if (!response.ok || !response.snapshot) throw Error("open failed");
    const { handle, documentId, revision, hash } = response.snapshot;
    return { documents, identity: { handle, documentId, revision, hash } };
  };
  return {
    directory,
    path,
    other,
    open,
    async close() {
      await Promise.all(services.map((service) => service.dispose()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("fresh explicit authorization matches historical physical source, not process identity", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const old = await captureMainTabStandaloneSource(
      first.documents,
      first.identity,
      () => true
    );
    expect(old.status).toBe("ready");
    if (old.status !== "ready") throw Error("proof missing");
    await first.documents.dispose();
    expect(old.current()).toBe(false);
    const second = await f.open();
    expect(second.identity.documentId).not.toBe(first.identity.documentId);
    const proof = await captureMainTabStandaloneSource(
      second.documents,
      second.identity,
      () => true,
      old.source
    );
    expect(proof.status).toBe("ready");
    if (proof.status !== "ready") throw Error("proof missing");
    expect(proof.current()).toBe(true);
    await second.documents.release({
      ...request(),
      handle: second.identity.handle,
    });
    expect(proof.current()).toBe(false);
  } finally {
    await f.close();
  }
});

test("wrong same-name and replaced originals reject before standalone verification", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const old = await captureMainTabStandaloneSource(
      first.documents,
      first.identity,
      () => true
    );
    if (old.status !== "ready") throw Error("proof missing");
    await rename(f.path, f.path + ".old");
    await writeFile(f.path, "# 中文\r\nsource 😀\n");
    for (const file of [f.other, f.path]) {
      const next = await f.open(file);
      let verified = 0;
      const spy = {
        captureContentSearchBindings(handles: readonly string[]) {
          const captured = next.documents.captureContentSearchBindings(handles);
          if (captured)
            for (const binding of captured.bindings)
              if (binding?.verifyStandalone) {
                const original = binding.verifyStandalone;
                binding.verifyStandalone = (check) => {
                  verified++;
                  return original(check);
                };
              }
          return captured;
        },
      };
      expect(
        (
          await captureMainTabStandaloneSource(
            spy,
            next.identity,
            () => true,
            old.source
          )
        ).status
      ).toBe("unavailable");
      expect(verified).toBe(0);
    }
  } finally {
    await f.close();
  }
});

test("wrong baseline, caller cancellation and folder-derived authority cannot mint standalone proof", async () => {
  const f = await fixture();
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
  });
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(join(f.directory, "one")),
  });
  try {
    const standalone = await f.open();
    for (const identity of [
      { ...standalone.identity, revision: 2 },
      { ...standalone.identity, hash: "0".repeat(64) },
      { ...standalone.identity, documentId: crypto.randomUUID() },
    ])
      expect(
        (
          await captureMainTabStandaloneSource(
            standalone.documents,
            identity,
            () => true
          )
        ).status
      ).toBe("unavailable");
    expect(
      (
        await captureMainTabStandaloneSource(
          standalone.documents,
          standalone.identity,
          () => false
        )
      ).status
    ).toBe("stale");
    await workspace.request({ ...request(), op: "select" });
    for (let turn = 0; turn < 1000; turn++) {
      const listed = await workspace.request({ ...request(), op: "state" });
      const root = listed.ok && listed.roots?.[0];
      if (root && root.status === "complete") {
        const page = await workspace.request({
          ...request(),
          op: "page",
          root: root.handle,
          generation: root.generation,
          cursor: 0,
        });
        const node =
          page.ok && page.nodes?.find((node) => node.kind === "file");
        if (!node) throw Error("node missing");
        const opened = await workspace.open({
          ...request(),
          root: root.handle,
          entry: node.handle,
        });
        if (!opened.ok || !opened.snapshot) throw Error("open failed");
        const { handle, documentId, revision, hash } = opened.snapshot;
        expect(
          (
            await captureMainTabStandaloneSource(
              documents,
              { handle, documentId, revision, hash },
              () => true
            )
          ).status
        ).toBe("unavailable");
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw Error("scan timeout");
  } finally {
    await workspace.dispose();
    await documents.dispose();
    await f.close();
  }
});

test("late cancellation after real physical verification returns no proof", async () => {
  const f = await fixture();
  try {
    const opened = await f.open();
    let current = true;
    let verified = 0;
    const documents = {
      captureContentSearchBindings(handles: readonly string[]) {
        const captured = opened.documents.captureContentSearchBindings(handles);
        if (captured)
          for (const binding of captured.bindings)
            if (binding?.verifyStandalone) {
              const original = binding.verifyStandalone;
              binding.verifyStandalone = async (check) => {
                await original(check);
                verified++;
                current = false;
              };
            }
        return captured;
      },
    };
    expect(
      await captureMainTabStandaloneSource(
        documents,
        opened.identity,
        () => current
      )
    ).toEqual({ status: "stale" });
    expect(verified).toBe(1);
    for (const expected of [
      null,
      [],
      { path: f.path },
      { path: f.path, fingerprint: "x", text: "unexpected" },
    ])
      expect(
        (
          await captureMainTabStandaloneSource(
            opened.documents,
            opened.identity,
            () => true,
            expected
          )
        ).status
      ).toBe("invalid");
  } finally {
    await f.close();
  }
});
