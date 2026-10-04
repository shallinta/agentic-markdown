import { observationText, validObservationEvent, type ObservationBinding, type ObservationRequest, type ObservationStatus } from "../shared/document-observation";
import type { DocumentSnapshot } from "../shared/documents";

export function createDocumentObservation(send: ((request: ObservationRequest) => Promise<unknown>) | undefined, notify: () => void, timeoutMs = 4000) {
  const bindings = new Map<string, ObservationBinding>();
  const states = new Map<string, { status: ObservationStatus; generation: number }>();
  const risks = new Map<string, ObservationStatus>();
  let nextEpoch = 0;
  interface Intent { binding: ObservationBinding; request: ObservationRequest; timer?: ReturnType<typeof setTimeout>; generation: number }
  const pending = new Map<string, Intent>();
  const running = new Set<string>();
  const failed = (item: Intent) => {
    const { binding, request } = item;
    if (request.active && bindings.get(binding.documentId) === binding && (states.get(binding.documentId)?.generation ?? 0) === item.generation) {
      states.set(binding.documentId, { status: "unavailable", generation: item.generation }); notify();
    }
  };
  const pump = () => {
    if (!send) return;
    while (running.size < 4) {
      const candidates = [...pending.values()].filter(item => !running.has(item.binding.handle));
      const item = candidates.find(value => !value.request.active) ?? candidates[0];
      if (!item) return;
      const { binding, request } = item;
      pending.delete(binding.handle); running.add(binding.handle);
      void (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const result = await Promise.race([send(request), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(Error("observation timeout")), timeoutMs); })]);
          if (!result || typeof result !== "object" || Object.keys(result).length !== 2 || !("ok" in result) || result.ok !== true || !("requestId" in result) || result.requestId !== request.requestId) throw Error("observation unavailable");
        } catch { failed(item); }
        finally { clearTimeout(timer); clearTimeout(item.timer); running.delete(binding.handle); pump(); }
      })();
    }
  };
  const transmit = (binding: ObservationBinding, active: boolean) => {
    if (!send) return;
    const previous = pending.get(binding.handle);
    if (previous?.binding === binding && previous.request.active === active) return;
    clearTimeout(previous?.timer);
    const request = { ...binding, active, requestId: crypto.randomUUID() };
    const item: Intent = { binding, request, generation: states.get(binding.documentId)?.generation ?? 0 };
    item.timer = setTimeout(() => failed(item), timeoutMs);
    pending.set(binding.handle, item); pump();
  };
  return {
    sync(tabs: readonly DocumentSnapshot[]) {
      const ids = new Set(tabs.map(tab => tab.documentId));
      for (const [id, old] of bindings) if (!ids.has(id)) { transmit(old, false); bindings.delete(id); states.delete(id); risks.delete(id); }
      for (const tab of tabs) {
        const old = bindings.get(tab.documentId);
        if (old?.handle === tab.handle && old.hash === tab.hash && old.revision === tab.revision) continue;
        if (old && old.handle !== tab.handle) transmit(old, false);
        if (old?.hash !== tab.hash || old.revision !== tab.revision) { states.delete(tab.documentId); risks.delete(tab.documentId); }
        const binding: ObservationBinding = { protocolVersion: 1, handle: tab.handle, documentId: tab.documentId, revision: tab.revision, hash: tab.hash, watchToken: old?.handle === tab.handle ? old.watchToken : crypto.randomUUID(), watchEpoch: old?.handle === tab.handle ? old.watchEpoch : ++nextEpoch };
        bindings.set(tab.documentId, binding); transmit(binding, true);
      }
    },
    apply(this: void, value: unknown) {
      if (!validObservationEvent(value)) return;
      const binding = bindings.get(value.documentId);
      if (binding?.handle !== value.handle || binding.watchToken !== value.watchToken || binding.watchEpoch !== value.watchEpoch || binding.revision !== value.revision || binding.hash !== value.hash || value.generation <= (states.get(value.documentId)?.generation ?? 0)) return;
      if (["content-changed", "missing", "replaced"].includes(value.status)) risks.set(value.documentId, value.status);
      const old = states.get(value.documentId);
      states.set(value.documentId, { status: value.status, generation: value.generation });
      if (old?.status !== value.status) notify();
    },
    status: (id: string) => states.get(id)?.status,
    message: (id: string) => states.get(id)?.status === "unchanged" && risks.has(id) ? "此前检测到的外部变化尚未确认，原内存内容仍保留。" : observationText[states.get(id)?.status ?? "unchanged"],
    accept(id: string) { const old = bindings.get(id); if (old) transmit(old, false); bindings.delete(id); states.delete(id); risks.delete(id); },
    atRisk: (id: string) => risks.has(id),
    replaced(id: string) {
      if (!bindings.has(id)) return;
      risks.set(id, "replaced");
      states.set(id, { status: "replaced", generation: states.get(id)?.generation ?? 0 });
      notify();
    },
    refresh(this: void) { for (const binding of bindings.values()) transmit(binding, true); },
    dispose() { for (const binding of bindings.values()) transmit(binding, false); bindings.clear(); states.clear(); risks.clear(); },
  };
}
