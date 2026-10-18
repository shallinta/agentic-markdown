import { validTrashResponse, type TrashAffected, type TrashOperation, type TrashRequest, type TrashResponse, type TrashTarget } from "../shared/trash-document";

import type { createDocumentController } from "./documents";
import type { createFolderWorkspace } from "./workspace";

type Prepared = Extract<TrashResponse, { status: "prepared" }>;
export type TrashChoice = "discard" | "save-first" | "cancel";
export interface TrashDialog { prepared: Prepared; dirty: boolean; stage: "dirty" | "disk" }
export function createTrashDocument(documents: ReturnType<typeof createDocumentController>, folders: ReturnType<typeof createFolderWorkspace>, transport: (request: TrashRequest) => Promise<unknown>, confirm: (dialog: TrashDialog) => Promise<TrashChoice>) {
  let disposed = false, running = false, recoverRequested = false;
  let state = { pending: false, working: false, message: "", canQuery: false };
  const listeners = new Set<() => void>();
  let slot: { target: TrashTarget | null; token: string; parked: boolean; operation?: TrashOperation; phase: "state" | "prepare" | "commit" | "query" | "cancel" | "ack"; prepared?: Prepared; dispatched: boolean; interrupted: boolean; applied: boolean; failed?: boolean; succeeded?: boolean } | undefined;
  const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const targetCurrent = (target: TrashTarget) => target.kind === "root"
    ? folders.getSnapshot().roots.some(root => root.handle === target.root && root.generation === target.generation) && !!folders.getSnapshot().nodes[target.root]?.some(node => node.handle === target.entry && node.kind === "file")
    : documents.getSnapshot().entries.some(entry => entry.handle === target.handle && entry.documentId === target.documentId && entry.explicitStandalone !== false);
  const unpark = (current: NonNullable<typeof slot>) => { if (current.parked) { current.parked = false; folders.cancelFolderRemoval(); } };
  const release = (current: NonNullable<typeof slot>) => { documents.releaseTrashProtection(current.token); unpark(current); };
  const unknown = (current: NonNullable<typeof slot>, working: boolean) => {
    documents.markTrashUncertain(current.prepared?.affected ?? []);
    if (!working) { documents.suspendTrashProtection(current.token); unpark(current); }
    publish({ working, canQuery: true, message: "移入废纸篓的结果暂不可确认，请在系统中核对。原内存内容已保留，不会重复执行。" });
  };
  async function settle() {
    if (!slot || running || disposed) return;
    const current = slot; running = true; publish({ canQuery: false });
    try {
      for (let step = 0; step < 6 && slot === current && !disposed; step++) {
        const base = { protocolVersion: 1 as const, requestId: crypto.randomUUID() };
        const request: TrashRequest = current.phase === "state" ? { ...base, op: "state" }
          : current.phase === "prepare" ? { ...base, ...current.operation!, op: "prepare", target: current.target! }
            : current.phase === "commit" ? { ...base, ...current.operation!, op: "commit", confirmationToken: current.prepared!.confirmationToken }
              : { ...base, ...current.operation!, op: current.phase };
        if (current.phase === "commit") {
          if (current.interrupted || !current.target || !documents.trashProtectionCurrent(current.token) || !targetCurrent(current.target)) { current.phase = "cancel"; continue; }
          current.dispatched = true; publish({ working: true });
        }
        let value: unknown;
        try { value = await transport(request); if (!validTrashResponse(value, request)) throw Error("trash-response"); }
        catch (error) { if (current.operation) current.phase = "query"; throw error; }
        if (disposed || slot !== current) return;
        if (value.status === "state") { current.operation = { session: value.session, sequence: value.sequence }; current.phase = current.target ? "prepare" : "query"; continue; }
        if (value.status === "prepared") {
          if (current.dispatched) { current.phase = "query"; unknown(current, false); return; }
          current.prepared = value;
          if (current.interrupted || !current.target || !documents.trashProtectionCurrent(current.token) || !targetCurrent(current.target)) { current.phase = "cancel"; continue; }
          // Closed grants are also returned; only existing tabs can have drafts.
          const affected: TrashAffected[] = value.affected;
          let decision: TrashChoice = "discard";
          if (documents.trashNeedsDiscard(affected)) decision = await confirm({ prepared: value, dirty: true, stage: "dirty" });
          if (disposed || slot !== current) return;
          if (current.interrupted || !documents.trashProtectionCurrent(current.token) || !targetCurrent(current.target)) decision = "cancel";
          if (decision === "discard") decision = await confirm({ prepared: value, dirty: documents.trashNeedsDiscard(affected), stage: "disk" });
          if (disposed || slot !== current) return;
          if (current.interrupted || !documents.trashProtectionCurrent(current.token) || !targetCurrent(current.target)) decision = "cancel";
          if (decision === "save-first") publish({ message: "本次操作已取消。请先正常保存，再重新选择文件并确认移入废纸篓。" });
          current.phase = decision === "discard" ? "commit" : "cancel"; continue;
        }
        if (value.status === "trashed") {
          current.succeeded = true;
          current.phase = "query";
          if (!current.applied) {
            if (current.interrupted) { documents.markTrashUncertain(value.publication.documents); unknown(current, false); publish({ message: "系统已完成移入废纸篓；内存内容因退出或版本变化保留，请自行核对后关闭文档。" }); return; }
            const confirmed = current.prepared?.affected;
            if (!confirmed || value.publication.documents.some(item => !confirmed.some(old => old.handle === item.handle && old.documentId === item.documentId))) throw Error("trash-publication-binding");
            if (!documents.trashProtectionCurrent(current.token) && !documents.resumeTrashProtection(current.token)) throw Error("trash-confirmation-changed");
            if (!current.parked) { if (!folders.beginFolderRemoval()) throw Error("trash-workspace-unavailable"); current.parked = true; }
            const dp = documents.prepareTrashedDocument(current.token, value.publication);
            const fp = folders.prepareTrashedDocument(value.publication);
            documents.swapTrashedDocument(dp); folders.swapPrepared(fp);
            current.applied = true;
            documents.flushPreparedEffects(dp); folders.flushPreparedEffects();
            current.parked = false;
          }
          current.phase = "ack"; publish({ working: false, message: "已移入系统废纸篓。" }); continue;
        }
        if (value.status === "acked") { release(current); slot = undefined; publish({ pending: false, working: false, canQuery: false }); return; }
        if (value.status === "failed" || (!current.dispatched && ["busy", "stale"].includes(value.status))) {
          if (value.status === "failed") { current.failed = true; documents.clearTrashUncertain(current.prepared?.affected ?? []); }
          release(current);
          publish({ working: false, message: value.status === "failed" ? "未移入废纸篓，原文档已保留。" : current.target ? "目标暂不可用，未执行移入废纸篓。" : "" });
          if (value.status === "failed") { current.phase = "ack"; continue; }
          slot = undefined; publish({ pending: false, canQuery: false }); return;
        }
        current.phase = "query"; unknown(current, value.working); return;
      }
    } catch {
      if (disposed || slot !== current) return;
      if (!current.operation) { release(current); slot = undefined; publish({ pending: false, working: false, canQuery: false, message: "无法开始操作，未移动文件。" }); }
      else if (current.failed) publish({ working: false, canQuery: true, message: "未移入废纸篓，原文档已保留；回执确认尚未完成，可以再次查询。" });
      else if (current.applied) publish({ working: false, canQuery: true, message: "已移入系统废纸篓，回执确认尚未完成；可以再次查询，不会重复执行。" });
      else if (current.succeeded) { unknown(current, false); publish({ message: "系统已完成移入废纸篓，应用状态尚未接纳；原内存内容已保留，可以再次查询，不会重复执行。" }); }
      else unknown(current, current.dispatched);
    } finally {
      running = false;
      if (slot && !disposed) publish({ canQuery: true });
      if (recoverRequested && !disposed) { recoverRequested = false; void controller.recover(); }
    }
  }
  const controller = {
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, getSnapshot: () => state,
    canStart: (target: TrashTarget | null) => !!target && !disposed && !slot && !running && documents.canSelectFolder() && !folders.getSnapshot().busy && targetCurrent(target),
    async start(target: TrashTarget) {
      if (!controller.canStart(target)) return;
      running = true;
      try {
        const token = await documents.beginTrashProtection();
        if (!token || disposed || !targetCurrent(target) || !folders.beginFolderRemoval()) { if (token) documents.releaseTrashProtection(token); return; }
        slot = { target, token, parked: true, phase: "state", dispatched: false, interrupted: false, applied: false };
        publish({ pending: true, working: false, message: "", canQuery: false });
      } finally { running = false; }
      await settle();
    },
    retry: settle,
    async recover() {
      if (disposed || running || slot) return;
      slot = { target: null, token: "", parked: false, phase: "state", dispatched: false, interrupted: true, applied: false };
      publish({ pending: true });
      await settle();
    },
    attach() { disposed = false; if (running) recoverRequested = true; else void controller.recover(); },
    beforeWindowDiscard() {
      if (!slot) return;
      slot.interrupted = true;
      if (slot.dispatched) documents.markTrashUncertain(slot.prepared?.affected ?? []);
      documents.suspendTrashProtection(slot.token); unpark(slot);
    },
    dispose() { disposed = true; recoverRequested = false; if (slot) release(slot); slot = undefined; listeners.clear(); },
  };
  return controller;
}
