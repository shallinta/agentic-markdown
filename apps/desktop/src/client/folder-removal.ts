import {
  validFolderRemovalResponse,
  type FolderRemovalDocument,
  type FolderRemovalOperation,
  type FolderRemovalRequest,
  type FolderRemovalPublication,
} from "../shared/folder-removal";

import type { createDocumentController } from "./documents";
import type { createFolderWorkspace } from "./workspace";

type Documents = ReturnType<typeof createDocumentController>;
type Folders = ReturnType<typeof createFolderWorkspace>;
type Choice = "keep" | "close" | "cancel";

/** One owner, two prepared snapshots; neither store notifies before both swaps. */
export function createFolderRemoval(
  documents: Documents,
  folders: Folders,
  transport: (request: FolderRemovalRequest) => Promise<unknown>,
  choose: (items: FolderRemovalDocument[]) => Promise<Choice>
) {
  let running = false;
  let disposed = false;
  let pending: {
    root: string;
    generation: number;
    phase: "state" | "prepare" | "query" | "commit" | "cancel" | "ack";
    operation?: FolderRemovalOperation;
    decision?: Choice;
    open: { handle: string; documentId: string }[];
    error: string | null;
  } | null = null;
  const apply = (result: FolderRemovalPublication) => {
    const documentPrepared = documents.prepareFolderRemoval(result);
    const folderPrepared = folders.prepareFolderRemoval(result);
    documents.swapPrepared(documentPrepared);
    folders.swapPrepared(folderPrepared);
    documents.flushPreparedEffects(documentPrepared);
    folders.flushPreparedEffects();
  };
  async function settle() {
    if (!pending || running || disposed) return;
    running = true;
    const current = pending;
    try {
      for (let step = 0; step < 6 && pending === current && !disposed; step++) {
        const base = {
          protocolVersion: 1 as const,
          requestId: crypto.randomUUID(),
        };
        const request: FolderRemovalRequest =
          current.phase === "state"
            ? { ...base, op: "state" }
            : current.phase === "prepare"
              ? {
                  ...base,
                  op: "prepare",
                  ...current.operation!,
                  generation: current.generation,
                  documents: current.open,
                }
              : current.phase === "commit"
                ? {
                    ...base,
                    op: "commit",
                    ...current.operation!,
                    decision: current.decision === "close" ? "close" : "keep",
                  }
                : { ...base, op: current.phase, ...current.operation! };
        let value: unknown;
        try {
          value = await transport(request);
          if (!validFolderRemovalResponse(value, request))
            throw Error("folder-removal-response");
        } catch (error) {
          if (["commit", "cancel"].includes(current.phase))
            current.phase = "query";
          throw error;
        }
        if (disposed || pending !== current) return;
        if (value.status === "state") {
          current.operation = {
            session: value.session,
            sequence: value.sequence,
            root: current.root,
          };
          current.phase = "prepare";
          continue;
        }
        if (current.phase === "ack") {
          if (value.status !== "acked") throw Error("folder-removal-ack");
          pending = null;
          documents.setFolderRemovalStatus(null, current.error);
          return;
        }
        if (value.status === "issued") {
          if (current.decision) {
            current.phase = current.decision === "cancel" ? "cancel" : "commit";
            continue;
          }
          const tabs = documents.getSnapshot().tabs;
          if (
            value.documents.some(
              (item) =>
                !current.open.some(
                  (open) =>
                    open.handle === item.handle &&
                    open.documentId === item.documentId
                ) ||
                !tabs.some(
                  (tab) =>
                    tab.handle === item.handle &&
                    tab.documentId === item.documentId
                )
            )
          )
            throw Error("folder-removal-plan");
          let decision: Choice;
          try {
            decision = await choose(value.documents);
          } catch {
            decision = "cancel";
          }
          if (disposed || pending !== current) return;
          if (
            decision === "close" &&
            !(await documents.confirmFolderRemovalClose(value.documents))
          )
            decision = "cancel";
          current.decision = decision;
          current.phase = decision === "cancel" ? "cancel" : "commit";
          continue;
        }
        if (value.status === "committed") {
          current.phase = "query";
          apply(value.publication);
          current.phase = "ack";
          continue;
        }
        if (value.status === "rejected") {
          current.error =
            current.decision === "cancel"
              ? null
              : "未移除目录，原文档和目录已保留。可重新选择保留或关闭。";
          current.phase = "ack";
          documents.setFolderRemovalStatus("ack", current.error);
          folders.cancelFolderRemoval();
          continue;
        }
        if (
          (value.status === "busy" || value.status === "stale-session") &&
          current.phase === "prepare"
        ) {
          pending = null;
          documents.setFolderRemovalStatus(
            null,
            "暂时无法开始移除目录，请稍后重试。"
          );
          folders.cancelFolderRemoval();
          return;
        }
        current.phase = "query";
        throw Error("folder-removal-unknown");
      }
    } catch {
      if (disposed || pending !== current) return;
      if (current.phase === "state") {
        pending = null;
        documents.setFolderRemovalStatus(
          null,
          "无法开始移除目录，窗口内容完整保留。"
        );
        folders.cancelFolderRemoval();
      } else
        documents.setFolderRemovalStatus(
          current.phase === "ack" ? "ack" : "confirming",
          current.phase === "ack"
            ? "目录移除结果已确认，收据回收尚未确认；请重试，暂不能移除其他根。"
            : "目录移除结果尚未确认，窗口内容已保留并锁定。请重试确认结果，勿关闭应用。"
        );
    } finally {
      running = false;
    }
  }
  const owner = {
    canRemove: (root: string | null) =>
      !!root &&
      !disposed &&
      !pending &&
      !running &&
      !folders.getSnapshot().busy &&
      documents.canBeginFolderRemoval() &&
      folders.getSnapshot().roots.some((item) => item.handle === root),
    async remove(root: string) {
      if (!owner.canRemove(root)) return;
      const target = folders
        .getSnapshot()
        .roots.find((item) => item.handle === root)!;
      // Reserve before the first await; a second click cannot begin another plan.
      pending = {
        root,
        generation: target.generation,
        phase: "state",
        open: [],
        error: null,
      };
      const current = pending;
      if (!(await documents.beginFolderRemoval())) {
        pending = null;
        return;
      }
      if (disposed || pending !== current) return;
      if (!folders.beginFolderRemoval()) {
        pending = null;
        documents.setFolderRemovalStatus(
          null,
          "目录操作尚未结束，请稍后重试。"
        );
        return;
      }
      current.open = documents
        .getSnapshot()
        .tabs.map((tab) => ({
          handle: tab.handle,
          documentId: tab.documentId,
        }));
      await settle();
    },
    retry: settle,
    dispose() {
      disposed = true;
    },
  };
  return owner;
}
