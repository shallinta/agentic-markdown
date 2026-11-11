import { expect, test } from "bun:test";
import {
  lstat,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../documents";
import { fileFingerprint } from "../documents/path-authorization";

import { createWorkspaceService } from ".";

const env = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});
async function fixture(onRead?: () => void) {
  const dir = await mkdtemp(join(tmpdir(), "main-tab-read-")),
    path = join(dir, "a.md");
  const body = "# Current disk\n" + "正文".repeat(40000);
  await writeFile(path, body);
  const documents = createDocumentService({
    pickFile: () => Promise.resolve(null),
    onTiming: (phase) => {
      if (phase === "diskReadMs") onRead?.();
    },
  });
  const workspace = createWorkspaceService({
    documents,
    pickDirectory: () => Promise.resolve(dir),
  });
  await workspace.request({ ...env(), op: "select" });
  for (let i = 0; i < 1000; i++) {
    const state = await workspace.request({ ...env(), op: "state" });
    if (state.ok && state.roots[0]?.status === "complete") {
      const root = state.roots[0];
      const page = await workspace.request({
        ...env(),
        op: "page",
        root: root.handle,
        generation: root.generation,
        cursor: 0,
      });
      if (!page.ok) throw Error("Page failed");
      const entry = page.nodes?.find((node) => node.kind === "file");
      if (!entry) throw Error("No file");
      const input = {
        root: root.handle,
        generation: root.generation,
        entry: entry.handle,
        fingerprint: fileFingerprint(await lstat(path, { bigint: true })),
        requestId: crypto.randomUUID(),
      };
      return {
        path,
        body,
        documents,
        workspace,
        input,
        async close() {
          await workspace.dispose();
          await documents.dispose();
          await rm(dir, { recursive: true, force: true });
        },
      };
    }
    await Bun.sleep(2);
  }
  throw Error("Scan incomplete");
}
const proof = { check: () => undefined, verify: () => Promise.resolve() };

test("single historical candidate uses the current scoped file and preserves the original grant on duplicate", async () => {
  const f = await fixture();
  try {
    const opened = await f.workspace.openMainTabCandidate(f.input, proof);
    expect(opened.ok).toBe(true);
    if (!opened.ok || !opened.snapshot) throw Error("Open failed");
    expect(opened.snapshot.text).toBe(f.body);
    expect(opened.snapshot.explicitStandalone).toBe(false);
    const duplicate = await f.workspace.openMainTabCandidate(
      { ...f.input, requestId: crypto.randomUUID() },
      proof
    );
    expect(duplicate.ok).toBe(false);
    expect(f.documents.locations().map((item) => item.handle)).toEqual([
      opened.snapshot.handle,
    ]);
    expect(
      (await f.documents.release({ ...env(), handle: opened.snapshot.handle }))
        .ok
    ).toBe(true);
    expect(f.documents.locations()).toEqual([]);
    expect(await readFile(f.path, "utf8")).toBe(f.body);
  } finally {
    await f.close();
  }
});

test("final async source verification cannot publish a physically replaced file", async () => {
  const f = await fixture();
  try {
    let verified = false;
    const response = await f.workspace.openMainTabCandidate(f.input, {
      check: () => undefined,
      async verify(check) {
        await rename(f.path, `${f.path}.previous`);
        await writeFile(f.path, "replacement");
        check();
        verified = true;
      },
    });
    expect(verified).toBe(true);
    expect(response.ok).toBe(false);
    expect(f.documents.locations()).toEqual([]);
    expect(await readFile(f.path, "utf8")).toBe("replacement");
  } finally {
    await f.close();
  }
});

test("caller invalidated while stable reading finishes cannot reach source verification or grant commit", async () => {
  let current = true,
    read = false,
    verified = false;
  const f = await fixture(() => {
    read = true;
    current = false;
  });
  try {
    const response = await f.workspace.openMainTabCandidate(f.input, {
      check() {
        if (!current) throw Error("stale");
      },
      verify() {
        verified = true;
        return Promise.resolve();
      },
    });
    expect(read).toBe(true);
    expect(verified).toBe(false);
    expect(response.ok).toBe(false);
    expect(f.documents.locations()).toEqual([]);
  } finally {
    await f.close();
  }
});

test("generation, fingerprint and lifecycle changes reject before granting a recovered document", async () => {
  const f = await fixture();
  try {
    for (const change of [
      { generation: f.input.generation + 1 },
      { fingerprint: "1:2:3" },
    ]) {
      expect(
        (
          await f.workspace.openMainTabCandidate(
            { ...f.input, ...change, requestId: crypto.randomUUID() },
            proof
          )
        ).ok
      ).toBe(false);
    }
    const response = await f.workspace.openMainTabCandidate(f.input, {
      check: () => undefined,
      verify() {
        const resume = f.workspace.suspendRootMutations();
        resume();
        return Promise.resolve();
      },
    });
    expect(response.ok).toBe(false);
    expect(f.documents.locations()).toEqual([]);
  } finally {
    await f.close();
  }
});
