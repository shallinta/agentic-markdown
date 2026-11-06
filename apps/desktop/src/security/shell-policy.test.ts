import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

import {
  PACKAGED_READER_SNAPSHOT_URL,
  PACKAGED_READER_URL,
  READER_CONTENT_SECURITY_POLICY,
  readerNavigationRules,
} from "./reader-policy";
import {
  DEV_VIEW_URL,
  PACKAGED_VIEW_URL,
  SHELL_PRELOAD,
  shellContentSecurityPolicy,
  shellNavigationRules,
} from "./shell-policy";

test("native navigation rules deny everything except the exact shell entry", () => {
  expect(JSON.parse(shellNavigationRules(PACKAGED_VIEW_URL))).toEqual([
    "^*",
    PACKAGED_VIEW_URL,
  ]);
  expect(JSON.parse(shellNavigationRules(DEV_VIEW_URL))).toEqual([
    "^*",
    `${DEV_VIEW_URL}/`,
  ]);
  expect(shellNavigationRules("https://attacker.test")).not.toContain(
    "attacker"
  );
});

test("production CSP allows hashed bootstrap and loopback bridge only", () => {
  const policy = shellContentSecurityPolicy(["'sha256-example'"], false);
  const script = policy
    .split("; ")
    .find((item) => item.startsWith("script-src "))!;
  expect(script).toContain("'sha256-example'");
  expect(script).not.toContain("unsafe");
  expect(policy).not.toContain("http:");
  expect(policy).not.toContain("https:");
  expect(policy).toContain("frame-src 'none'");
  expect(policy).toContain("form-action 'none'");
  expect(
    policy.split("; ").find((item) => item.startsWith("worker-src "))
  ).toBe("worker-src blob:");
  expect(script).not.toContain("blob:");
  expect(
    policy.split("; ").find((item) => item.startsWith("connect-src "))
  ).toBe("connect-src ws://127.0.0.1:*");
  expect(shellContentSecurityPolicy([], true)).toContain(
    "http://localhost:5173"
  );
});

test("the reader allows only its own navigation and no bridge or asset requests", () => {
  expect(JSON.parse(readerNavigationRules())).toEqual(["^*", PACKAGED_READER_URL]);
  expect(JSON.parse(readerNavigationRules(PACKAGED_READER_SNAPSHOT_URL))).toEqual([
    "^*",
    PACKAGED_READER_SNAPSHOT_URL,
  ]);
  expect(shellNavigationRules(PACKAGED_READER_URL)).not.toContain(PACKAGED_READER_URL);
  expect(shellNavigationRules(PACKAGED_READER_SNAPSHOT_URL)).not.toContain(PACKAGED_READER_SNAPSHOT_URL);
  expect(READER_CONTENT_SECURITY_POLICY.split("; ")).toContain("worker-src blob:");
  expect(READER_CONTENT_SECURITY_POLICY.split("; ")).toContain("connect-src 'none'");
  expect(READER_CONTENT_SECURITY_POLICY.split("; ")).toContain("img-src 'none'");
  expect(READER_CONTENT_SECURITY_POLICY).not.toMatch(/unsafe|(?:^|\s)(?:https?|wss?):/);
});

test("shell capture prevents link/download clicks and form submission", () => {
  const handlers = new Map<string, (event: unknown) => void>();
  class Anchor {}
  class Area {}
  runInNewContext(SHELL_PRELOAD, {
    HTMLAnchorElement: Anchor,
    HTMLAreaElement: Area,
    document: {
      addEventListener: (
        name: string,
        handler: (event: unknown) => void,
        capture: boolean
      ) => {
        expect(capture).toBe(true);
        handlers.set(name, handler);
      },
    },
  });
  for (const node of [new Anchor(), new Area()]) {
    let prevented = false;
    handlers.get("click")!({
      composedPath: () => [{}, node],
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
  }
  let prevented = false;
  handlers.get("click")!({
    composedPath: () => [{}],
    preventDefault: () => {
      prevented = true;
    },
  });
  expect(prevented).toBe(false);
  for (const name of ["auxclick", "submit"]) {
    prevented = false;
    handlers.get(name)!({
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
  }
});
