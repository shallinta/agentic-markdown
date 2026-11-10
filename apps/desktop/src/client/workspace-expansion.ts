import {
  validWorkspaceExpansionRequest,
  validWorkspaceExpansionResponse,
  type WorkspaceExpansionRequest,
} from "../shared/workspace-expansion";

import type { createFolderWorkspace } from "./workspace";

type Folders = Pick<
  ReturnType<typeof createFolderWorkspace>,
  "getSnapshot" | "subscribe"
>;
type Read = Extract<WorkspaceExpansionRequest, { op: "read" }>;
type SetExpansion = Extract<WorkspaceExpansionRequest, { op: "set" }>;
interface Projection {
  generation: number;
  collapsed: boolean;
  expanded: ReadonlySet<string>;
}
interface RootExpansion {
  generation: number;
  entries: number;
  directories: Set<string>;
  persisted?: { collapsed: boolean; expanded: readonly string[] };
  manualRoot?: boolean;
  manual: Map<string, boolean>;
  attempted?: {
    entries: number;
    revision: number;
    sequence: number;
    failed: boolean;
  };
}

const MAX_IN_FLIGHT_WRITES = 64;

/** Restores display state only from current directory capabilities already in the workspace tree. */
export function createWorkspaceExpansion(
  folders: Folders,
  request: (input: WorkspaceExpansionRequest) => Promise<unknown>,
  onWriteFailure: () => void = () => undefined
) {
  let session: object | undefined;
  let reading = false;
  let writing = 0;
  let revision = 0;
  let sequence = 0;
  let snapshot: ReadonlyMap<string, Projection> = new Map();
  const roots = new Map<string, RootExpansion>();
  const listeners = new Set<() => void>();
  let lastFolders: ReturnType<Folders["getSnapshot"]> | undefined;

  const notify = () => listeners.forEach((listener) => listener());

  function updateProjection(
    next: Map<string, Projection>,
    id: string,
    root: RootExpansion
  ) {
    const collapsed = root.manualRoot ?? root.persisted?.collapsed ?? false;
    const expanded = new Set(
      root.persisted?.expanded.filter((dir) => root.directories.has(dir))
    );
    for (const [dir, manual] of root.manual) {
      if (manual) expanded.add(dir);
      else expanded.delete(dir);
    }
    const previous = next.get(id);
    if (
      previous?.generation !== root.generation ||
      previous.collapsed !== collapsed ||
      previous.expanded.size !== expanded.size ||
      [...expanded].some((dir) => !previous.expanded.has(dir))
    )
      next.set(id, { generation: root.generation, collapsed, expanded });
  }

  function publish(next: Map<string, Projection>) {
    if (
      next.size === snapshot.size &&
      [...next].every(([id, value]) => snapshot.get(id) === value)
    )
      return;
    snapshot = next;
    notify();
  }

  const isCurrent = (
    input: WorkspaceExpansionRequest,
    root: RootExpansion,
    owner: object
  ) => session === owner && roots.get(input.root) === root;

  async function send(input: WorkspaceExpansionRequest) {
    try {
      const response = await request(input);
      if (validWorkspaceExpansionResponse(response, input) && response.ok)
        return response;
    } catch {
      // A transport failure has the same retry and warning policy as a rejection.
    }
  }

  async function read(input: Read, root: RootExpansion, owner: object) {
    reading = true;
    const attempt = {
      entries: root.entries,
      revision,
      sequence: ++sequence,
      failed: false,
    };
    root.attempted = attempt;
    try {
      const response = await send(input);
      if (!isCurrent(input, root, owner)) return;
      if (response?.op !== "read") {
        attempt.failed = true;
        return;
      }
      root.persisted = {
        collapsed: response.collapsed,
        expanded: response.expanded,
      };
      const next = new Map(snapshot);
      updateProjection(next, input.root, root);
      publish(next);
    } finally {
      reading = false;
      pump();
    }
  }

  async function write(
    input: SetExpansion,
    root: RootExpansion,
    owner: object
  ) {
    writing++;
    try {
      const response = await send(input);
      if (!response && isCurrent(input, root, owner)) onWriteFailure();
    } finally {
      writing--;
    }
  }

  function pump() {
    if (!session || reading) return;
    let oldest:
      { id: string; root: RootExpansion; sequence: number } | undefined;
    for (const [id, root] of roots) {
      const attempt = root.attempted;
      if (
        attempt?.entries === root.entries &&
        (!attempt.failed || attempt.revision === revision)
      )
        continue;
      const sequence = attempt?.sequence ?? 0;
      if (!oldest || sequence < oldest.sequence)
        oldest = { id, root, sequence };
    }
    if (oldest)
      void read(
        {
          protocolVersion: 1,
          op: "read",
          root: oldest.id,
          generation: oldest.root.generation,
        },
        oldest.root,
        session
      );
  }

  function sync() {
    const current = folders.getSnapshot();
    if (
      current.roots === lastFolders?.roots &&
      current.nodes === lastFolders.nodes
    )
      return;
    lastFolders = current;
    const next = new Map(snapshot);
    const live = new Set(current.roots.map((root) => root.handle));
    for (const id of roots.keys()) {
      if (!live.has(id)) {
        roots.delete(id);
        next.delete(id);
      }
    }
    for (const { handle, generation } of current.roots) {
      let root = roots.get(handle);
      if (root?.generation !== generation) {
        root = {
          generation,
          entries: -1,
          directories: new Set(),
          manual: new Map(),
        };
        roots.set(handle, root);
      }
      const nodes = current.nodes[handle] ?? [];
      if (root.entries === nodes.length) continue;
      for (
        let index = Math.max(root.entries, 0);
        index < nodes.length;
        index++
      ) {
        const node = nodes[index];
        if (node.kind === "directory") root.directories.add(node.handle);
      }
      root.entries = nodes.length;
      updateProjection(next, handle, root);
    }
    publish(next);
    pump();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach() {
      const owner = {};
      session = owner;
      const unsubscribe = folders.subscribe(sync);
      sync();
      return () => {
        unsubscribe();
        if (session !== owner) return;
        session = undefined;
        lastFolders = undefined;
        roots.clear();
        publish(new Map());
      };
    },
    refresh(this: void) {
      revision++;
      pump();
    },
    setManual(
      id: string,
      generation: number,
      expanded: boolean,
      directory?: string
    ) {
      const input: SetExpansion = {
        protocolVersion: 1,
        op: "set",
        root: id,
        generation,
        expanded,
        ...(directory === undefined ? {} : { directory }),
      };
      const root = roots.get(id);
      if (
        !session ||
        root?.generation !== generation ||
        !validWorkspaceExpansionRequest(input) ||
        (directory !== undefined && !root.directories.has(directory))
      )
        return false;
      if (directory === undefined) root.manualRoot = !expanded;
      else root.manual.set(directory, expanded);
      const next = new Map(snapshot);
      updateProjection(next, id, root);
      // Dispatch in input order even while a read is pending. The backend
      // serializes writes and can drain accepted operations during normal quit.
      if (writing < MAX_IN_FLIGHT_WRITES) void write(input, root, session);
      else onWriteFailure();
      publish(next);
      pump();
      return true;
    },
  };
}
