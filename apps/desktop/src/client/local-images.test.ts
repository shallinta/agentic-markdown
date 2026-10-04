import { expect, test } from "bun:test";

import { createLocalImages, imagePlaceholder } from "./local-images";

const success = {
  ok: true,
  mime: "image/png",
  data: "AAAA",
  width: 2,
  height: 2,
  identity: "a".repeat(64),
};
test("new authorization pools discard both negative and positive caches", async () => {
  let allowed = false,
    calls = 0;
  const transport = (request: { requestId: string }) => {
    calls++;
    return Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ...(allowed ? success : { ok: false, error: "UNAVAILABLE" }),
    });
  };
  const before = createLocalImages("same-handle", transport);
  expect((await before.load("../assets/a.png")).ok).toBe(false);
  await before.load("../assets/a.png");
  expect(calls).toBe(1);
  before.dispose();
  allowed = true;
  const expanded = createLocalImages("same-handle", transport);
  expect((await expanded.load("../assets/a.png")).ok).toBe(true);
  expanded.dispose();
  allowed = false;
  const revoked = createLocalImages("same-handle", transport);
  expect((await revoked.load("../assets/a.png")).ok).toBe(false);
  expect(calls).toBe(3);
  revoked.dispose();
});

test("generation coalesces references and preserves cached identity", async () => {
  let calls = 0;
  const images = createLocalImages("handle", (request) => {
    calls++;
    return Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ...success,
    });
  });
  const a = images.load("中文 图.png"),
    b = images.load(encodeURIComponent("中文 图.png"));
  expect(a).toBe(b);
  expect((await a).ok).toBe(true);
  await images.load("中文 图.png");
  expect(calls).toBe(1);
  images.dispose();
  expect((await images.load("中文 图.png")).ok).toBe(false);
});

test("dispose settles queued and in-flight reads, drops late receipt", async () => {
  let finish: (value: unknown) => void = () => {
    throw Error("transport not started");
  };
  let calls = 0;
  const images = createLocalImages("handle", () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const a = images.load("a.png"),
    b = images.load("b.png");
  images.dispose();
  expect((await a).ok).toBe(false);
  expect((await b).ok).toBe(false);
  finish(success);
  expect(calls).toBe(1);
});

test("bad response and decoded-pixel budget never enter cache", async () => {
  const wrong = createLocalImages("handle", () => Promise.resolve(success));
  expect((await wrong.load("a.png")).ok).toBe(false);
  const big = createLocalImages("handle", (request) =>
    Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ...success,
      width: 4096,
      height: 4096,
    })
  );
  expect((await big.load("a.png")).ok).toBe(false);
  wrong.dispose();
  big.dispose();
});

test("scopes isolate identically named images and StrictMode effect replay", async () => {
  let calls = 0;
  const transport = (request: { requestId: string }) => {
    calls++;
    return Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ...success,
    });
  };
  const a = createLocalImages("a", transport),
    b = createLocalImages("b", transport);
  const release = a.retain();
  release();
  const second = a.retain();
  await Promise.resolve();
  expect((await a.load("a.png")).ok).toBe(true);
  expect((await b.load("a.png")).ok).toBe(true);
  expect(calls).toBe(2);
  second();
  await Promise.resolve();
  expect((await a.load("new.png")).ok).toBe(false);
  b.dispose();
});

test("untrusted protocols never reach transport and remote display has only hostname", async () => {
  let calls = 0;
  const images = createLocalImages("handle", () => {
    calls++;
    return Promise.resolve(success);
  });
  for (const value of [
    "https://example.com/a",
    "//example.com/a",
    "file:///a",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
  ])
    expect((await images.load(value)).ok).toBe(false);
  expect(calls).toBe(0);
  expect(
    imagePlaceholder("https://user:pass@example.com/private?a=secret")
  ).toBe("远程图片未加载（example.com）");
  expect(imagePlaceholder("assets/中文 图.png")).toBe(null);
  images.dispose();
});

test("each repeated presentation reserves pixels independently and releases idempotently", async () => {
  let calls = 0;
  const images = createLocalImages("handle", (request) => {
    calls++;
    return Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ...success,
      width: 1024,
      height: 1024,
    });
  });
  const result = await images.load("same.png");
  const releases = Array.from({ length: 4 }, () =>
    images.reservePresentation(result)
  );
  expect(releases.every(Boolean)).toBe(true);
  expect(images.reservePresentation(result)).toBe(null);
  releases[0]?.();
  releases[0]?.();
  expect(images.reservePresentation(result)).not.toBe(null);
  expect(images.reservePresentation(result)).toBe(null);
  expect(await images.load("same.png")).toBe(result);
  expect(calls).toBe(1);
  images.dispose();
  for (const release of releases) release?.();
  expect(images.reservePresentation(result)).toBe(null);
});
test("a retained 1024 image does not consume the next small image transport budget", async () => {
  const images = createLocalImages("handle", (request) =>
    Promise.resolve({
      protocolVersion: 1,
      requestId: request.requestId,
      ...success,
      width: request.reference === "big.png" ? 1024 : 2,
      height: request.reference === "big.png" ? 1024 : 2,
    })
  );
  const big = await images.load("big.png");
  expect(big.ok).toBe(true);
  expect(images.reservePresentation(big)).not.toBeNull();
  expect((await images.load("small.png")).ok).toBe(true);
  images.dispose();
});
