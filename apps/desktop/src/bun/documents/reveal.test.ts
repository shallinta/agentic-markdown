import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, realpath, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { rawPatch } from "../../shared/save-content";

import {
  authorizeSingleFile,
  verifySingleFileAuthorization,
} from "./path-authorization";

import { createDocumentService } from ".";

function deferred() {
  let resolve!: () => void;
  return {
    promise: new Promise<void>((done) => {
      resolve = done;
    }),
    resolve: () => resolve(),
  };
}
test("reveal dispatches canonical path without writing; readonly allowed; forged path and missing rejected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reveal-")),
    path = join(dir, "中文 a.md");
  await writeFile(path, "body");
  const calls: string[] = [];
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
    revealPath: (value) => {
      calls.push(value);
    },
  });
  try {
    const selected = await service.select({
      protocolVersion: 1,
      requestId: "open",
    });
    if (!selected.ok || !selected.snapshot) throw Error("fixture");
    const request = {
      protocolVersion: 1,
      requestId: "reveal",
      handle: selected.snapshot.handle,
    };
    expect((await service.reveal({ ...request, path })).ok).toBe(false);
    await chmod(path, 0o444);
    expect((await service.reveal(request)).ok).toBe(true);
    expect(calls).toEqual([await realpath(path)]);
    await rm(path);
    expect(
      await service.reveal({ ...request, requestId: "missing" })
    ).toMatchObject({ ok: false, error: "READ_FAILED" });
    expect(calls.length).toBe(1);
  } finally {
    await service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
test("reveal deferred verification cannot cross cancel, release, dispose, or completed barrier", async () => {
  for (const action of ["cancel", "release", "dispose", "barrier"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "reveal-")),
      path = join(dir, "a.md");
    await writeFile(path, "body");
    const entered = deferred(),
      resume = deferred();
    let pause = false,
      calls = 0;
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
      verify: async (grant) => {
        const result = await verifySingleFileAuthorization(grant);
        if (pause) {
          entered.resolve();
          await resume.promise;
        }
        return result;
      },
      revealPath: () => {
        calls++;
      },
    });
    try {
      const selected = await service.select({
        protocolVersion: 1,
        requestId: "open",
      });
      if (!selected.ok || !selected.snapshot) throw Error("fixture");
      pause = true;
      const request = {
        protocolVersion: 1,
        requestId: "reveal",
        handle: selected.snapshot.handle,
      };
      const pending = service.reveal(request);
      await entered.promise;
      expect((await service.reveal(request)).ok).toBe(false);
      if (action === "barrier")
        await service.withWriteBarrier(() => Promise.resolve(true));
      else if (action === "dispose") await service.dispose();
      else if (action === "cancel")
        await service.cancel({
          protocolVersion: 1,
          requestId: request.requestId,
        });
      else await service.release(request);
      resume.resolve();
      expect((await pending).ok).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toBe(0);
    } finally {
      resume.resolve();
      await service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }
});
test("SDK throw produces fixed failure without OS details", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reveal-")),
    path = join(dir, "a.md");
  await writeFile(path, "body");
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
    revealPath: () => {
      throw Error(path);
    },
  });
  try {
    const selected = await service.select({
      protocolVersion: 1,
      requestId: "open",
    });
    if (!selected.ok || !selected.snapshot) throw Error("fixture");
    const result = await service.reveal({
      protocolVersion: 1,
      requestId: "reveal",
      handle: selected.snapshot.handle,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result).includes(path)).toBe(false);
  } finally {
    await service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
test("scope revocation and completed save invalidate pending reveal", async () => {
  for (const mode of ["scope", "save"] as const) {
    const dir = await mkdtemp(join(tmpdir(), "reveal-")),
      path = join(dir, "a.md");
    await writeFile(path, "body");
    const entered = deferred(),
      resume = deferred();
    let pause = false,
      paused = false,
      calls = 0,
      alive = true;
    const scope = {
      verify: () =>
        alive ? Promise.resolve() : Promise.reject(Error("revoked")),
    };
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
      verify: async (grant) => {
        const result = await verifySingleFileAuthorization(grant);
        if (pause && !paused) {
          paused = true;
          entered.resolve();
          await resume.promise;
        }
        return result;
      },
      write: (input) =>
        Promise.resolve({
          ok: true,
          fingerprint: "new-fingerprint",
          hash: createHash("sha256").update(input.text).digest("hex"),
          byteLength: Buffer.byteLength(input.text),
        }),
      revealPath: () => {
        calls++;
      },
    });
    try {
      const opened = await service.openAuthorized(
        { protocolVersion: 1, requestId: "open" },
        () => authorizeSingleFile(path),
        scope
      );
      if (!opened.ok || !opened.snapshot) throw Error("fixture");
      const base = opened.snapshot;
      pause = true;
      const pending = service.reveal({
        protocolVersion: 1,
        requestId: "reveal",
        handle: base.handle,
      });
      await entered.promise;
      if (mode === "scope") alive = false;
      else {
        const text = "new";
        expect(
          (
            await service.save({
              protocolVersion: 1,
              requestId: "save",
              handle: base.handle,
              documentId: base.documentId,
              expectedHash: base.hash,
              expectedRevision: base.revision,
              bufferRevision: 1,
              mirror: base.mirror,
              content: {
                kind: "patch",
                ...rawPatch(base.text, text),
                targetHash: createHash("sha256").update(text).digest("hex"),
              },
            })
          ).ok
        ).toBe(true);
      }
      resume.resolve();
      expect((await pending).ok).toBe(false);
      expect(calls).toBe(0);
    } finally {
      resume.resolve();
      await service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  }
});
