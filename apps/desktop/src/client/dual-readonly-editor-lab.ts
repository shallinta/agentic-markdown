import type { DocumentSnapshot } from "../shared/documents";
import { analyzeTextFidelity } from "../shared/text-fidelity";

import { createDocumentController } from "./documents";

function syntheticDocument(side: "A" | "B"): DocumentSnapshot {
  const serial = side === "A" ? "1" : "2";
  const text = [
    `# 双编辑器实验 ${side}`,
    "这是只读合成内容。通过实验按钮切换活动文档。",
    ...Array.from({ length: 40 }, (_, index) => {
      const marker = `${side}-${String(index + 1).padStart(2, "0")}`;
      return `## ${marker} 章节\n\n${marker} 开始：选择这段文字，观察独立选区与滚动位置。\n\n${marker} 正文：后台重新挂载不应影响另一篇文档。\n\n\`\`\`text\n${marker} 代码第一行\n${marker} 代码第二行\n\`\`\`\n\n${marker} 结束。`;
    }),
    `${side}-END 文档结束`,
  ].join("\n\n");
  return {
    documentId: `03500000-0000-4000-8000-00000000000${serial}`,
    handle: `03500000-0000-4000-9000-00000000000${serial}`,
    fileName: `双编辑器合成-${side}.md`,
    revision: 1,
    hash: (side === "A" ? "a" : "b").repeat(64),
    text,
    byteLength: new TextEncoder().encode(text).length,
    fidelity: analyzeTextFidelity(text),
    writeCapability: { writable: false, reason: "readonly" },
  };
}

/** Isolated in-memory transport: no file grants, disk reads, assets, or saving. */
export async function createDualReadonlyEditorLab() {
  const documents = [syntheticDocument("A"), syntheticDocument("B")] as const;
  let next = 0;
  const controller = createDocumentController({
    selectDocument: request => Promise.resolve({ ...request, ok: true, snapshot: documents[next++] ?? null }),
    readDocument: request => Promise.resolve({ ...request, ok: true, snapshot: documents.find(value => value.handle === request.handle) ?? null }),
    cancelDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
    releaseDocument: request => Promise.resolve({ ...request, ok: true, snapshot: null }),
  });
  try {
    await controller.select();
    await controller.select();
    if (controller.getSnapshot().tabs.length !== 2) throw Error("Synthetic editors unavailable");
    controller.activateTab(documents[0].documentId);
    return { controller, documents, dispose: () => controller.dispose() };
  } catch (error) {
    controller.dispose();
    throw error;
  }
}
