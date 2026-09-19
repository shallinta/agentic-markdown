import { expect, test } from "bun:test";

import type {
  DocumentRequest,
  DocumentResponse,
  DocumentSnapshot,
} from "../shared/documents";

import {
  createDocumentController,
  isDocumentResponse,
  type DocumentTransport,
} from "./documents";

function snapshot(text = "# 中文 <script>alert(1)</script>"): DocumentSnapshot {
  return {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    hash: "a".repeat(64),
    byteLength: new TextEncoder().encode(text).length,
    text,
  };
}
function result(
  request: DocumentRequest,
  value: DocumentSnapshot | null
): DocumentResponse {
  return { ...request, ok: true, snapshot: value };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const value = snapshot();
  const released: string[] = [];
  const transport: DocumentTransport = {
    selectDocument: (request) => Promise.resolve(result(request, value)),
    readDocument: (request) => Promise.resolve(result(request, value)),
    releaseDocument: (request) => {
      released.push(request.handle);
      return Promise.resolve(result(request, null));
    },
  };
  return {
    value,
    transport,
    released,
    controller: createDocumentController(transport),
  };
}

test("selection, unchanged reload and clear preserve raw text and release capability", async () => {
  const { controller, value, released } = setup();
  await controller.select();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  await controller.reload();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  controller.clear();
  expect(controller.getSnapshot().snapshot).toBeNull();
  expect(released).toEqual([value.handle]);
});

test("cancel and selection errors preserve current document; read error marks old snapshot", async () => {
  const { controller, transport, value } = setup();
  await controller.select();
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, null));
  await controller.select();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  transport.selectDocument = (request) =>
    Promise.resolve({ ...request, ok: false, error: "TOO_LARGE" });
  await controller.select();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  expect(controller.getSnapshot().error).toContain("1 MiB");
  transport.readDocument = (request) =>
    Promise.resolve({ ...request, ok: false, error: "FILE_CHANGED" });
  await controller.reload();
  expect(controller.getSnapshot().snapshot).toEqual(value);
  expect(controller.getSnapshot().stale).toBe(true);
  await controller.select();
  expect(controller.getSnapshot().stale).toBe(true);
  transport.selectDocument = () =>
    Promise.reject(new Error("connection failed"));
  await controller.select();
  expect(controller.getSnapshot().stale).toBe(true);
});

test("late reads cannot overwrite a newer selection", async () => {
  const { controller, transport } = setup();
  await controller.select();
  const delayed = deferred<unknown>();
  let pending!: DocumentRequest;
  transport.readDocument = (request) => {
    pending = request;
    return delayed.promise;
  };
  const reload = controller.reload();
  const next = snapshot("new");
  transport.selectDocument = (request) =>
    Promise.resolve(result(request, next));
  await controller.select();
  delayed.resolve(result(pending, snapshot("old")));
  await reload;
  expect(controller.getSnapshot().snapshot).toEqual(next);
});

test("clearing during selection discards result and releases its capability", async () => {
  const { controller, transport, value, released } = setup();
  const delayed = deferred<unknown>();
  let pending!: DocumentRequest;
  transport.selectDocument = (request) => {
    pending = request;
    return delayed.promise;
  };
  const select = controller.select();
  controller.clear();
  delayed.resolve(result(pending, value));
  await select;
  expect(controller.getSnapshot().snapshot).toBeNull();
  expect(released).toContain(value.handle);
});

test("version regression, identity mismatch and malformed replies are rejected", async () => {
  const { controller, transport, value } = setup();
  value.revision = 2;
  await controller.select();
  for (const next of [
    { ...value, revision: 1 },
    { ...value, documentId: crypto.randomUUID() },
    { ...value, hash: "b".repeat(64) },
  ]) {
    transport.readDocument = (request) =>
      Promise.resolve(result(request, next));
    await controller.reload();
    expect(controller.getSnapshot().snapshot).toEqual(value);
    expect(controller.getSnapshot().error).not.toBeNull();
  }
  transport.readDocument = () => Promise.reject(new Error("secret path"));
  await controller.reload();
  expect(controller.getSnapshot().error).not.toContain("secret");
  const request: DocumentRequest = { protocolVersion: 1, requestId: "test" };
  expect(isDocumentResponse(result(request, value), "wrong")).toBe(false);
  expect(
    isDocumentResponse(result(request, { ...value, byteLength: 0 }), "test")
  ).toBe(false);
  expect(
    isDocumentResponse({ ...request, ok: false, error: "toString" }, "test")
  ).toBe(false);
});
