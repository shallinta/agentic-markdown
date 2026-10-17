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
test("trusted reveal broker rejects a completed save and closes its resource", async () => {
  const dir = await mkdtemp(join(tmpdir(), "reveal-broker-")),
    path = join(dir, "a.md");
  await writeFile(path, "body");
  const resume = deferred();
  let calls = 0,
    closed = 0;
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
    revealPath: () => {
      calls++;
    },
    write: (input) =>
      Promise.resolve({
        ok: true,
        fingerprint: "changed",
        hash: createHash("sha256").update(input.text).digest("hex"),
        byteLength: Buffer.byteLength(input.text),
      }),
  });
  try {
    const opened = await service.select({
      protocolVersion: 1,
      requestId: "open",
    });
    if (!opened.ok || !opened.snapshot) throw Error("fixture");
    const base = opened.snapshot,
      text = "new";
    const pending = service.revealAuthorized(
      { protocolVersion: 1, requestId: "broker" },
      async () => {
        await resume.promise;
        return {
          path,
          close: () => {
            closed++;
            return Promise.resolve();
          },
        };
      },
      () => undefined
    );
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
    resume.resolve();
    expect((await pending).ok).toBe(false);
    expect(calls).toBe(0);
    expect(closed).toBe(1);
  } finally {
    resume.resolve();
    await service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
test("trusted reveal shares a single slot and cancellation releases resources", async () => {
  const resume = deferred();
  const cleanup = deferred();
  let closed = 0,
    calls = 0;
  const service = createDocumentService({
    pickFile: () => Promise.resolve(null),
    revealPath: () => {
      calls++;
    },
  });
  const authorize = async () => {
    await resume.promise;
    return {
      path: "/trusted",
      close: () => {
        closed++;
        cleanup.resolve();
        return Promise.resolve();
      },
    };
  };
  const pending = service.revealAuthorized(
    { protocolVersion: 1, requestId: "pending" },
    authorize,
    () => undefined
  );
  expect(
    (
      await service.revealAuthorized(
        { protocolVersion: 1, requestId: "second" },
        authorize,
        () => undefined
      )
    ).ok
  ).toBe(false);
  await service.cancel({ protocolVersion: 1, requestId: "pending" });
  resume.resolve();
  expect((await pending).ok).toBe(false);
  await cleanup.promise;
  expect(calls).toBe(0);
  expect(closed).toBe(1);
  await service.dispose();
});
for (const action of ["reveal", "openDefault"] as const) {
  test(`${action} dispatches canonical path without writing; readonly allowed; forged path and missing rejected`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "reveal-")),
      path = join(dir, "中文 a.md");
    await writeFile(path, "body");
    const calls: string[] = [];
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
      revealPath: (value) => {
        calls.push(value);
      },
      openDefaultPath: (value) => {
        calls.push(value);
        return true;
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
      expect((await service[action]({ ...request, path })).ok).toBe(false);
      await chmod(path, 0o444);
      expect((await service[action](request)).ok).toBe(true);
      expect(calls).toEqual([await realpath(path)]);
      await rm(path);
      expect(
        await service[action]({ ...request, requestId: "missing" })
      ).toMatchObject({ ok: false, error: "READ_FAILED" });
      expect(calls.length).toBe(1);
    } finally {
      await service.dispose();
      await rm(dir, { recursive: true, force: true });
    }
  });
  test(`${action} deferred verification cannot cross cancel, release, dispose, or completed barrier`, async () => {
    for (const invalidation of [
      "cancel",
      "release",
      "dispose",
      "barrier",
    ] as const) {
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
        openDefaultPath: () => {
          calls++;
          return true;
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
        const pending = service[action](request);
        await entered.promise;
        expect((await service.reveal(request)).ok).toBe(false);
        expect(
          (await service.openDefault({ ...request, requestId: "other" })).ok
        ).toBe(false);
        if (invalidation === "barrier")
          await service.withWriteBarrier(() => Promise.resolve(true));
        else if (invalidation === "dispose") await service.dispose();
        else if (invalidation === "cancel")
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
  test(`${action} SDK throw produces fixed failure without OS details`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "reveal-")),
      path = join(dir, "a.md");
    await writeFile(path, "body");
    const service = createDocumentService({
      pickFile: () => Promise.resolve(path),
      revealPath: () => {
        throw Error(path);
      },
      openDefaultPath: () => {
        throw Error(path);
      },
    });
    try {
      const selected = await service.select({
        protocolVersion: 1,
        requestId: "open",
      });
      if (!selected.ok || !selected.snapshot) throw Error("fixture");
      const result = await service[action]({
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
  test(`${action} scope revocation and completed save invalidate pending request`, async () => {
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
        openDefaultPath: () => {
          calls++;
          return true;
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
        const pending = service[action]({
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
}
test("default open false settles without poisoning subsequent successful request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "default-open-")),
    path = join(dir, "a.md");
  await writeFile(path, "body");
  let accepted = false;
  const service = createDocumentService({
    pickFile: () => Promise.resolve(path),
    openDefaultPath: () => accepted,
  });
  try {
    const selected = await service.select({
      protocolVersion: 1,
      requestId: "select",
    });
    if (!selected.ok || !selected.snapshot) throw Error("fixture");
    const request = {
      protocolVersion: 1,
      requestId: "open",
      handle: selected.snapshot.handle,
    };
    expect(await service.openDefault(request)).toMatchObject({
      ok: false,
      error: "READ_FAILED",
    });
    accepted = true;
    expect(
      await service.openDefault({ ...request, requestId: "next" })
    ).toMatchObject({ ok: true, snapshot: null });
  } finally {
    await service.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
