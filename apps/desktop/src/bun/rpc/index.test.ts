import { expect, mock, test } from "bun:test";

import type { DocumentService } from "../../shared/documents";
import { applicationMenus, electrobunBunMock } from "../test-electrobun-mock";

await mock.module("electrobun/bun", () => electrobunBunMock);

const { createMainWindowRPC } = await import(".");
const { registerMenuActions } = await import("../app/menu");

function createDependencies() {
  return {
    executeCommand: () => undefined,
    getMainWindow: () => ({ isFullScreen: () => true }),
    locale: {
      getLocale: () => "en-US",
      setLocale: () => Promise.resolve(),
    },
    updater: {
      getInstalledVersion: () => null,
      getUpdateModeSetting: () => "automatic",
      setUpdateModeSetting: () => Promise.resolve(),
    },
  } as never;
}

test("command availability RPC validates state before updating native menu", () => {
  registerMenuActions({} as never, () => undefined);
  const rpc = createMainWindowRPC(createDependencies()) as unknown as {
    handlers: {
      messages: { commandAvailabilityChanged: (value: unknown) => void };
    };
  };
  const count = applicationMenus.length;
  rpc.handlers.messages.commandAvailabilityChanged({
    protocolVersion: 1,
    availability: { selectDocument: true },
  });
  expect(applicationMenus).toHaveLength(count);
  rpc.handlers.messages.commandAvailabilityChanged({
    protocolVersion: 1,
    availability: {
      selectDocument: true,
      reloadDocument: false,
      clearDocument: false,
      closeDocument: false,
    },
  });
  expect(applicationMenus).toHaveLength(count + 1);
});

test("reports whether the main window is full screen", () => {
  const rpc = createMainWindowRPC(createDependencies()) as unknown as {
    handlers: {
      requests: {
        isFullScreen?: () => { fullScreen: boolean };
      };
    };
  };
  const handler = rpc.handlers.requests.isFullScreen;

  expect(handler).toBeFunction();
  expect(handler?.()).toEqual({ fullScreen: true });
});

test("gets and persists the application locale through typed RPC", async () => {
  let currentLocale = "en-US";
  const dependencies = createDependencies() as unknown as {
    locale: {
      getLocale: () => string;
      setLocale: (locale: string) => Promise<void>;
    };
  };
  dependencies.locale = {
    getLocale: () => currentLocale,
    setLocale: (locale) => {
      currentLocale = locale;
      return Promise.resolve();
    },
  };
  const rpc = createMainWindowRPC(dependencies as never) as unknown as {
    handlers: {
      requests: {
        getLocale?: () => string;
        setLocale?: (params: { locale: string }) => Promise<null>;
      };
    };
  };

  expect(rpc.handlers.requests.getLocale?.()).toBe("en-US");
  expect(
    await rpc.handlers.requests.setLocale?.({ locale: "zh-CN" })
  ).toBeNull();
  expect(rpc.handlers.requests.getLocale?.()).toBe("zh-CN");
});

test("document RPC delegates each request to the validated service boundary", async () => {
  const calls: string[] = [];
  const response = {
    protocolVersion: 1 as const,
    requestId: "request",
    ok: true as const,
    snapshot: null,
  };
  const documents: DocumentService = {
    cancel: (request) => {
      calls.push(`cancel:${JSON.stringify(request)}`);
      return Promise.resolve(response);
    },
    select: (request) => {
      calls.push(`select:${JSON.stringify(request)}`);
      return Promise.resolve(response);
    },
    read: (request) => {
      calls.push(`read:${JSON.stringify(request)}`);
      return Promise.resolve(response);
    },
    release: (request) => {
      calls.push(`release:${JSON.stringify(request)}`);
      return Promise.resolve(response);
    },
    dispose: () => Promise.resolve(),
  };
  const dependencies = createDependencies() as unknown as {
    documents: DocumentService;
  };
  dependencies.documents = documents;
  const rpc = createMainWindowRPC(dependencies as never) as unknown as {
    handlers: {
      requests: Record<string, (request: unknown) => Promise<unknown>>;
    };
  };
  for (const method of [
    "selectDocument",
    "readDocument",
    "releaseDocument",
    "cancelDocument",
  ]) {
    expect(
      await rpc.handlers.requests[method]({ protocolVersion: 99 })
    ).toEqual(response);
  }
  expect(calls).toEqual([
    'select:{"protocolVersion":99}',
    'read:{"protocolVersion":99}',
    'release:{"protocolVersion":99}',
    'cancel:{"protocolVersion":99}',
  ]);
});
