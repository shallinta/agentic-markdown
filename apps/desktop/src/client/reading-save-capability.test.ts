import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentService } from "../bun/documents";

import { createDocumentController } from "./documents";

test.skipIf(process.platform !== "darwin")(
  "actual native save then switching document preserves inactive writable capability",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "agentic-reading-capability-")
    );
    const first = join(directory, "b.md"),
      second = join(directory, "fidelity.md");
    await writeFile(first, "# B\n\n原始内容\n", { mode: 0o600 });
    await writeFile(second, "\uFEFF# fidelity\r\n", { mode: 0o600 });
    let selected = first;
    const service = createDocumentService({
      pickFile: () => Promise.resolve(selected),
      onCapabilityChanged: (handle) => {
        void controller.refreshWriteCapability(handle, true);
      },
    });
    const controller: ReturnType<typeof createDocumentController> =
      createDocumentController({
        selectDocument: (request) => service.select(request),
        readDocument: (request) => service.read(request),
        saveDocument: (request) => service.save(request),
        releaseDocument: (request) => service.release(request),
        cancelDocument: (request) => service.cancel(request),
        checkDocumentWriteCapability: (request) =>
          service.checkWriteCapability(request),
        waitForDocumentSaves: (request) => service.waitForSaves(request),
      });
    try {
      await controller.select();
      const base = controller.getSnapshot().snapshot!;
      expect(base.writeCapability.writable).toBe(true);
      const editor = controller.getEditor(base.documentId)!;
      controller.updateEditor(
        base.documentId,
        editor.state.update({
          changes: {
            from: editor.state.doc.length,
            insert: "\n\n保存验收标记",
          },
        })
      );
      controller.toggleReadingMode();
      await controller.save();
      expect(controller.isDirty(base.documentId)).toBe(false);
      expect(controller.getMode(base.documentId)).toBe("reading");
      selected = second;
      await controller.select();
      // Match the production observer: the active document is polled, inactive
      // documents receive only capability invalidation hints after own save.
      await controller.refreshWriteCapability();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const inactive = controller
        .getSnapshot()
        .tabs.find((tab) => tab.documentId === base.documentId)!;
      expect(inactive.writeCapability).toEqual({
        writable: true,
        reason: "writable",
      });
      expect(
        controller
          .getSnapshot()
          .entries.find((entry) => entry.documentId === base.documentId)!
          .writeCapability
      ).toEqual({ writable: true, reason: "writable" });
    } finally {
      controller.dispose();
      await service.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
);
