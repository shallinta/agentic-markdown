import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DocumentResponse } from "../../shared/documents";
import type { LocalImageResult } from "../../shared/local-images";
import { createDocumentService } from "../documents";
import { atomicSave } from "../documents/atomic-save";
import { verifySingleFileAuthorization } from "../documents/path-authorization";

import { createWorkspaceService } from ".";

const request = { protocolVersion: 1 as const, requestId: "test" };

test("actual save admitted after begin blocks commit until settlement, then a new operation removes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "remove-save-"));
  const path = join(directory, "a.md");
  await writeFile(path, "old");
  const entered = deferred<void>(),
    resume = deferred<void>();
  const docs = createDocumentService({
    pickFile: () => Promise.resolve(path),
    write: async (input) => {
      entered.resolve();
      await resume.promise;
      return atomicSave(input);
    },
  });
  const workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents: docs,
  });
  try {
    const a = snapshot(await docs.select(request));
    const state = workspace.removeStandalone({ ...request, op: "state" });
    if (state.status !== "state") throw Error();
    const operation = {
      ...request,
      session: state.session,
      sequence: state.sequence,
      handle: a.handle,
    };
    expect(
      workspace.removeStandalone({ ...operation, op: "begin" }).status
    ).toBe("issued");
    const text = "saved";
    const saving = docs.save({
      ...request,
      handle: a.handle,
      documentId: a.documentId,
      expectedRevision: a.revision,
      expectedHash: a.hash,
      bufferRevision: 1,
      mirror: a.mirror!,
      content: {
        kind: "patch",
        from: 0,
        to: a.text.length,
        insert: text,
        targetHash: createHash("sha256").update(text).digest("hex"),
      },
    });
    await entered.promise;
    expect(
      workspace.removeStandalone({ ...operation, op: "commit" }).status
    ).toBe("rejected");
    expect(docs.locations().some((item) => item.handle === a.handle)).toBe(
      true
    );
    workspace.removeStandalone({ ...operation, op: "ack" });
    resume.resolve();
    expect((await saving).ok).toBe(true);
    expect((await docs.waitForSaves(request)).settled).toBe(true);
    expect(await readFile(path, "utf8")).toBe(text);
    const next = { ...operation, sequence: operation.sequence + 1 };
    expect(workspace.removeStandalone({ ...next, op: "begin" }).status).toBe(
      "issued"
    );
    expect(workspace.removeStandalone({ ...next, op: "commit" }).status).toBe(
      "committed"
    );
    expect(await readFile(path, "utf8")).toBe(text);
  } finally {
    resume.resolve();
    await workspace.dispose();
    await docs.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
function snapshot(result: DocumentResponse) {
  if (!result.ok || !result.snapshot) throw Error(JSON.stringify(result));
  return result.snapshot;
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("real removal revokes only target grant, preserves disk/recent and prevents old-operation replay after reopen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "remove-standalone-"));
  let selected = join(directory, "a.md");
  const original = selected;
  await writeFile(selected, "A");
  await writeFile(join(directory, "b.md"), "B");
  const recent: string[] = [];
  const docs = createDocumentService({
    pickFile: () => Promise.resolve(selected),
    onStandaloneSelected: (entry) => {
      recent.push(entry.path);
    },
  });
  const workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents: docs,
  });
  try {
    const a = snapshot(await docs.select(request));
    selected = join(directory, "b.md");
    const b = snapshot(await docs.select(request));
    const state = workspace.removeStandalone({ ...request, op: "state" });
    if (state.status !== "state") throw Error();
    const operation = {
      session: state.session,
      sequence: state.sequence,
      handle: a.handle,
    };
    const run = (op: "begin" | "commit" | "query" | "ack") =>
      workspace.removeStandalone({ ...request, op, ...operation });
    expect(run("begin").status).toBe("issued");
    expect(run("commit").status).toBe("committed");
    expect(docs.assetEpochs()[a.handle]).toBeUndefined();
    expect(await docs.read({ ...request, handle: a.handle })).toMatchObject({
      ok: false,
      error: "INVALID_HANDLE",
    });
    expect(
      snapshot(await docs.read({ ...request, handle: b.handle })).text
    ).toBe("B");
    expect(recent).toEqual([a.displayPath!, b.displayPath!]);
    expect(await readFile(original, "utf8")).toBe("A");
    run("ack");
    selected = original;
    const reopened = snapshot(await docs.select(request));
    expect(reopened.handle).not.toBe(a.handle);
    expect(run("commit").status).toBe("unknown");
    run("ack");
    expect(
      snapshot(await docs.read({ ...request, handle: reopened.handle })).text
    ).toBe("A");
  } finally {
    await workspace.dispose();
    await docs.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("actual folder discovery absorbs normal standalone but preserves explicitly opened hidden exception", async () => {
  const directory = await mkdtemp(join(tmpdir(), "remove-covered-"));
  let selected = join(directory, "a.md");
  await writeFile(selected, "A");
  await writeFile(join(directory, ".hidden.md"), "hidden");
  const docs = createDocumentService({
    pickFile: () => Promise.resolve(selected),
  });
  const workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents: docs,
  });
  try {
    const a = snapshot(await docs.select(request));
    selected = join(directory, ".hidden.md");
    const hidden = snapshot(await docs.select(request));
    const issuedState = workspace.removeStandalone({ ...request, op: "state" });
    if (issuedState.status !== "state") throw Error();
    const issued = {
      ...request,
      session: issuedState.session,
      sequence: issuedState.sequence,
      handle: a.handle,
    };
    expect(workspace.removeStandalone({ ...issued, op: "begin" }).status).toBe(
      "issued"
    );
    await workspace.request({ ...request, op: "select" });
    for (let i = 0; i < 1000; i++) {
      const value = await workspace.request({ ...request, op: "state" });
      if (value.ok && value.roots.every((root) => root.status !== "scanning"))
        break;
      await Bun.sleep(2);
      if (i === 999) throw Error("scan timeout");
    }
    expect(workspace.removeStandalone({ ...issued, op: "commit" }).status).toBe(
      "rejected"
    );
    workspace.removeStandalone({ ...issued, op: "ack" });
    const state = workspace.removeStandalone({ ...request, op: "state" });
    if (state.status !== "state") throw Error();
    const base = {
      ...request,
      session: state.session,
      sequence: state.sequence,
    };
    expect(
      workspace.removeStandalone({ ...base, op: "begin", handle: a.handle })
        .status
    ).toBe("rejected");
    expect(
      workspace.removeStandalone({
        ...base,
        op: "begin",
        handle: hidden.handle,
      }).status
    ).toBe("issued");
    expect(
      workspace.removeStandalone({
        ...base,
        op: "commit",
        handle: hidden.handle,
      }).status
    ).toBe("committed");
    expect(
      snapshot(await docs.read({ ...request, handle: a.handle })).text
    ).toBe("A");
  } finally {
    await workspace.dispose();
    await docs.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("write barrier rejects issued removal before revocation; paused refresh task loses removed authority", async () => {
  const directory = await mkdtemp(join(tmpdir(), "remove-pending-"));
  const path = join(directory, "a.md");
  await writeFile(path, "old");
  let pause = false,
    entered = 0;
  const reached = deferred<void>(),
    resume = deferred<void>();
  const docs = createDocumentService({
    pickFile: () => Promise.resolve(path),
    verify: async (grant) => {
      if (pause) {
        if (++entered === 1) reached.resolve();
        await resume.promise;
      }
      return verifySingleFileAuthorization(grant);
    },
  });
  const workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents: docs,
  });
  try {
    const a = snapshot(await docs.select(request));
    const state = workspace.removeStandalone({ ...request, op: "state" });
    if (state.status !== "state") throw Error();
    const operation = {
      ...request,
      session: state.session,
      sequence: state.sequence,
      handle: a.handle,
    };
    expect(
      workspace.removeStandalone({ ...operation, op: "begin" }).status
    ).toBe("issued");
    await docs.withWriteBarrier(() => {
      expect(
        workspace.removeStandalone({ ...operation, op: "commit" }).status
      ).toBe("rejected");
      expect(docs.locations().some((item) => item.handle === a.handle)).toBe(
        true
      );
      return Promise.resolve(true);
    });
    workspace.removeStandalone({ ...operation, op: "ack" });
    const next = { ...operation, sequence: operation.sequence + 1 };
    await writeFile(path, "external");
    pause = true;
    const candidate = docs.readRefreshCandidate({
      handle: a.handle,
      documentId: a.documentId,
      expectedRevision: a.revision,
      expectedHash: a.hash,
    });
    await reached.promise;
    expect(workspace.removeStandalone({ ...next, op: "begin" }).status).toBe(
      "issued"
    );
    expect(workspace.removeStandalone({ ...next, op: "commit" }).status).toBe(
      "committed"
    );
    expect(await candidate).toEqual({ ok: false, error: "CANCELLED" });
    pause = false;
    resume.resolve();
    expect(docs.locations()).toHaveLength(0);
    expect(await readFile(path, "utf8")).toBe("external");
  } finally {
    pause = false;
    resume.resolve();
    await workspace.dispose();
    await docs.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a successful image reader result arriving after revocation is rejected; other grant remains valid", async () => {
  const directory = await mkdtemp(join(tmpdir(), "remove-image-"));
  let selected = join(directory, "a.md");
  await writeFile(selected, "A");
  await writeFile(join(directory, "b.md"), "B");
  let pause = false;
  const entered = deferred<void>(),
    resume = deferred<void>();
  const ok: LocalImageResult = {
    ok: true,
    mime: "image/png",
    data: "AAAA",
    width: 1,
    height: 1,
    identity: "a".repeat(64),
  };
  const docs = createDocumentService({
    pickFile: () => Promise.resolve(selected),
    imageReader: {
      read: async () => {
        if (pause) {
          entered.resolve();
          await resume.promise;
        }
        return ok;
      },
      dispose: () => {
        /* no cached resources in this injected reader */
      },
    },
  });
  const workspace = createWorkspaceService({
    pickDirectory: () => Promise.resolve(directory),
    documents: docs,
  });
  try {
    const a = snapshot(await docs.select(request));
    selected = join(directory, "b.md");
    const b = snapshot(await docs.select(request));
    const read = (handle: string) =>
      docs.readLocalImage({ ...request, handle, reference: "image.png" });
    expect(await read(a.handle)).toMatchObject(ok);
    await writeFile(join(directory, "a.md"), "external");
    const candidate = await docs.readRefreshCandidate({
      handle: a.handle,
      documentId: a.documentId,
      expectedRevision: a.revision,
      expectedHash: a.hash,
    });
    if (!candidate.ok || !candidate.candidate)
      throw Error("expected retained candidate");
    const token = candidate.candidate.token;
    expect(await docs.checkRefreshCandidateBinding(token)).toBe(true);
    pause = true;
    const late = read(a.handle);
    await entered.promise;
    const state = workspace.removeStandalone({ ...request, op: "state" });
    if (state.status !== "state") throw Error();
    const operation = {
      ...request,
      session: state.session,
      sequence: state.sequence,
      handle: a.handle,
    };
    expect(
      workspace.removeStandalone({ ...operation, op: "begin" }).status
    ).toBe("issued");
    expect(
      workspace.removeStandalone({ ...operation, op: "commit" }).status
    ).toBe("committed");
    pause = false;
    resume.resolve();
    expect(await late).toMatchObject({ ok: false, error: "UNAVAILABLE" });
    expect(await docs.checkRefreshCandidateBinding(token)).toBe(false);
    expect(
      (
        await docs.acceptRefreshCandidate({
          handle: a.handle,
          token,
          operationId: crypto.randomUUID(),
          sequence: 1,
        })
      ).status
    ).not.toBe("committed");
    expect(await read(b.handle)).toMatchObject(ok);
  } finally {
    resume.resolve();
    await workspace.dispose();
    await docs.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
