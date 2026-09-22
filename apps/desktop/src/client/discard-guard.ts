import {
  isDiscardRequest,
  isReloadCommitRequest,
  type DiscardResponse,
  type DiscardReason,
  type ReloadCommitResponse,
} from "../shared/discard";

interface Participant {
  beginDiscard(): boolean;
  endDiscard(): void;
  hasDirty(): boolean;
}
export function createDiscardGuard() {
  let participant: Participant | null = null;
  let dialog: { message: string } | null = null;
  let answer: ((allow: boolean) => void) | null = null;
  let active: {
    id: string;
    promise: Promise<DiscardResponse>;
    released: boolean;
    approved: boolean;
    reason: DiscardReason;
    committed: boolean;
  } | null = null;
  const listeners = new Set<() => void>();
  const completed = new Set<string>();
  function publish() {
    for (const listener of listeners) listener();
  }
  function respond(allow: boolean) {
    const resolve = answer;
    answer = null;
    dialog = null;
    publish();
    resolve?.(allow);
  }
  function ask(message: string): Promise<boolean> {
    if (answer) return Promise.resolve(false);
    dialog = { message };
    const promise = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    publish();
    return promise;
  }
  function release(requestId: string) {
    if (
      typeof requestId !== "string" ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId)
    )
      return;
    completed.add(requestId);
    if (completed.size > 256)
      completed.delete(completed.values().next().value!);
    if (active?.id !== requestId) return;
    // Once browser navigation has been invoked, a lost RPC reply must not
    // re-enable editing before a possibly delayed navigation destroys it.
    if (active.committed) return;
    active.released = true;
    active = null;
    respond(false);
    participant?.endDiscard();
  }
  return {
    ask,
    respond,
    getSnapshot: () => dialog,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    register(value: Participant) {
      participant = value;
      return () => {
        if (participant !== value) return;
        if (active) release(active.id);
        respond(false);
        participant = null;
      };
    },
    request(request: unknown): Promise<DiscardResponse> {
      if (!isDiscardRequest(request))
        return Promise.reject(new Error("Invalid discard request"));
      const denied: DiscardResponse = {
        protocolVersion: 1,
        requestId: request.requestId,
        allow: false,
      };
      if (completed.has(request.requestId)) return Promise.resolve(denied);
      if (active)
        return active.id === request.requestId
          ? active.promise
          : Promise.resolve(denied);
      if (!participant?.beginDiscard()) return Promise.resolve(denied);
      const target = participant;
      const current = {
        id: request.requestId,
        released: false,
        approved: false,
        reason: request.reason,
        committed: false,
        promise: Promise.resolve(denied),
      };
      active = current;
      current.promise = (async () => {
        try {
          const approved =
            !target.hasDirty() ||
            (await ask("是否放弃全部未保存变更？当前编辑尚不支持保存。"));
          if (!approved || current.released || participant !== target) {
            if (active === current) release(current.id);
            return denied;
          }
          current.approved = true;
          return { ...denied, allow: true };
        } catch {
          if (active === current) release(current.id);
          return denied;
        }
      })();
      return current.promise;
    },
    commitReload(request: unknown, reload: () => void): ReloadCommitResponse {
      if (!isReloadCommitRequest(request))
        throw new Error("Invalid reload commit");
      const response: ReloadCommitResponse = { ...request, committed: false };
      if (
        active?.id !== request.requestId ||
        active.reason !== "reload" ||
        !active.approved ||
        active.released ||
        active.committed
      )
        return response;
      const current = active;
      current.committed = true;
      try {
        reload();
        return { ...response, committed: true };
      } catch {
        current.committed = false;
        release(current.id);
        return response;
      }
    },
    release,
  };
}
export const discardGuard = createDiscardGuard();
