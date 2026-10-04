import { expect, test } from "bun:test";

import {
  handleImageWorkerRequest,
  validImageWorkerRequest,
  validImageWorkerResponse,
} from "./image-worker-protocol";
const request = {
  protocolVersion: 1,
  kind: "read-local-image",
  id: 1,
  job: {
    reference: "a.png",
    authorization: {
      selectedPath: "/tmp/a.md",
      path: "/tmp/a.md",
      selectedParent: "/tmp",
      fingerprint: "1:2:3",
      directories: [
        { path: "/", fingerprint: "1:1:1" },
        { path: "/tmp", fingerprint: "1:2:2" },
      ],
    },
  },
};
test("asset scope is optional but any supplied scope has an exact bounded runtime schema", () => {
  const assetRoot = {
    path: "/tmp",
    directories: request.job.authorization.directories,
  };
  const scoped = { ...request, job: { ...request.job, assetRoot } };
  expect(validImageWorkerRequest(scoped)).toBe(true);
  for (const invalid of [
    null,
    {},
    { path: "/tmp" },
    { ...assetRoot, extra: true },
    { ...assetRoot, path: "/tmp/../other" },
    { ...assetRoot, directories: [] },
    { ...assetRoot, directories: new Array(2) },
    { ...assetRoot, directories: [{ path: "/tmp", fingerprint: "forged" }] },
  ])
    expect(
      validImageWorkerRequest({
        ...request,
        job: { ...request.job, assetRoot: invalid },
      })
    ).toBe(false);
});
test("malformed worker messages never reach filesystem reader", async () => {
  let reads = 0;
  const read = () => {
    reads++;
    return Promise.resolve({
      ok: false as const,
      error: "UNAVAILABLE" as const,
    });
  };
  const malformed = [
    null,
    undefined,
    [],
    {},
    { ...request, extra: true },
    { ...request, protocolVersion: 2 },
    { ...request, kind: "other" },
    ...[-1, 0, NaN, Infinity, "1"].map((id) => ({ ...request, id })),
    { ...request, job: { ...request.job, reference: "x".repeat(12289) } },
    ...[
      { ...request.job.authorization, path: "relative" },
      { ...request.job.authorization, path: "/bad\0path" },
      { ...request.job.authorization, path: "/" + "x".repeat(4096) },
      { ...request.job.authorization, fingerprint: "invalid" },
      {
        ...request.job.authorization,
        directories: Array(257).fill({ path: "/", fingerprint: "1:1:1" }),
      },
      {
        ...request.job.authorization,
        directories: [{ path: "/", fingerprint: "1:1:1", extra: true }],
      },
    ].map((authorization) => ({
      ...request,
      job: { ...request.job, authorization },
    })),
  ];
  for (const message of malformed) {
    expect(validImageWorkerRequest(message)).toBe(false);
    expect((await handleImageWorkerRequest(message, read)).result).toEqual({
      ok: false,
      error: "INVALID_REQUEST",
    });
  }
  expect(reads).toBe(0);
  expect(validImageWorkerRequest(request)).toBe(true);
  const response = await handleImageWorkerRequest(request, read);
  expect(reads).toBe(1);
  expect(validImageWorkerResponse(response)).toBe(true);
  expect(validImageWorkerResponse({ ...response, extra: true })).toBe(false);
  expect(validImageWorkerResponse({ ...response, kind: "wrong" })).toBe(false);
  expect(validImageWorkerResponse({ ...response, id: 0 })).toBe(false);
});
