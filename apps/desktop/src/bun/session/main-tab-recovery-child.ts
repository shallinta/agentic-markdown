// Explicit isolated test fixture. No startup consumer or automatic restoration.
import { join } from "node:path";

import { createDocumentController } from "../../client/documents";
import { createDocumentService } from "../documents";
import { createWorkspaceService } from "../workspace";
import { createRootRosterService } from "../workspace/root-roster-service";

import { createMainTabMetadataBinder } from "./main-tab-binder";
import { createMainTabCandidateResolver } from "./main-tab-candidates";
import { createMainTabMetadataStore } from "./main-tab-metadata";

const [operation, dir] = process.argv.slice(2);
if (!dir || !["write", "read"].includes(operation))
  throw Error("Fixture arguments required");
const paths = [join(dir, "one/same"), join(dir, "two/same")];
let selected = paths[0];
const documents = createDocumentService({
  pickFile: () => Promise.resolve(null),
});
const roster = createRootRosterService(
  join(dir, "roster"),
  () => false,
  () => undefined
);
const workspace = createWorkspaceService({
  documents,
  pickDirectory: () => Promise.resolve(selected),
  onRootRosterCommitted: (event) => roster.committed(event),
});
const store = createMainTabMetadataStore(join(dir, "metadata"));
const controller = createDocumentController({
  cancelDocument: (request) => documents.cancel(request),
  selectDocument: (request) => documents.select(request),
  readDocument: (request) => documents.read(request),
  releaseDocument: (request) => documents.release(request),
  openWorkspaceDocument: (request) => workspace.open(request),
});
const request = () => ({
  protocolVersion: 1 as const,
  requestId: crypto.randomUUID(),
});
const call = async (op: string, details: object = {}) => {
  const response = await workspace.request({ ...request(), op, ...details });
  if (!response.ok) throw Error("Workspace fixture failure");
  return response;
};
async function pick(path: string) {
  selected = path;
  await call("select");
  for (let attempt = 0; attempt < 1000; attempt++) {
    const root = (await call("state")).roots.find(
      (root) => root.displayPath === path
    );
    if (root?.status === "complete") {
      await roster.drain();
      return root;
    }
    await Bun.sleep(2);
  }
  throw Error("Fixture scan incomplete");
}
async function grantCount() {
  const lease = await documents.acquireFolderMutationLease();
  if (!lease) throw Error("Fixture grant inspection unavailable");
  try {
    return lease.bindings().length;
  } finally {
    lease.release();
  }
}
try {
  if (operation === "write") {
    const ids: string[] = [];
    for (const [index, path] of paths.entries()) {
      const root = await pick(path);
      const nodes = (
        await call("page", {
          root: root.handle,
          generation: root.generation,
          cursor: 0,
        })
      ).nodes!;
      for (const name of index === 0 ? ["a.md", "replace.md"] : ["a.md"]) {
        const node = nodes.find((node) => node.name === name);
        if (!node) throw Error("Fixture node missing");
        await controller.openWorkspaceEntry(root.handle, node.handle);
        const active = controller.getSnapshot().snapshot;
        if (!active) throw Error("Fixture open failed");
        ids.push(active.documentId);
      }
    }
    if (
      !controller.setActiveTabPinned(true) ||
      !controller.toggleSourceMode() ||
      !controller.moveTab(ids[1], ids[0], "before")
    )
      throw Error("Fixture ordering failed");
    controller.activateTab(ids[0]);
    const captured = controller.captureCleanPrimaryTabs();
    if (!captured.ok) throw Error("Clean capture failed");
    const receipt = await createMainTabMetadataBinder({
      workspace,
      roster,
    }).bind({ tabs: captured.tabs, activeIndex: captured.activeIndex });
    if (receipt.status !== "ready" || !captured.current() || !receipt.current())
      throw Error("Binding failed");
    const written = await store.write(receipt.data);
    if (written.status !== "committed") throw Error("Fixture write failed");
    console.info(
      JSON.stringify({
        status: "written",
        data: receipt.data,
        openCount: controller.getSnapshot().tabs.length,
      })
    );
  } else {
    const pending = await roster.request({ protocolVersion: 1, op: "list" });
    const initial = {
      pending: pending.pending.length,
      live: (await call("state")).roots.length,
      grants: await grantCount(),
    };
    const saved = await store.read();
    if (saved.status !== "valid") throw Error("Saved fixture missing");
    const resolver = createMainTabCandidateResolver({
      workspace,
      roster,
      store,
    });
    const second = await pick(paths[1]);
    const early = await resolver.resolve(second.handle, second.generation);
    if (early.status !== "ready") throw Error("Second root proof failed");
    const partial = {
      indices: early.items.map((item) => item.savedIndex),
      pending: (await roster.request({ protocolVersion: 1, op: "list" }))
        .pending.length,
      current: early.current(),
    };
    const first = await pick(paths[0]);
    const late = await resolver.resolve(first.handle, first.generation);
    if (late.status !== "ready") throw Error("First root proof failed");
    const staleEarly = !early.current();
    const refreshed = await resolver.resolve(second.handle, second.generation);
    if (refreshed.status !== "ready") throw Error("Refreshed proof failed");
    const recovered = [...late.items, ...refreshed.items]
      .sort((a, b) => a.savedIndex - b.savedIndex)
      .map((item) => ({
        savedIndex: item.savedIndex,
        ...saved.data.tabs[item.savedIndex],
      }));
    const final = {
      grants: await grantCount(),
      tabs: controller.getSnapshot().tabs.length,
      live: (await call("state")).roots.length,
    };
    console.info(
      JSON.stringify({
        status: "resolved",
        initial,
        partial,
        staleEarly,
        recovered,
        activeIndex: saved.data.activeIndex,
        final,
      })
    );
  }
} finally {
  controller.dispose();
  await workspace.dispose();
  await documents.dispose();
  await roster.close();
  await store.close();
}
