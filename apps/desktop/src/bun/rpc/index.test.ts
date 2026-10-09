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

test("source wrapping RPC requires exact boolean metadata and acknowledged persistence", async () => {
  let enabled = true;
  const rpc = createMainWindowRPC({
    ...(createDependencies() as object),
    sourceWrapping: {
      get: () => Promise.resolve(enabled),
      set: (value: boolean) => {
        enabled = value;
        return Promise.resolve();
      },
    },
  } as never) as unknown as {
    handlers: {
      requests: {
        getSourceWrapping(request: unknown): Promise<unknown>;
        setSourceWrapping(request: unknown): Promise<unknown>;
      };
    };
  };
  const h = rpc.handlers.requests;
  expect(await h.getSourceWrapping({})).toEqual({ ok: true, enabled: true });
  expect(await h.setSourceWrapping({ enabled: false })).toEqual({
    ok: true,
    enabled: false,
  });
  expect(await h.getSourceWrapping({ extra: true })).toEqual({ ok: false });
  expect(await h.setSourceWrapping({ enabled: "true" })).toEqual({ ok: false });
  expect(await h.setSourceWrapping({ enabled: true, extra: true })).toEqual({
    ok: false,
  });
  expect(enabled).toBe(false);
});

test("sidebar RPC validates exact metadata and waits for persistence acknowledgement", async () => {
  let writes = 0;
  const deps = {
    ...(createDependencies() as object),
    sidebar: {
      get: () => ({ visible: false, expandedWidth: 340 }),
      save: () => {
        writes++;
        return Promise.resolve();
      },
    },
  };
  const rpc = createMainWindowRPC(deps as never) as unknown as {
    handlers: {
      requests: {
        getSidebarLayout(value: unknown): unknown;
        saveSidebarLayout(value: unknown): Promise<unknown>;
      };
    };
  };
  const handlers = rpc.handlers.requests;
  expect(handlers.getSidebarLayout({})).toEqual({
    ok: true,
    layout: { visible: false, expandedWidth: 340 },
  });
  expect(handlers.getSidebarLayout({ path: "no" })).toEqual({ ok: false });
  for (const value of [
    null,
    [],
    {},
    { visible: true, expandedWidth: 0 },
    { visible: true, expandedWidth: Infinity },
    { visible: true, expandedWidth: 300, path: "no" },
  ])
    expect(await handlers.saveSidebarLayout(value)).toEqual({ ok: false });
  expect(writes).toBe(0);
  expect(
    await handlers.saveSidebarLayout({ visible: true, expandedWidth: 300 })
  ).toEqual({ ok: true });
  expect(writes).toBe(1);
  deps.sidebar.save = () => Promise.reject(Error());
  expect(
    await handlers.saveSidebarLayout({ visible: false, expandedWidth: 300 })
  ).toEqual({ ok: false });
});

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
      selectFolder: true,
      reloadDocument: false,
      clearDocument: false,
      closeDocument: false,
      saveDocument: false,
      undoDocument: false,
      redoDocument: false,
      documentHistory: true,
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
    observe: () => Promise.resolve({ ok: true, requestId: "" }),
    readLocalImage: () =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: "image-test",
        ok: false,
        error: "UNAVAILABLE",
      }),
    checkWriteCapability: () =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: "test",
        handle: "test",
        capability: { writable: true, reason: "writable" },
      }),
    waitForSaves: () =>
      Promise.resolve({
        protocolVersion: 1,
        requestId: "request",
        settled: true,
      }),
    save: (request) => {
      calls.push(`save:${JSON.stringify(request)}`);
      return Promise.resolve({
        protocolVersion: 1 as const,
        requestId: "request",
        ok: false as const,
        error: "INVALID_REQUEST" as const,
      });
    },
    withWriteBarrier: (action) => action(),
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
    "saveDocument",
  ]) {
    expect(
      await rpc.handlers.requests[method]({ protocolVersion: 99 })
    ).toEqual(
      method === "saveDocument"
        ? {
            protocolVersion: 1,
            requestId: "request",
            ok: false,
            error: "INVALID_REQUEST",
          }
        : response
    );
  }
  expect(calls).toEqual([
    'select:{"protocolVersion":99}',
    'read:{"protocolVersion":99}',
    'release:{"protocolVersion":99}',
    'cancel:{"protocolVersion":99}',
    'save:{"protocolVersion":99}',
  ]);
});
