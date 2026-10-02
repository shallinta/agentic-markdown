import { expect, test } from "bun:test";

import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { parseCanonicalMarkdown } from "./canonical-parser";
import {
  createCurrentCanonical,
  type CanonicalSource,
  type CurrentCanonicalWorker,
} from "./current-canonical";
import {
  CANONICAL_CONFIG,
  isCanonicalRequest,
  type CanonicalRequest,
} from "./current-canonical-protocol";
import { createDiscardGuard } from "./discard-guard";
import {
  canonicalDiscardParticipant,
  createDocumentCanonical,
} from "./document-canonical";
import { createDocumentController, type DocumentTransport } from "./documents";
import { rawText } from "./raw-buffer";

class FakeWorker implements CurrentCanonicalWorker {
  onmessage: CurrentCanonicalWorker["onmessage"] = null;
  onerror: CurrentCanonicalWorker["onerror"] = null;
  onmessageerror: CurrentCanonicalWorker["onmessageerror"] = null;
  request!: CanonicalRequest;
  terminated = false;
  postMessage(request: CanonicalRequest) {
    this.request = request;
  }
  terminate() {
    this.terminated = true;
  }
  response() {
    const identity = {
      requestId: this.request.requestId,
      documentId: this.request.documentId,
      revision: this.request.revision,
      config: this.request.config,
    };
    return {
      ok: true,
      result: {
        ...identity,
        tree: parseCanonicalMarkdown(this.request.text),
        milliseconds: 1,
      },
    };
  }
  complete() {
    this.onmessage?.({ data: this.response() } as MessageEvent);
  }
}
function fixture() {
  let source: CanonicalSource | null = {
    documentId: "doc",
    revision: 0,
    text: "\uFEFF# 中文\r\n\r\n[链接](https://example.invalid)\r\n",
    identity: {},
  };
  const workers: FakeWorker[] = [];
  const service = createCurrentCanonical(
    () => source,
    () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  );
  return {
    service,
    workers,
    get: () => source,
    set: (value: CanonicalSource | null) => {
      source = value;
      service.invalidate();
    },
  };
}
test("lazy current parser returns raw positions and owns no resource effects", async () => {
  const f = fixture();
  expect(f.workers.length).toBe(0);
  const promise = f.service.request();
  expect(f.service.getSnapshot().status).toBe("running");
  f.workers[0].complete();
  const result = (await promise)!;
  expect(result.tree.children[0].type).toBe("heading");
  expect(result.tree.children[0].position?.start.offset).toBe(1);
  expect(f.workers[0].request.text).toBe(f.get()!.text);
  expect(f.workers[0].terminated).toBe(true);
  expect(f.service.getSnapshot().status).toBe("ready");
});
test("latest request terminates previous; captured late handler cannot publish", async () => {
  const f = fixture();
  const first = f.service.request();
  const late = f.workers[0].onmessage!;
  const second = f.service.request();
  expect(await first).toBeNull();
  expect(f.workers[0].terminated).toBe(true);
  late({ data: f.workers[0].response() } as MessageEvent);
  expect(f.service.getSnapshot().status).toBe("running");
  f.workers[1].complete();
  expect(await second).not.toBeNull();
});
test("revision, document lifetime, active identity and close invalidate running/ready results", async () => {
  for (const variant of ["revision", "reload", "switch", "close"] as const) {
    const f = fixture();
    const promise = f.service.request();
    const source = f.get()!;
    f.set(
      variant === "close"
        ? null
        : {
            ...source,
            ...(variant === "revision"
              ? { revision: 1, text: "changed" }
              : variant === "reload"
                ? { identity: {} }
                : { documentId: "other" }),
          }
    );
    expect(await promise).toBeNull();
    expect(f.service.getSnapshot().status).toBe("idle");
    expect(f.workers[0].terminated).toBe(true);
  }
  const f = fixture();
  const promise = f.service.request();
  f.workers[0].complete();
  await promise;
  f.set({ ...f.get()!, text: "changed", revision: 1 });
  expect(f.service.getSnapshot().status).toBe("idle");
});
test("wrong versions, malformed replies and worker failures settle without stale result", async () => {
  for (const variant of [
    "config",
    "revision",
    "documentId",
    "requestId",
    "error",
    "messageerror",
    "null",
  ] as const) {
    const f = fixture();
    const promise = f.service.request();
    const worker = f.workers[0];
    if (variant === "error") worker.onerror?.({} as ErrorEvent);
    else if (variant === "messageerror")
      worker.onmessageerror?.({} as MessageEvent);
    else {
      const data = worker.response();
      if (variant === "config" || variant === "documentId")
        data.result[variant] = "wrong";
      if (variant === "revision" || variant === "requestId")
        data.result[variant]++;
      worker.onmessage?.({
        data: variant === "null" ? null : data,
      } as MessageEvent);
    }
    expect(await promise).toBeNull();
    expect(f.service.getSnapshot().status).toBe("failed");
    expect(worker.terminated).toBe(true);
  }
  const service = createCurrentCanonical(
    () => ({ documentId: "d", revision: 0, text: "", identity: {} }),
    () => {
      throw Error("unavailable");
    }
  );
  expect(await service.request()).toBeNull();
  expect(service.getSnapshot().status).toBe("failed");
});
test("worker protocol rejects unsupported config, unsafe revision and >1 MiB UTF-8", () => {
  const value = {
    documentId: "d",
    revision: 0,
    requestId: 1,
    config: CANONICAL_CONFIG,
    text: "",
  };
  expect(isCanonicalRequest(value)).toBe(true);
  for (const patch of [
    { config: "other" },
    { revision: -1 },
    { requestId: NaN },
    { text: "中".repeat(400000) },
  ])
    expect(isCanonicalRequest({ ...value, ...patch })).toBe(false);
});

test("explicit disposal settles active request and cannot revive worker", async () => {
  const f = fixture();
  const request = f.service.request();
  f.service.dispose();
  expect(await request).toBeNull();
  expect(await f.service.request()).toBeNull();
  expect(f.workers.length).toBe(1);
  expect(f.workers[0].terminated).toBe(true);
});

test("single discard participant cancels parsing while preserving save drain, dirty prompt and failure recovery", async () => {
  const f = fixture();
  const guard = createDiscardGuard();
  let frozen = false,
    failures = 0,
    allowBegin = true;
  let finishSave!: () => void;
  let wait = new Promise<void>((resolve) => {
    finishSave = resolve;
  });
  const participant = canonicalDiscardParticipant(
    {
      beginDiscard: () => {
        if (!allowBegin) return false;
        frozen = true;
        return true;
      },
      endDiscard: () => {
        frozen = false;
      },
      hasDirty: () => true,
      waitForSaves: () => wait,
      reportDiscardFailure: () => {
        failures++;
      },
    },
    f.service
  );
  guard.register(participant);
  const parsing = f.service.request();
  const request = {
    protocolVersion: 1 as const,
    requestId: crypto.randomUUID(),
    reason: "quit" as const,
  };
  const decision = guard.request(request);
  expect(await parsing).toBeNull();
  expect(frozen).toBe(true);
  expect(guard.getSnapshot()).toBeNull();
  finishSave();
  await Promise.resolve();
  await Promise.resolve();
  expect(guard.getSnapshot()?.message).toContain("未保存");
  guard.respond(false);
  expect((await decision).allow).toBe(false);
  expect(frozen).toBe(false);
  wait = Promise.reject(Error("save failed"));
  expect(
    (await guard.request({ ...request, requestId: crypto.randomUUID() })).allow
  ).toBe(false);
  expect(failures).toBe(1);
  expect(frozen).toBe(false);
  allowBegin = false;
  const blocked = f.service.request();
  expect(
    (await guard.request({ ...request, requestId: crypto.randomUUID() })).allow
  ).toBe(false);
  expect(f.service.getSnapshot().status).toBe("running");
  f.service.cancel();
  await blocked;
});
test("real controller captures unsaved buffer, ignores selection and cancels on reload/close", async () => {
  const text = "# 原文\r\n";
  const value: DocumentSnapshot = {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: "sample.md",
    revision: 1,
    hash: "a".repeat(64),
    byteLength: new TextEncoder().encode(text).length,
    text,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: true, reason: "writable" },
  };
  const transport: DocumentTransport = {
    selectDocument: (request) =>
      Promise.resolve({
        ...request,
        ok: true,
        snapshot: value,
      }),
    readDocument: (request) =>
      Promise.resolve({
        ...request,
        ok: true,
        snapshot: value,
      }),
    cancelDocument: (request) =>
      Promise.resolve({
        ...request,
        ok: true,
        snapshot: null,
      }),
    releaseDocument: (request) =>
      Promise.resolve({
        ...request,
        ok: true,
        snapshot: null,
      }),
  };
  const controller = createDocumentController(transport, () =>
    Promise.resolve(true)
  );
  const workers: FakeWorker[] = [];
  const service = createDocumentCanonical(controller, () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const unsubscribe = controller.subscribe(service.invalidate);
  await controller.select();
  const initial = controller.getEditor(value.documentId)!;
  controller.updateEditor(
    value.documentId,
    initial.state.update({ changes: { from: 2, to: 4, insert: "未保存" } })
  );
  const editor = controller.getEditor(value.documentId)!;
  const request = service.request();
  expect(workers[0].request.text).toBe(editor.state.field(rawText));
  expect(workers[0].request.revision).toBe(1);
  controller.updateEditor(
    value.documentId,
    editor.state.update({ selection: { anchor: 1 } })
  );
  workers[0].complete();
  expect(await request).not.toBeNull();
  expect(controller.isDirty(value.documentId)).toBe(true);
  await controller.reload();
  expect(service.getSnapshot().status).toBe("idle");
  const reload = service.request();
  await controller.reload();
  expect(await reload).toBeNull();
  const close = service.request();
  await controller.closeActive();
  expect(await close).toBeNull();
  unsubscribe();
  service.cancel();
  controller.dispose();
});
