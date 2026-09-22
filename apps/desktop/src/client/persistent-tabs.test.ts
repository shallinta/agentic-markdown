import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../bun/documents";
import type { DocumentResponse } from "../shared/documents";

import { createDocumentController, type DocumentTransport } from "./documents";

test("real service tabs preserve snapshots, release replaced grants and survive delayed selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agentic-tabs-"));
  const paths = ["a.md", "b.md", "c.md"].map((name) => join(directory, name));
  for (const path of paths)
    await writeFile(path, path.endsWith("a.md") ? "A" : "B");
  let selected = paths[0];
  const service = createDocumentService({
    pickFile: () => Promise.resolve(selected),
  });
  let reads = 0;
  const transport: DocumentTransport = {
    selectDocument: (request) => service.select(request),
    readDocument: (request) => {
      reads++;
      return service.read(request);
    },
    releaseDocument: (request) => service.release(request),
    cancelDocument: (request) => service.cancel(request),
  };
  const controller = createDocumentController(transport);
  try {
    await controller.select();
    const first = controller.getSnapshot().snapshot!;
    selected = paths[1];
    await controller.select();
    const second = controller.getSnapshot().snapshot!;
    await controller.activate(controller.getSnapshot().entries[0]);
    expect(reads).toBe(0);
    expect(controller.getSnapshot().snapshot).toBe(first);
    controller.setScrollPosition(first.documentId, 80);
    selected = paths[0];
    await writeFile(selected, "changed");
    await controller.select();
    expect(controller.getSnapshot().tabs).toHaveLength(2);
    expect(controller.getSnapshot().snapshot?.text).toBe("A");
    expect(controller.getSnapshot().snapshot?.handle).not.toBe(first.handle);
    await controller.reload();
    expect(controller.getSnapshot().snapshot?.text).toBe("changed");
    expect(controller.getScrollPosition(first.documentId)).toBe(80);

    let deliver!: () => void;
    let committed!: () => void;
    const ready = new Promise<void>((resolve) => {
      committed = resolve;
    });
    transport.selectDocument = async (request) => {
      const response = await service.select(request);
      committed();
      return new Promise<DocumentResponse>((resolve) => {
        deliver = () => resolve(response);
      });
    };
    const pending = controller.select();
    await ready;
    controller.activateTab(second.documentId);
    deliver();
    await pending;
    expect(controller.getSnapshot().snapshot?.documentId).toBe(
      second.documentId
    );
    controller.activateTab(first.documentId);
    await controller.reload();
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().snapshot?.text).toBe("changed");

    transport.selectDocument = (request) => service.select(request);
    selected = paths[2];
    await controller.select();
    const third = controller.getSnapshot().snapshot!;
    controller.activateTab(second.documentId);
    await controller.closeTab(second.documentId);
    expect(controller.getSnapshot().snapshot?.documentId).toBe(
      third.documentId
    );
    await controller.closeTab(first.documentId);
    expect(controller.getSnapshot().snapshot?.documentId).toBe(
      third.documentId
    );
    await controller.closeActive();
    expect(controller.getSnapshot().snapshot).toBeNull();
    expect(controller.getSnapshot().entries).toHaveLength(3);
    expect(controller.getScrollPosition(first.documentId)).toBe(0);
    await controller.activate(controller.getSnapshot().entries[0]);
    expect(controller.getSnapshot().snapshot?.text).toBe("changed");

    let respond!: (value: unknown) => void;
    transport.readDocument = (request) =>
      new Promise((resolve) => {
        respond = (value) =>
          resolve({
            ...request,
            ok: true,
            snapshot: value,
          });
      });
    const reload = controller.reload();
    const old = controller.getSnapshot().snapshot;
    await controller.closeActive();
    respond(old);
    await reload;
    expect(controller.getSnapshot().tabs).toHaveLength(0);
    expect(controller.getSnapshot().snapshot).toBeNull();
  } finally {
    await controller.clear();
    await service.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
