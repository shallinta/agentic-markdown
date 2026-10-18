import { expect, test } from "bun:test";

import type {
  CreateMarkdownRequest,
  CreateMarkdownResponse,
} from "../shared/create-markdown";
import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createMarkdownController } from "./create-markdown";
import { createDocumentController } from "./documents";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function snapshot(name: string): DocumentSnapshot {
  return {
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: name,
    displayPath: `/fixture/${name}`,
    text: "",
    byteLength: 0,
    revision: 1,
    hash: "a".repeat(64),
    fidelity: analyzeTextFidelity(""),
    writeCapability: { writable: true, reason: "writable" },
  };
}
async function fixture() {
  const old = snapshot("old.md"),
    created = snapshot("new.md"),
    calls: CreateMarkdownRequest[] = [];
  const documents = createDocumentController(
    {
      selectDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot: old }),
      readDocument: (r) => Promise.resolve({ ...r, ok: true, snapshot: old }),
      cancelDocument: () => Promise.resolve(),
      releaseDocument: () => Promise.reject(Error("must not silently release")),
    },
    () => Promise.reject(Error("must not discard"))
  );
  await documents.select();
  const session = crypto.randomUUID(),
    target = { rootHandle: crypto.randomUUID(), generation: 1 };
  let sequence = 1,
    creates = 0,
    releases = 0,
    acks = 0,
    located = 0,
    failRefresh = false;
  let intercept:
    | ((
        r: CreateMarkdownRequest
      ) => Promise<CreateMarkdownResponse> | undefined)
    | undefined;
  const controller = createMarkdownController({
    documents,
    targetCurrent: () => true,
    delay: 0,
    refresh: () =>
      failRefresh
        ? Promise.reject(Error("refresh unavailable"))
        : Promise.resolve(),
    locate: () => {
      located++;
    },
    request: async (r) => {
      calls.push(r);
      const custom = intercept?.(r);
      if (custom) return custom;
      const base = { protocolVersion: 1 as const, requestId: r.requestId };
      if (r.op === "state")
        return { ...base, status: "state", session, sequence };
      if (r.op === "preview")
        return {
          ...base,
          status: "preview",
          previewId: r.previewId,
          result: "available",
        };
      if (r.op === "cancel-preview")
        return { ...base, status: "cancelled-preview", previewId: r.previewId };
      const operation = { session: r.session, sequence: r.sequence };
      if (r.op === "ack") {
        acks++;
        sequence++;
        return { ...base, operation, status: "acked" };
      }
      if (r.op === "release-unpresented") {
        releases++;
        return { ...base, operation, status: "created", released: true };
      }
      if (r.op === "create") creates++;
      return {
        ...base,
        operation,
        status: "opened",
        snapshot: created,
        entryHandle: crypto.randomUUID(),
      };
    },
  });
  const ready = async () => {
    controller.open(target);
    controller.setName("new");
    await Bun.sleep(10);
    expect(controller.getSnapshot().preview).toBe("available");
  };
  return {
    controller,
    documents,
    old,
    created,
    calls,
    ready,
    counts: () => ({ creates, releases, acks, located }),
    failRefresh: (value: boolean) => {
      failRefresh = value;
    },
    intercept: (fn: typeof intercept) => {
      intercept = fn;
    },
  };
}
test("created adoption preserves old dirty editor and its undo history", async () => {
  const f = await fixture();
  const editor = f.documents.getEditor(f.old.documentId)!;
  f.documents.updateEditor(
    f.old.documentId,
    editor.state.update({ changes: { from: 0, insert: "旧修改" } })
  );
  await f.ready();
  await f.controller.create();
  expect(f.documents.getSnapshot().tabs).toHaveLength(2);
  expect(f.documents.getSnapshot().snapshot?.documentId).toBe(
    f.created.documentId
  );
  expect(f.documents.getEditor(f.old.documentId)?.state.doc.toString()).toBe(
    "旧修改"
  );
  expect(f.counts()).toEqual({ creates: 1, releases: 0, acks: 1, located: 1 });
  expect(f.controller.hasPending()).toBe(false);
  await f.documents.activate(
    f.documents
      .getSnapshot()
      .entries.find((entry) => entry.handle === f.old.handle)!
  );
  expect(f.documents.runHistory("undo", f.old.documentId)).toBe(true);
  expect(f.documents.getEditor(f.old.documentId)?.state.doc.toString()).toBe(
    ""
  );
});
test("late success after close releases only the unpresented creation grant then acknowledges", async () => {
  const f = await fixture(),
    response = deferred<CreateMarkdownResponse>();
  let captured: Extract<CreateMarkdownRequest, { op: "create" }> | undefined;
  f.intercept((r) => {
    if (r.op === "create") {
      captured = r;
      return response.promise;
    }
  });
  await f.ready();
  const running = f.controller.create();
  await Bun.sleep(0);
  await f.controller.close();
  response.resolve({
    protocolVersion: 1,
    requestId: captured!.requestId,
    operation: captured!,
    status: "opened",
    snapshot: f.created,
  });
  await running;
  expect(f.documents.getSnapshot().tabs.map((t) => t.handle)).toEqual([
    f.old.handle,
  ]);
  expect(f.counts().releases).toBe(1);
  expect(f.counts().acks).toBe(1);
});
test("lost create response is queried and never resent", async () => {
  const f = await fixture();
  f.intercept((r) =>
    r.op === "create" ? Promise.reject(Error("lost")) : undefined
  );
  await f.ready();
  await f.controller.create();
  expect(f.controller.hasPending()).toBe(true);
  await f.controller.query();
  expect(f.calls.filter((r) => r.op === "create")).toHaveLength(1);
  expect(f.documents.getSnapshot().tabs).toHaveLength(2);
});
test("failed ack never reactivates an already adopted and subsequently closed tab", async () => {
  const f = await fixture();
  let failAck = true;
  f.intercept((r) =>
    r.op === "ack" && failAck ? Promise.reject(Error("lost ack")) : undefined
  );
  await f.ready();
  await f.controller.create();
  await f.documents.closeTab(f.created.documentId);
  failAck = false;
  await f.controller.query();
  expect(
    f.documents
      .getSnapshot()
      .tabs.some((t) => t.documentId === f.created.documentId)
  ).toBe(false);
});
test("invalid name has immediate feedback and cannot submit", async () => {
  const f = await fixture();
  await f.ready();
  f.controller.setName("bad ");
  expect(f.controller.getSnapshot().preview).toBe("invalid");
  await f.controller.create();
  expect(f.calls.some((r) => r.op === "create")).toBe(false);
});
test("confirmed name conflict explains the collision and cannot submit", async () => {
  const f = await fixture();
  await f.ready();
  f.intercept((r) =>
    r.op === "preview"
      ? Promise.resolve({
          protocolVersion: 1,
          requestId: r.requestId,
          status: "preview",
          previewId: r.previewId,
          result: "conflict",
        })
      : undefined
  );
  f.controller.setName("existing");
  await Bun.sleep(10);
  expect(f.controller.getSnapshot().preview).toBe("conflict");
  expect(f.controller.getSnapshot().message).toBe(
    "同目录已存在同名或等价名称的项目，请更换名称。"
  );
  await f.controller.create();
  expect(f.calls.some((r) => r.op === "create")).toBe(false);
});
test("acknowledged query recovers a lost successful acknowledgement", async () => {
  const f = await fixture();
  let acked = false;
  f.intercept((r) => {
    if (r.op === "ack") {
      acked = true;
      return Promise.reject(Error("response lost after commit"));
    }
    if (r.op === "query" && acked)
      return Promise.resolve({
        protocolVersion: 1,
        requestId: r.requestId,
        status: "acked",
        operation: r,
      });
  });
  await f.ready();
  await f.controller.create();
  expect(f.controller.hasPending()).toBe(true);
  await f.controller.query();
  expect(f.controller.hasPending()).toBe(false);
  expect(f.documents.getSnapshot().tabs).toHaveLength(2);
});
test("tree refresh failure retries location without recreating or re-adopting document", async () => {
  const f = await fixture();
  f.failRefresh(true);
  await f.ready();
  await f.controller.create();
  expect(f.documents.getSnapshot().tabs).toHaveLength(2);
  expect(f.counts().located).toBe(0);
  f.failRefresh(false);
  await f.controller.query();
  expect(f.counts()).toEqual({ creates: 1, releases: 0, acks: 1, located: 1 });
  expect(f.documents.getSnapshot().tabs).toHaveLength(2);
});
test("unconfirmed cleanup remains recoverable instead of claiming acknowledged", async () => {
  const f = await fixture(),
    response = deferred<CreateMarkdownResponse>();
  let captured: Extract<CreateMarkdownRequest, { op: "create" }> | undefined;
  f.intercept((r) => {
    if (r.op === "create") {
      captured = r;
      return response.promise;
    }
    if (r.op === "release-unpresented") return Promise.reject(Error("lost"));
  });
  await f.ready();
  const running = f.controller.create();
  await Bun.sleep(0);
  await f.controller.close();
  response.resolve({
    protocolVersion: 1,
    requestId: captured!.requestId,
    operation: captured!,
    status: "opened",
    snapshot: f.created,
  });
  await running;
  expect(f.controller.hasPending()).toBe(true);
  expect(f.counts().acks).toBe(0);
  expect(f.documents.getSnapshot().tabs).toHaveLength(1);
});
