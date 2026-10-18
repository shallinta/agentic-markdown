import { expect, test } from "bun:test";

import type {
  CreateMarkdownRequest,
  CreateMarkdownResponse,
} from "../shared/create-markdown";
import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createMarkdownController, duplicateDefaultTarget } from "./create-markdown";
import { createDiscardGuard } from "./discard-guard";
import { canonicalDiscardParticipant } from "./document-canonical";
import { createDocumentController } from "./documents";
import type { FolderState } from "./workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
test("duplicate suggestions use the original name and readonly sources remain eligible", async () => {
  const f = await fixture(true, true);
  f.controller.open(f.target);
  await Bun.sleep(10);
  expect(f.controller.getSnapshot().name).toBe("old copy.md");
  expect(f.controller.getSnapshot().sourceName).toBe("old.md");
  f.controller.check();
  await Bun.sleep(10);
  expect(f.calls.filter(r => r.op === "preview").every(r => r.op === "preview" && r.name === "old.md" && r.suggest)).toBe(true);
  await f.controller.create();
  expect(f.counts().creates).toBe(1);
  expect(f.documents.getSnapshot().snapshot?.documentId).toBe(f.created.documentId);
  expect(f.documents.getEditor(f.old.documentId)?.state.doc.toString()).toBe("");
  const request = f.calls.find(r => r.op === "create");
  expect(request && "source" in request && request.source).toMatchObject({ handle: f.old.handle, documentId: f.old.documentId, expectedRevision: 1, expectedHash: f.old.hash, bufferRevision: 0 });
});

test("duplicate gate rejects actual transactions, history and navigation; settles without changing source state", async () => {
  const f = await fixture(true);
  let editor = f.documents.getEditor(f.old.documentId)!;
  f.documents.updateEditor(f.old.documentId, editor.state.update({ changes: { from: 0, insert: "x" } }));
  expect(f.documents.canDuplicate()).toBe(false);
  expect(f.documents.runHistory("undo")).toBe(true);
  editor = f.documents.getEditor(f.old.documentId)!;
  const originalState = editor.state;
  const held = deferred<CreateMarkdownResponse>();
  f.intercept(r => r.op === "create" ? held.promise : undefined);
  await f.ready();
  const pending = f.controller.create();
  await Bun.sleep(0);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  expect(f.documents.updateEditor(f.old.documentId, originalState.update({ changes: { from: 0, insert: "blocked" } }))).toBe(false);
  expect(f.documents.runHistory("redo")).toBe(false);
  expect(f.documents.canSave()).toBe(false);
  await f.documents.closeActive();
  await f.documents.reload();
  expect(f.documents.getSnapshot().tabs).toHaveLength(1);
  f.documents.notifyInteraction();
  expect(f.documents.getSnapshot().frozen).toBe(true);
  const r = f.calls.find(r => r.op === "create")!;
  if (r.op !== "create") throw Error();
  held.resolve({ protocolVersion: 1, requestId: r.requestId, operation: { session: r.session, sequence: r.sequence }, status: "opened", working: false, snapshot: f.created, entryHandle: crypto.randomUUID() });
  await pending;
  expect(f.documents.getSnapshot().frozen).toBe(false);
  const preserved = f.documents.getEditor(f.old.documentId)!;
  expect(preserved.state.doc.toString()).toBe(originalState.doc.toString());
  expect(preserved.state.selection.toJSON()).toEqual(originalState.selection.toJSON());
  expect(preserved.revision).toBe(editor.revision);
  f.documents.activateTab(f.old.documentId);
  expect(f.documents.runHistory("redo")).toBe(true);
  expect(f.documents.getEditor(f.old.documentId)?.state.doc.toString()).toBe("x");
});

test("transport loss keeps gate and recoverable hidden dialog; terminal unknown releases only gate, never recreates", async () => {
  const f = await fixture(true);
  let terminal = false;
  f.intercept(r => {
    if (r.op === "create") return Promise.reject(Error("lost"));
    if (r.op === "query") return Promise.resolve({ protocolVersion: 1, requestId: r.requestId, operation: { session: r.session, sequence: r.sequence }, status: terminal ? "unknown" : "pending", working: !terminal });
  });
  await f.ready();
  await f.controller.create();
  expect(f.documents.getSnapshot().frozen).toBe(true);
  await f.controller.close();
  expect(f.controller.canOpen()).toBe(true);
  f.controller.open(f.target);
  expect(f.controller.getSnapshot().visible).toBe(true);
  terminal = true;
  await f.controller.query();
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.controller.hasPending()).toBe(true);
  expect(f.controller.getSnapshot().message).toContain("未知");
  await f.controller.create();
  expect(f.calls.filter(r => r.op === "create")).toHaveLength(1);
  expect(f.documents.beginWindowDiscard()).toBe(true);
  f.documents.endDiscard();
});

test("window exit retains dirty protection and cancelling exit cannot revive late duplicate adoption", async () => {
  const f = await fixture(true);
  const other = snapshot("dirty.md");
  await f.documents.adoptCreatedDocument(other, () => true);
  const otherEditor = f.documents.getEditor(other.documentId)!;
  f.documents.updateEditor(other.documentId, otherEditor.state.update({ changes: { from: 0, insert: "keep" } }));
  f.documents.activateTab(f.old.documentId);
  const held = deferred<CreateMarkdownResponse>();
  f.intercept(r => r.op === "create" ? held.promise : undefined);
  await f.ready();
  const pending = f.controller.create();
  await Bun.sleep(0);
  const guard = createDiscardGuard();
  guard.register(canonicalDiscardParticipant(f.documents, { cancel: () => undefined }));
  const exiting = guard.request({ protocolVersion: 1, requestId: crypto.randomUUID(), reason: "quit" });
  await Bun.sleep(0);
  expect(guard.getSnapshot()?.message).toContain("未保存");
  guard.respond(false);
  expect((await exiting).allow).toBe(false);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  const r = f.calls.find(r => r.op === "create")!;
  if (r.op !== "create") throw Error();
  held.resolve({ protocolVersion: 1, requestId: r.requestId, operation: { session: r.session, sequence: r.sequence }, status: "opened", working: false, snapshot: f.created, entryHandle: crypto.randomUUID() });
  await pending;
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.documents.getSnapshot().snapshot?.documentId).toBe(f.old.documentId);
  expect(f.counts().releases).toBe(1);
  expect(f.documents.getEditor(other.documentId)?.state.doc.toString()).toBe("keep");
  f.documents.activateTab(other.documentId);
  expect(f.documents.runHistory("undo")).toBe(true);
});

test("old duplicate gate cannot unfreeze a new owner or the active exit guard", async () => {
  const f = await fixture(true);
  const first = f.documents.acquireDuplicateSource(f.old.handle, f.old.documentId)!;
  expect(first).not.toBeNull();
  f.documents.releaseDuplicateSource({ ...first });
  expect(f.documents.getSnapshot().frozen).toBe(true);
  f.documents.releaseDuplicateSource(first);
  const second = f.documents.acquireDuplicateSource(f.old.handle, f.old.documentId)!;
  f.documents.releaseDuplicateSource(first);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  expect(f.documents.beginWindowDiscard()).toBe(true);
  f.documents.releaseDuplicateSource(second);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  f.documents.endDiscard();
  expect(f.documents.getSnapshot().frozen).toBe(false);
});

test("duplicate default target requires current root or directory proof, never a standalone parent", () => {
  const folders: FolderState = { roots: [{ handle: crypto.randomUUID(), displayPath: "/authorized", name: "root", generation: 3, status: "complete", examined: 2, errors: 0, entries: 2 }], nodes: {}, coveredHandles: [], busy: false, error: null };
  const root = folders.roots[0];
  const directory = crypto.randomUUID();
  folders.nodes[root.handle] = [{ handle: directory, parent: root.handle, name: "sub", displayPath: "/authorized/sub", kind: "directory" }];
  expect(duplicateDefaultTarget("/authorized/a.md", folders)).toEqual({ rootHandle: root.handle, generation: 3 });
  expect(duplicateDefaultTarget("/authorized/sub/a.markdown", folders)).toEqual({ rootHandle: root.handle, generation: 3, directoryHandle: directory });
  expect(duplicateDefaultTarget("/standalone/a.md", folders)).toBeNull();
  expect(duplicateDefaultTarget("/authorized/unprojected/a.md", folders)).toBeNull();
});

test("closing before state reply sends no duplicate and releases the gate", async () => {
  const f = await fixture(true);
  const held = deferred<CreateMarkdownResponse>();
  f.intercept(r => r.op === "state" ? held.promise : undefined);
  await f.ready();
  const pending = f.controller.create();
  expect(f.documents.getSnapshot().frozen).toBe(true);
  await f.controller.close();
  const state = f.calls.find(r => r.op === "state")!;
  held.resolve({ protocolVersion: 1, requestId: state.requestId, status: "state", session: crypto.randomUUID(), sequence: 1 });
  await pending;
  expect(f.calls.filter(r => r.op === "create")).toHaveLength(0);
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.controller.hasPending()).toBe(false);
});

test("a copied response without explicit terminal working flag cannot unfreeze or adopt", async () => {
  const f = await fixture(true);
  f.intercept(r => r.op === "create" ? Promise.resolve({ protocolVersion: 1, requestId: r.requestId, operation: { session: r.session, sequence: r.sequence }, status: "opened", snapshot: f.created }) : undefined);
  await f.ready();
  await f.controller.create();
  expect(f.documents.getSnapshot().frozen).toBe(true);
  expect(f.documents.getSnapshot().tabs).toHaveLength(1);
  expect(f.counts().acks).toBe(0);
  await f.controller.query();
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.documents.getSnapshot().tabs).toHaveLength(2);
});

test("draft editing does not freeze; dirty or IME state prevents submitting a duplicate", async () => {
  const f = await fixture(true);
  await f.ready();
  expect(f.documents.getSnapshot().frozen).toBe(false);
  const editor = f.documents.getEditor(f.old.documentId)!;
  expect(f.documents.updateEditor(f.old.documentId, editor.state.update({ changes: { from: 0, insert: "dirty" } }))).toBe(true);
  await f.controller.create();
  expect(f.calls.some(r => r.op === "create" || r.op === "state")).toBe(false);
  expect(f.documents.runHistory("undo")).toBe(true);
  const release = f.documents.setInteractionCheck(() => false);
  await f.controller.create();
  expect(f.calls.some(r => r.op === "create" || r.op === "state")).toBe(false);
  release();
});

test("source edit during gate release prevents late adoption and releases only the new grant", async () => {
  const f = await fixture(true);
  await f.ready();
  let frozen = false;
  let edited = false;
  const unsubscribe = f.documents.subscribe(() => {
    if (f.documents.getSnapshot().frozen) frozen = true;
    else if (frozen && !edited) {
      edited = true;
      const editor = f.documents.getEditor(f.old.documentId)!;
      f.documents.updateEditor(f.old.documentId, editor.state.update({ changes: { from: 0, insert: "after-release" } }));
    }
  });
  await f.controller.create();
  unsubscribe();
  expect(edited).toBe(true);
  expect(f.counts().releases).toBe(1);
  expect(f.documents.getSnapshot().snapshot?.documentId).toBe(f.old.documentId);
  expect(f.documents.getEditor(f.old.documentId)?.state.doc.toString()).toBe("after-release");
  expect(f.documents.getSnapshot().tabs).toHaveLength(1);
});
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
async function fixture(duplicate = false, readonly = false) {
  const old = snapshot("old.md"),
    created = snapshot("new.md"),
    calls: CreateMarkdownRequest[] = [];
  if (readonly) old.writeCapability = { writable: false, reason: "readonly" };
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
    duplicate,
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
          ...(r.suggest ? { fileName: "old copy.md" } : {}),
        };
      if (r.op === "cancel-preview")
        return { ...base, status: "cancelled-preview", previewId: r.previewId };
      const operation = { session: r.session, sequence: r.sequence };
      if (r.op === "ack") {
        acks++;
        sequence++;
        return { ...base, operation, status: "acked", working: false };
      }
      if (r.op === "release-unpresented") {
        releases++;
        return { ...base, operation, status: "created", released: true, working: false };
      }
      if (r.op === "create") creates++;
      return {
        ...base,
        operation,
        status: "opened",
        working: false,
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
    target,
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
