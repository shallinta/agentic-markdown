import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DocumentResponse, DocumentService } from "../../shared/documents";

import {
  authorizeSingleFile,
  verifySingleFileAuthorization,
  type SingleFileAuthorization,
} from "./path-authorization";

import { createDocumentService } from ".";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const request = (requestId: string) => ({
  protocolVersion: 1 as const,
  requestId,
});
function snapshot(response: DocumentResponse) {
  if (!response.ok || !response.snapshot)
    throw new Error(JSON.stringify(response));
  return response.snapshot;
}
const services: DocumentService[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.dispose()));
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true }))
  );
});
async function file() {
  const directory = await mkdtemp(join(tmpdir(), "agentic-cancel-"));
  directories.push(directory);
  const path = join(directory, "sample.md");
  await writeFile(path, "original");
  return path;
}
function track(service: DocumentService) {
  services.push(service);
  return service;
}

test("releasing an old leaf cannot cancel an unrelated picker", async () => {
  const path = await file();
  const other = await file();
  const picker = deferred<string | null>();
  let count = 0;
  const service = track(
    createDocumentService({
      pickFile: () => (++count === 1 ? Promise.resolve(path) : picker.promise),
    })
  );
  const first = snapshot(await service.select(request("first")));
  const selection = service.select(request("second"));
  await service.release({ ...request("release"), handle: first.handle });
  picker.resolve(other);
  expect(snapshot(await selection).fileName).toBe("sample.md");
});

test("releasing one leaf cannot cancel an unrelated in-flight read", async () => {
  const path = await file();
  const other = await file();
  let selected = path;
  let pause = false;
  const entered = deferred<void>();
  const resume = deferred<void>();
  const service = track(
    createDocumentService({
      pickFile: () => Promise.resolve(selected),
      verify: async (grant) => {
        const result = await verifySingleFileAuthorization(grant);
        if (pause) {
          entered.resolve();
          await resume.promise;
        }
        return result;
      },
    })
  );
  const first = snapshot(await service.select(request("first")));
  selected = other;
  const second = snapshot(await service.select(request("second")));
  pause = true;
  const read = service.read({ ...request("read"), handle: second.handle });
  await entered.promise;
  await service.release({ ...request("release"), handle: first.handle });
  resume.resolve();
  expect(snapshot(await read).documentId).toBe(second.documentId);
});

test("cancelled picker stays singleton and never authorizes its late selection", async () => {
  const picker = deferred<string | null>();
  const path = await file();
  let authorized = 0;
  const service = track(
    createDocumentService({
      pickFile: () => picker.promise,
      authorize: (selected) => {
        authorized++;
        return authorizeSingleFile(selected);
      },
    })
  );
  const first = service.select(request("first"));
  expect(await service.cancel({ ...request("first"), path })).toMatchObject({
    error: "INVALID_REQUEST",
  });
  await service.cancel(request("first"));
  expect(await first).toMatchObject({ error: "CANCELLED" });
  expect(await service.select(request("second"))).toMatchObject({
    error: "BUSY",
  });
  picker.resolve(path);
  await Promise.resolve();
  await Promise.resolve();
  expect(authorized).toBe(0);
  const next = snapshot(await service.select(request("next")));
  expect(next.revision).toBe(1);
  expect(authorized).toBe(1);
});

test("one physical read and only latest pending survive a burst; cancelled revision is not committed", async () => {
  const path = await file();
  const entered = deferred<void>();
  const resume = deferred<void>();
  let blocked = false;
  let calls = 0;
  const service = track(
    createDocumentService({
      pickFile: () => Promise.resolve(path),
      verify: async (grant) => {
        calls++;
        const stats = await verifySingleFileAuthorization(grant);
        if (blocked) {
          blocked = false;
          entered.resolve();
          await resume.promise;
        }
        return stats;
      },
    })
  );
  const first = snapshot(await service.select(request("open")));
  await writeFile(path, "intermediate");
  blocked = true;
  const old = service.read({ ...request("old"), handle: first.handle });
  await entered.promise;
  const superseded = [];
  for (let index = 0; index < 100; index++)
    superseded.push(
      service.read({ ...request(`burst-${index}`), handle: first.handle })
    );
  expect(await old).toMatchObject({ error: "CANCELLED" });
  for (const work of superseded.slice(0, -1))
    expect(await work).toMatchObject({ error: "CANCELLED" });
  expect(calls).toBe(3);
  await writeFile(path, "original");
  resume.resolve();
  const latest = snapshot(await superseded[99]);
  expect(latest.documentId).toBe(first.documentId);
  expect(latest.revision).toBe(1);
  expect(calls).toBe(5);
});

test("cancelling after authorization closes candidate and retains previous grant", async () => {
  const path = await file();
  const entered = deferred<void>();
  const resume = deferred<void>();
  let blocked = false;
  let candidate: SingleFileAuthorization | undefined;
  const service = track(
    createDocumentService({
      pickFile: () => Promise.resolve(path),
      authorize: async (selected) => {
        const grant = await authorizeSingleFile(selected);
        if (blocked) {
          candidate = grant;
          entered.resolve();
          await resume.promise;
        }
        return grant;
      },
    })
  );
  const first = snapshot(await service.select(request("first")));
  blocked = true;
  const next = service.select(request("next"));
  await entered.promise;
  await service.cancel(request("next"));
  expect(await next).toMatchObject({ error: "CANCELLED" });
  resume.resolve();
  // A subsequent queued read cannot run until candidate cleanup finishes.
  expect(
    snapshot(await service.read({ ...request("read"), handle: first.handle }))
      .documentId
  ).toBe(first.documentId);
  expect(candidate?.file.fd).toBe(-1);
});

test("cancellation at final verification does not publish a revision; release is not queued", async () => {
  const path = await file();
  const entered = deferred<void>();
  const resume = deferred<void>();
  let verifyCount = 0;
  let blockAt = Infinity;
  const service = track(
    createDocumentService({
      pickFile: () => Promise.resolve(path),
      verify: async (grant) => {
        const stats = await verifySingleFileAuthorization(grant);
        if (++verifyCount === blockAt) {
          entered.resolve();
          await resume.promise;
        }
        return stats;
      },
    })
  );
  const first = snapshot(await service.select(request("first")));
  await writeFile(path, "changed");
  blockAt = verifyCount + 2;
  const read = service.read({ ...request("read"), handle: first.handle });
  await entered.promise;
  await service.cancel(request("read"));
  expect(await read).toMatchObject({ error: "CANCELLED" });
  expect(
    await service.release({ ...request("release"), handle: first.handle })
  ).toMatchObject({ ok: true });
  resume.resolve();
  await writeFile(path, "original");
  const next = snapshot(await service.select(request("again")));
  expect(next.documentId).toBe(first.documentId);
  expect(next.revision).toBe(1);
  await service.cancel(request("again"));
  expect(
    snapshot(await service.read({ ...request("final"), handle: next.handle }))
      .revision
  ).toBe(1);
});

test("cancellation after atomic commit cannot hide the successful grant response", async () => {
  const path = await file();
  let firstGrant: SingleFileAuthorization | undefined;
  const service = track(
    createDocumentService({
      pickFile: () => Promise.resolve(path),
      authorize: async (selected) => {
        const grant = await authorizeSingleFile(selected);
        firstGrant ??= grant;
        return grant;
      },
    })
  );
  const first = snapshot(await service.select(request("first")));
  const descriptor = firstGrant!.file;
  const close = descriptor.close.bind(descriptor);
  descriptor.close = async () => {
    // Replacing a grant closes the old descriptor after the atomic commit,
    // but before the successful response has been delivered.
    await service.cancel(request("replacement"));
    await close();
  };
  const replacement = snapshot(await service.select(request("replacement")));
  expect(replacement.documentId).toBe(first.documentId);
  expect(
    snapshot(
      await service.read({ ...request("read"), handle: replacement.handle })
    ).revision
  ).toBe(1);
});
