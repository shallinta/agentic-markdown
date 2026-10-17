import { expect, test } from "bun:test";

import type { DocumentSnapshot } from "../shared/documents";
import type {
  FolderRemovalRequest,
  FolderRemovalResponse,
  FolderRemovalPublication,
} from "../shared/folder-removal";
import { analyzeTextFidelity } from "../shared/text-fidelity";
import type { WorkspaceRoot } from "../shared/workspace";

import { createDocumentController } from "./documents";
import { createFolderRemoval } from "./folder-removal";
import { createFolderWorkspace } from "./workspace";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(
  choice: "keep" | "close" | "cancel" = "keep",
  confirm = true
) {
  const make = (
    name: string,
    explicitStandalone: boolean
  ): DocumentSnapshot => ({
    handle: crypto.randomUUID(),
    documentId: crypto.randomUUID(),
    fileName: name + ".md",
    text: name,
    byteLength: name.length,
    fidelity: analyzeTextFidelity(name),
    hash: "a".repeat(64),
    revision: 1,
    explicitStandalone,
    writeCapability: { writable: true, reason: "writable" },
  });
  const a = make("a", false),
    b = make("b", true),
    c = make("c", true),
    d = make("d", false);
  let selected = a,
    confirmations = 0;
  const documents = createDocumentController(
    {
      selectDocument: (r) =>
        Promise.resolve({ ...r, ok: true, snapshot: selected }),
      readDocument: (r) =>
        Promise.resolve({ ...r, ok: true, snapshot: selected }),
      releaseDocument: () => Promise.resolve(),
      cancelDocument: () => Promise.resolve(),
    },
    () => {
      confirmations++;
      return Promise.resolve(confirm);
    }
  );
  for (const item of [a, b, c, d]) {
    selected = item;
    await documents.select();
  }
  await documents.closeTab(d.documentId);
  const root: WorkspaceRoot = {
    handle: crypto.randomUUID(),
    name: "root",
    displayPath: "/test",
    generation: 1,
    entries: 0,
    examined: 0,
    errors: 0,
    status: "complete",
  };
  let roots = [root];
  const folders = createFolderWorkspace((r) =>
    Promise.resolve({
      protocolVersion: 1,
      requestId: r.requestId,
      ok: true,
      roots,
      coveredHandles: roots.length ? [a.handle, b.handle, d.handle] : [],
      cacheBytes: 0,
    })
  );
  await folders.refresh();
  const session = crypto.randomUUID();
  const calls: FolderRemovalRequest[] = [];
  let choices = 0;
  let committed: FolderRemovalPublication | undefined;
  const backend = async (
    r: FolderRemovalRequest
  ): Promise<FolderRemovalResponse> => {
    await Promise.resolve();
    calls.push(r);
    const base = { protocolVersion: 1 as const, requestId: r.requestId };
    if (r.op === "state")
      return { ...base, status: "state", session, sequence: 1 };
    const operation = {
      session: r.session,
      sequence: r.sequence,
      root: r.root,
    };
    if (r.op === "ack") return { ...base, status: "acked", operation };
    if (r.op === "cancel") return { ...base, status: "rejected", operation };
    if (r.op === "commit") {
      roots = [];
      committed = {
        root: root.handle,
        closed: r.decision === "close" ? [a.handle, b.handle] : [],
        revoked: r.decision === "close" ? [a.handle, d.handle] : [d.handle],
        standalone: r.decision === "keep" ? [a.handle] : [],
        roots: [],
        coveredHandles: [],
        assetEpochs: {},
        cacheBytes: 0,
        queueBytes: 0,
      };
    }
    if (committed)
      return {
        ...base,
        status: "committed",
        operation,
        publication: committed,
      };
    return {
      ...base,
      status: "issued",
      operation,
      documents: [a, b].map((item) => ({
        handle: item.handle,
        documentId: item.documentId,
        fileName: item.fileName,
        explicitStandalone: !!item.explicitStandalone,
      })),
    };
  };
  let transport = backend;
  const owner = createFolderRemoval(
    documents,
    folders,
    (r) => transport(r),
    () => {
      choices++;
      return Promise.resolve(choice);
    }
  );
  const edit = (item: DocumentSnapshot) => {
    documents.activateTab(item.documentId);
    const editor = documents.getEditor(item.documentId)!.state;
    documents.updateEditor(
      item.documentId,
      editor.update({ changes: { from: 0, insert: "dirty" } })
    );
  };
  return {
    a,
    b,
    c,
    d,
    root,
    documents,
    folders,
    owner,
    backend,
    calls,
    edit,
    setTransport: (fn: typeof backend) => {
      transport = fn;
    },
    getChoices: () => choices,
    getConfirmations: () => confirmations,
  };
}

test("keep swaps both stores before every terminal notification; dirty editor and history survive", async () => {
  const f = await fixture();
  f.edit(f.a);
  const editor = f.documents.getEditor(f.a.documentId);
  const terminal: {
    promoted: boolean | undefined;
    tabs: number;
    editor: typeof editor;
  }[] = [];
  const inspect = () => {
    if (!f.folders.getSnapshot().roots.length) {
      terminal.push({
        promoted: f.documents
          .getSnapshot()
          .entries.find((e) => e.handle === f.a.handle)?.explicitStandalone,
        tabs: f.documents.getSnapshot().tabs.length,
        editor: f.documents.getEditor(f.a.documentId),
      });
    }
  };
  const unsubscribeDocuments = f.documents.subscribe(inspect),
    unsubscribeFolders = f.folders.subscribe(inspect);
  await f.owner.remove(f.root.handle);
  expect(terminal.length).toBeGreaterThan(1);
  for (const sample of terminal) {
    expect(sample.promoted).toBe(true);
    expect(sample.tabs).toBe(3);
    expect(sample.editor).toBe(editor);
  }
  expect(f.documents.isDirty(f.a.documentId)).toBe(true);
  expect(
    f.documents.getSnapshot().entries.some((e) => e.handle === f.d.handle)
  ).toBe(false);
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.documents.getSnapshot().folderRemovalPending).toBeUndefined();
  expect(f.getConfirmations()).toBe(0);
  unsubscribeDocuments();
  unsubscribeFolders();
  f.folders.dispose();
  f.documents.dispose();
});

test("close protects dirty targets and preserves original standalone entry; picks successor once", async () => {
  const f = await fixture("close");
  f.edit(f.a);
  f.edit(f.b);
  f.documents.activateTab(f.a.documentId);
  const cEditor = f.documents.getEditor(f.c.documentId);
  await f.owner.remove(f.root.handle);
  expect(f.getConfirmations()).toBe(1);
  expect(f.documents.getSnapshot().tabs.map((tab) => tab.handle)).toEqual([
    f.c.handle,
  ]);
  expect(
    f.documents.getSnapshot().entries.map((entry) => entry.handle)
  ).toEqual([f.b.handle, f.c.handle]);
  expect(f.documents.getSnapshot().snapshot?.handle).toBe(f.c.handle);
  expect(f.documents.getEditor(f.a.documentId)).toBeUndefined();
  expect(f.documents.getEditor(f.c.documentId)?.revision).toBe(
    cEditor?.revision
  );
  f.documents.dispose();
  f.folders.dispose();
});

test("cancel discard preserves both snapshots and releases gate", async () => {
  const f = await fixture("close", false);
  f.edit(f.a);
  const editor = f.documents.getEditor(f.a.documentId),
    roots = f.folders.getSnapshot().roots;
  await f.owner.remove(f.root.handle);
  expect(f.calls.some((r) => r.op === "commit")).toBe(false);
  expect(f.calls.some((r) => r.op === "cancel")).toBe(true);
  expect(f.folders.getSnapshot().roots).toBe(roots);
  expect(f.documents.getEditor(f.a.documentId)).toBe(editor);
  expect(f.documents.getSnapshot().frozen).toBe(false);
  f.documents.dispose();
  f.folders.dispose();
});

test("lost prepare request retries identical plan; lost commit receipt only queries and keeps frozen", async () => {
  const f = await fixture();
  let first = true,
    lostCommit = true;
  const prepares: FolderRemovalRequest[] = [];
  f.setTransport(async (r) => {
    if (r.op === "prepare") {
      prepares.push(r);
      if (first) {
        first = false;
        throw Error("not sent");
      }
    }
    const result = await f.backend(r);
    if (r.op === "commit" && lostCommit) {
      lostCommit = false;
      throw Error("reply lost");
    }
    return result;
  });
  await f.owner.remove(f.root.handle);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  expect(f.documents.beginDiscard()).toBe(false);
  await f.owner.retry();
  expect(prepares).toHaveLength(2);
  expect({ ...prepares[0], requestId: "" }).toEqual({
    ...prepares[1],
    requestId: "",
  });
  expect(f.folders.getSnapshot().roots).toHaveLength(1);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  await f.owner.retry();
  expect(f.folders.getSnapshot().roots).toHaveLength(0);
  expect(f.calls.filter((r) => r.op === "commit")).toHaveLength(1);
  expect(f.getChoices()).toBe(1);
  f.documents.dispose();
  f.folders.dispose();
});

test("unknown stays gated; ack failure keeps committed UI but blocks another removal", async () => {
  const f = await fixture();
  let unknown = true,
    failAck = true;
  f.setTransport(async (r) => {
    if (r.op === "commit" && unknown) {
      await f.backend(r);
      return {
        protocolVersion: 1,
        requestId: r.requestId,
        status: "pending",
        operation: { session: r.session, sequence: r.sequence, root: r.root },
      };
    }
    if (r.op === "query" && unknown)
      return {
        protocolVersion: 1,
        requestId: r.requestId,
        status: "unknown",
        operation: { session: r.session, sequence: r.sequence, root: r.root },
      };
    if (r.op === "ack" && failAck) throw Error("ack lost");
    return f.backend(r);
  });
  await f.owner.remove(f.root.handle);
  await f.owner.retry();
  expect(f.documents.getSnapshot().frozen).toBe(true);
  unknown = false;
  await f.owner.retry();
  expect(f.folders.getSnapshot().roots).toHaveLength(0);
  expect(f.documents.getSnapshot().frozen).toBe(false);
  expect(f.documents.getSnapshot().folderRemovalPending).toBe("ack");
  expect(f.documents.canBeginFolderRemoval()).toBe(false);
  failAck = false;
  await f.owner.retry();
  expect(f.documents.getSnapshot().folderRemovalPending).toBeUndefined();
  f.documents.dispose();
  f.folders.dispose();
});

test("late pre-freeze refresh rejects without publishing error or unlocking busy", async () => {
  const root: WorkspaceRoot = {
    handle: crypto.randomUUID(),
    name: "root",
    displayPath: "/test",
    generation: 1,
    entries: 0,
    examined: 0,
    errors: 0,
    status: "complete",
  };
  const wait = deferred<void>();
  let delayed = false;
  const folders = createFolderWorkspace(async (r) => {
    if (delayed) {
      await wait.promise;
      throw Error("late old request");
    }
    return {
      protocolVersion: 1,
      requestId: r.requestId,
      ok: true,
      roots: [root],
      coveredHandles: [],
      cacheBytes: 0,
    };
  });
  await folders.refresh();
  delayed = true;
  const old = folders.refresh();
  await Promise.resolve();
  expect(folders.beginFolderRemoval()).toBe(true);
  wait.resolve();
  await old.catch(() => undefined);
  await Promise.resolve();
  expect(folders.getSnapshot().busy).toBe(true);
  expect(folders.getSnapshot().error).toBeNull();
  folders.cancelFolderRemoval();
  folders.dispose();
});

test("lost commit before delivery retains the chosen close intent when query is issued", async () => {
  const f = await fixture("close");
  let lost = true;
  f.setTransport(async (r) => {
    if (r.op === "commit" && lost) {
      lost = false;
      throw Error("not delivered");
    }
    return f.backend(r);
  });
  await f.owner.remove(f.root.handle);
  expect(f.documents.getSnapshot().frozen).toBe(true);
  await f.owner.retry();
  expect(f.getChoices()).toBe(1);
  expect(f.documents.getSnapshot().tabs.map((tab) => tab.handle)).toEqual([
    f.c.handle,
  ]);
  f.folders.dispose();
  f.documents.dispose();
});

test("remaining roots can advance while parking, keep prefixes or clear changed generation then refill", async () => {
  for (const changeGeneration of [false, true]) {
    const removed: WorkspaceRoot = {
      handle: crypto.randomUUID(),
      name: "removed",
      displayPath: "/remove",
      generation: 1,
      entries: 0,
      examined: 0,
      errors: 0,
      status: "complete",
    };
    let remaining: WorkspaceRoot = {
      ...removed,
      handle: crypto.randomUUID(),
      name: "remaining",
      displayPath: "/remain",
      status: "scanning",
      entries: 1,
    };
    let roots = [removed, remaining];
    let nodes = [
      {
        handle: crypto.randomUUID(),
        parent: remaining.handle,
        name: "a.md",
        kind: "file" as const,
        displayPath: "/remain/a.md",
      },
    ];
    const folders = createFolderWorkspace((r) =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: r.requestId,
        ok: true,
        roots,
        coveredHandles: [],
        cacheBytes: 0,
        ...(r.op === "page"
          ? {
              root: r.root,
              generation: r.generation,
              nodes: nodes.slice(r.cursor),
              nextCursor: nodes.length,
            }
          : {}),
      })
    );
    await folders.refresh();
    const prefix = folders.getSnapshot().nodes[remaining.handle];
    folders.beginFolderRemoval();
    remaining = {
      ...remaining,
      generation: changeGeneration ? 2 : 1,
      entries: 2,
    };
    nodes = [
      changeGeneration
        ? { ...nodes[0], handle: crypto.randomUUID() }
        : nodes[0],
      {
        ...nodes[0],
        handle: crypto.randomUUID(),
        name: "b.md",
        displayPath: "/remain/b.md",
      },
    ];
    roots = [remaining];
    const result: FolderRemovalPublication = {
      root: removed.handle,
      roots,
      closed: [],
      revoked: [],
      standalone: [],
      coveredHandles: [],
      assetEpochs: {},
      cacheBytes: 0,
      queueBytes: 0,
    };
    const prepared = folders.prepareFolderRemoval(result);
    expect(folders.getSnapshot().roots).toHaveLength(2);
    folders.swapPrepared(prepared);
    expect(folders.getSnapshot().nodes[remaining.handle]).toEqual(
      changeGeneration ? [] : prefix
    );
    folders.flushPreparedEffects();
    await folders.refresh();
    expect(folders.getSnapshot().nodes[remaining.handle]).toEqual(nodes);
    expect(folders.getSnapshot().busy).toBe(false);
    folders.dispose();
  }
});

test("a failing document listener cannot prevent the second store notification", async () => {
  const f = await fixture();
  const observed: (boolean | undefined)[] = [];
  const oldError = console.error;
  const errors: unknown[][] = [];
  console.error = (...values) => {
    errors.push(values);
  };
  const stop = f.documents.subscribe(() => {
    if (
      !f.folders.getSnapshot().roots.length &&
      f.documents.getSnapshot().folderRemovalPending === "ack"
    )
      throw Error("subscriber failure");
  });
  f.folders.subscribe(() => {
    if (!f.folders.getSnapshot().roots.length) {
      observed.push(
        f.documents.getSnapshot().entries.find((e) => e.handle === f.a.handle)
          ?.explicitStandalone
      );
    }
  });
  try {
    await f.owner.remove(f.root.handle);
    expect(observed.length).toBeGreaterThan(0);
    expect(observed.every(Boolean)).toBe(true);
    expect(errors.some((args) => args[0] === "folder-removal-effect")).toBe(
      true
    );
  } finally {
    stop();
    f.folders.dispose();
    f.documents.dispose();
    console.error = oldError;
  }
});
