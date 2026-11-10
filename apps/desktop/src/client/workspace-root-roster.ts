import {
  validRootRosterResponse,
  type RootRosterRequest,
  type RootRosterResponse,
} from "../shared/root-roster";

export type WorkspaceRootRosterState = Omit<
  RootRosterResponse,
  "protocolVersion"
> & {
  busy: boolean;
};

export function createWorkspaceRootRoster(
  request: (input: RootRosterRequest) => Promise<unknown>
) {
  let state: WorkspaceRootRosterState = {
    pending: [],
    readOnly: false,
    busy: false,
  };
  let attached = false;
  let active: RootRosterRequest | undefined;
  let refreshQueued = false;
  const listeners = new Set<() => void>();

  function publish(next: WorkspaceRootRosterState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  async function run(input: RootRosterRequest) {
    active = input;
    publish({ ...state, busy: true });
    let next = state;
    try {
      const response = await request(input);
      if (!validRootRosterResponse(response))
        throw Error("ROOT_ROSTER_UNAVAILABLE");
      const { pending, readOnly, failure } = response;
      next =
        failure === "busy" || failure === "closed" || failure === "queue-full"
          ? { ...state, failure }
          : { pending, readOnly, failure, busy: true };
    } catch {
      next = { ...state, failure: "io" };
    } finally {
      if (active === input) {
        active = undefined;
        const refresh = refreshQueued;
        refreshQueued = false;
        // A newer notification invalidates a list already in flight. A mutation
        // response still reports the outcome of that specific operation.
        if (!refresh || input.op === "remove")
          publish({ ...next, busy: refresh });
        if (refresh && attached && !active)
          void run({ protocolVersion: 1, op: "list" });
      }
    }
  }

  return {
    getSnapshot: () => state,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach() {
      attached = true;
      return () => {
        attached = false;
        active = undefined;
        refreshQueued = false;
        state = { ...state, busy: false };
      };
    },
    refresh(this: void) {
      if (!attached) return;
      if (active) refreshQueued = true;
      else void run({ protocolVersion: 1, op: "list" });
    },
    async remove(id: string) {
      if (
        !attached ||
        state.busy ||
        state.readOnly ||
        !state.pending.some((row) => row.id === id)
      )
        return;
      await run({ protocolVersion: 1, op: "remove", id });
    },
  };
}
