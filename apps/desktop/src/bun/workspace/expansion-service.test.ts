import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  EXPANSION_MAX_DIRS_PER_ROOT,
  validWorkspaceExpansionRequest,
  validWorkspaceExpansionResponse,
} from "../../shared/workspace-expansion";

import {
  createExpansionService,
  type ExpansionServiceDependencies,
} from "./expansion-service";
import { createExpansionStore } from "./expansion-store";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "expansion-service-"));
  dirs.push(dir);
  const store = createExpansionStore(dir),
    root = randomUUID(),
    child = randomUUID(),
    id = randomUUID();
  let live = true,
    identity = true,
    projectCount = 0;
  const deps: ExpansionServiceDependencies = {
    workspace: {
      captureExpansion(handle, generation, directory) {
        if (
          handle !== root ||
          generation !== 2 ||
          (directory !== undefined && directory !== child)
        )
          return undefined;
        return {
          path: "/private/authorized-root",
          ...(directory === child ? { relativePath: "nested/current" } : {}),
          current: () => live,
          project(expanded) {
            projectCount++;
            return expanded.includes("nested/current") ? [child] : [];
          },
        };
      },
    },
    roster: {
      confirmExpansionIdentity: () =>
        Promise.resolve({ id, current: () => identity }),
    },
    store,
  };
  const request = {
    protocolVersion: 1 as const,
    op: "read" as const,
    root,
    generation: 2,
  };
  return {
    dir,
    store,
    deps,
    root,
    child,
    id,
    request,
    live(value: boolean) {
      live = value;
    },
    identity(value: boolean) {
      identity = value;
    },
    projections: () => projectCount,
  };
}

test("actual stored expansion projects only current opaque handles; set replies contain no projection or private identity", async () => {
  const f = await fixture(),
    service = createExpansionService(f.deps);
  const initial = await service.request(f.request);
  expect(initial).toEqual({
    ...f.request,
    ok: true,
    collapsed: false,
    expanded: [],
  });
  const set = {
    ...f.request,
    op: "set" as const,
    expanded: true,
    directory: f.child,
  };
  expect(await service.request(set)).toEqual({
    ...f.request,
    op: "set",
    ok: true,
  });
  await f.store.setDirectoryExpanded(f.id, "not-scanned", true);
  const read = await service.request(f.request);
  expect(read).toEqual({
    ...f.request,
    ok: true,
    collapsed: false,
    expanded: [f.child],
  });
  expect(validWorkspaceExpansionResponse(read, f.request)).toBe(true);
  expect(JSON.stringify(read)).not.toContain(f.id);
  expect(JSON.stringify(read)).not.toContain("nested");
  await service.request({ ...f.request, op: "set", expanded: false });
  expect((await f.store.read()).roots[0].collapsed).toBe(true);
  await f.store.close();
});

test("expired root and roster tickets reject across identity/read awaits without projecting", async () => {
  const f = await fixture();
  const hold = Promise.withResolvers<{ id: string; current(): boolean }>();
  f.deps.roster.confirmExpansionIdentity = () => hold.promise;
  const service = createExpansionService(f.deps),
    pending = service.request(f.request);
  f.live(false);
  hold.resolve({ id: f.id, current: () => true });
  expect(await pending).toEqual({
    protocolVersion: 1,
    ok: false,
    error: "stale",
  });
  expect(f.projections()).toBe(0);
  f.live(true);
  f.deps.roster.confirmExpansionIdentity = () =>
    Promise.resolve({ id: f.id, current: () => false });
  expect((await service.request(f.request)).ok).toBe(false);
  const actualRead = () => f.store.read();
  f.deps.roster.confirmExpansionIdentity = () =>
    Promise.resolve({ id: f.id, current: () => true });
  f.deps.store = {
    ...f.store,
    async read() {
      const result = await actualRead();
      f.live(false);
      return result;
    },
  };
  expect(await createExpansionService(f.deps).request(f.request)).toEqual({
    protocolVersion: 1,
    ok: false,
    error: "stale",
  });
  expect(f.projections()).toBe(0);
  await f.store.close();
});

test("serialized store admission rejects expired set and prune without disk change", async () => {
  const f = await fixture();
  await f.store.setDirectoryExpanded(f.id, "original", true);
  const before = await readFile(join(f.dir, "workspace-expansion.json"));
  let current = true;
  const stale = f.store.setDirectoryExpanded(
    f.id,
    "stale",
    true,
    () => current
  );
  const pruned = f.store.prune([], () => current);
  const removed = f.store.removeRoot(f.id, () => {
    throw Error("expired");
  });
  current = false;
  expect((await stale).failure).toBe("stale");
  expect((await pruned).failure).toBe("stale");
  expect((await removed).failure).toBe("stale");
  expect(await readFile(join(f.dir, "workspace-expansion.json"))).toEqual(
    before
  );
  expect((await f.store.read()).failure).toBeUndefined();
  const entered = Promise.withResolvers<void>(),
    resume = Promise.withResolvers<void>();
  f.deps.store = {
    ...f.store,
    async setRootCollapsed(id, value, admitted) {
      entered.resolve();
      await resume.promise;
      return f.store.setRootCollapsed(id, value, admitted);
    },
  };
  const request = createExpansionService(f.deps).request({
    ...f.request,
    op: "set",
    expanded: false,
  });
  await entered.promise;
  f.identity(false);
  resume.resolve();
  expect(await request).toEqual({
    protocolVersion: 1,
    ok: false,
    error: "stale",
  });
  expect(await readFile(join(f.dir, "workspace-expansion.json"))).toEqual(
    before
  );
  await f.store.close();
});

test("protected storage and malformed protocol fail without exposing persisted paths", async () => {
  const f = await fixture();
  const future = '{"version":7,"data":{"roots":[]}}';
  await writeFile(join(f.dir, "workspace-expansion.json"), future);
  const service = createExpansionService(f.deps),
    failure = { protocolVersion: 1, ok: false, error: "unavailable" } as const;
  expect(await service.request(f.request)).toEqual(failure);
  expect(
    await service.request({ ...f.request, op: "set", expanded: true })
  ).toEqual(failure);
  expect(await readFile(join(f.dir, "workspace-expansion.json"), "utf8")).toBe(
    future
  );
  for (const request of [
    { ...f.request, path: "../escape" },
    { ...f.request, root: "/path" },
    { ...f.request, generation: 0 },
    { ...f.request, op: "set", expanded: 1 },
    { ...f.request, op: "set", expanded: true, directory: "relative/path" },
    { ...f.request, directory: f.child },
  ]) {
    expect(validWorkspaceExpansionRequest(request)).toBe(false);
    expect(await service.request(request)).toEqual(failure);
  }
  expect(
    validWorkspaceExpansionResponse({
      ...f.request,
      ok: true,
      collapsed: false,
      expanded: Array.from({ length: EXPANSION_MAX_DIRS_PER_ROOT + 1 }, () =>
        randomUUID()
      ),
    })
  ).toBe(false);
  expect(
    validWorkspaceExpansionResponse({
      ...f.request,
      ok: true,
      collapsed: false,
      expanded: [f.child, f.child],
    })
  ).toBe(false);
  expect(
    validWorkspaceExpansionResponse({
      ...f.request,
      op: "set",
      ok: true,
      expanded: [],
    })
  ).toBe(false);
  await f.store.close();
});

test("capture current exceptions and unknown live directory never create metadata", async () => {
  const f = await fixture(),
    service = createExpansionService(f.deps);
  expect(
    await service.request({
      ...f.request,
      op: "set",
      expanded: true,
      directory: randomUUID(),
    })
  ).toEqual({ protocolVersion: 1, ok: false, error: "stale" });
  f.deps.workspace.captureExpansion = () => ({
    path: "/private",
    current() {
      throw Error("stale");
    },
    project: () => [],
  });
  expect(await service.request(f.request)).toEqual({
    protocolVersion: 1,
    ok: false,
    error: "stale",
  });
  expect(
    await stat(join(f.dir, "workspace-expansion.json")).catch(() => null)
  ).toBeNull();
  await f.store.close();
});

test("successful expansion protocol rejects truthy nonboolean ok and sparse handle arrays", () => {
  const response = {
    protocolVersion: 1,
    op: "read",
    ok: true,
    root: randomUUID(),
    generation: 1,
    collapsed: false,
    expanded: [],
  };
  expect(validWorkspaceExpansionResponse({ ...response, ok: "true" })).toBe(
    false
  );
  expect(validWorkspaceExpansionResponse({ ...response, ok: 1 })).toBe(false);
  expect(
    validWorkspaceExpansionResponse({
      ...response,
      expanded: new Array<string>(1),
    })
  ).toBe(false);
  expect(
    validWorkspaceExpansionResponse({ ...response, expanded: [randomUUID()] })
  ).toBe(true);
});
