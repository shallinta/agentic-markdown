import { expect, test } from "bun:test";

import type {
  RootRosterRequest,
  RootRosterResponse,
} from "../shared/root-roster";

import { createWorkspaceRootRoster } from "./workspace-root-roster";

const entry = {
  id: "12345678-1234-4321-8765-123456789abc",
  name: "旧目录",
  path: "/原工作区/旧目录",
};
const empty = { protocolVersion: 1, pending: [], readOnly: false } as const;
const listed = { ...empty, pending: [entry] };

function fixture() {
  const calls: {
    input: RootRosterRequest;
    result: ReturnType<typeof Promise.withResolvers<unknown>>;
  }[] = [];
  const model = createWorkspaceRootRoster((input) => {
    const result = Promise.withResolvers<unknown>();
    calls.push({ input, result });
    return result.promise;
  });
  async function respond(index: number, response: RootRosterResponse | null) {
    calls[index].result.resolve(response);
    await Promise.resolve();
  }
  return { calls, model, respond };
}

test("refresh suppresses stale startup data and coalesces change messages", async () => {
  const { calls, model, respond } = fixture();
  const detach = model.attach();
  model.refresh();
  model.refresh();
  model.refresh();
  expect(calls.map((call) => call.input)).toEqual([
    { protocolVersion: 1, op: "list" },
  ]);
  await respond(0, listed);
  expect(model.getSnapshot().pending).toEqual([]);
  expect(calls).toHaveLength(2);
  await respond(1, empty);
  expect(model.getSnapshot()).toMatchObject({ pending: [], busy: false });
  detach();
});

test("remove accepts only a current opaque id, sends once and reconciles a newer list", async () => {
  const { calls, model, respond } = fixture();
  const detach = model.attach();
  model.refresh();
  await respond(0, listed);
  await model.remove("/原工作区/旧目录");
  expect(calls).toHaveLength(1);
  const removal = model.remove(entry.id);
  await model.remove(entry.id);
  expect(calls[1].input).toEqual({
    protocolVersion: 1,
    op: "remove",
    id: entry.id,
  });
  expect(calls).toHaveLength(2);
  model.refresh();
  await respond(1, empty);
  await removal;
  expect(model.getSnapshot()).toMatchObject({ pending: [], busy: true });
  expect(calls[2].input).toEqual({ protocolVersion: 1, op: "list" });
  await respond(2, empty);
  expect(model.getSnapshot()).toMatchObject({ pending: [], busy: false });
  detach();
});

test("old replies cannot replace a reattached view, and transport failures preserve its rows", async () => {
  const { calls, model, respond } = fixture();
  const detach = model.attach();
  model.refresh();
  detach();
  const detachNew = model.attach();
  model.refresh();
  await respond(1, listed);
  await respond(0, empty);
  expect(model.getSnapshot().pending).toEqual([entry]);

  const removal = model.remove(entry.id);
  await respond(2, { ...empty, readOnly: true, failure: "busy" });
  await removal;
  expect(model.getSnapshot()).toMatchObject({
    pending: [entry],
    failure: "busy",
    readOnly: false,
  });
  model.refresh();
  expect(calls).toHaveLength(4);
  await respond(3, null);
  expect(model.getSnapshot()).toMatchObject({
    pending: [entry],
    failure: "io",
    busy: false,
  });
  model.refresh();
  await respond(4, { ...listed, readOnly: true, failure: "future" });
  await model.remove(entry.id);
  expect(calls).toHaveLength(5);
  detachNew();
});

test("an initial transport failure remains retryable without exposing record actions", async () => {
  const { calls, model, respond } = fixture();
  const detach = model.attach();
  model.refresh();
  await respond(0, null);
  expect(model.getSnapshot()).toEqual({
    pending: [],
    readOnly: false,
    busy: false,
    failure: "io",
  });
  await model.remove(entry.id);
  expect(calls).toHaveLength(1);
  model.refresh();
  await respond(1, listed);
  expect(model.getSnapshot()).toMatchObject({ pending: [entry], busy: false });
  detach();
});
