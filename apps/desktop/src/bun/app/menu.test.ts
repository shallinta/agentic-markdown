import { expect, mock, test } from "bun:test";

import {
  applicationMenus as menus,
  electrobunBunMock,
} from "../test-electrobun-mock";

let applicationMenuListener:
  ((event: { data: { action: string } }) => void) | undefined;

await mock.module("electrobun/bun", () => ({
  ...electrobunBunMock,
  ApplicationMenu: {
    ...electrobunBunMock.ApplicationMenu,
    on: (
      _event: string,
      listener: (event: { data: { action: string } }) => void
    ) => {
      applicationMenuListener = listener;
    },
  },
}));

const menuModule = await import("./menu");

test("provides an update-mode menu synchronizer", () => {
  expect(
    (
      menuModule as typeof menuModule & {
        setUpdateModeInMenu?: unknown;
      }
    ).setUpdateModeInMenu
  ).toBeFunction();
});

test("disables the native check-for-updates item in off mode", () => {
  menuModule.registerMenuActions({} as never, () => undefined);
  menuModule.setUpdateModeInMenu("off");

  const latestMenu = menus[menus.length - 1] as {
    submenu: { action?: string; enabled?: boolean }[];
  }[];
  const checkItem = latestMenu[0]?.submenu.find(
    (item) => item.action === "checkForUpdates"
  );
  expect(checkItem?.enabled).toBe(false);
});

test("adds document commands disabled until availability sync before Edit", () => {
  menuModule.registerMenuActions({} as never, () => undefined);

  const latestMenu = menus[menus.length - 1] as {
    label?: string;
    submenu?: {
      label?: string;
      enabled?: boolean;
      action?: string;
      accelerator?: string;
    }[];
  }[];

  expect(latestMenu.slice(1, 3).map(({ label }) => label)).toEqual([
    "文件",
    "编辑",
  ]);
  expect(latestMenu[1]?.submenu).toEqual([
    { label: "新建…", enabled: false },
    {
      label: "选择 Markdown 文件",
      action: "selectDocument",
      enabled: false,
      accelerator: "CommandOrControl+O",
    },
    { label: "重新读取", action: "reloadDocument", enabled: false },
    { label: "清空窗口", action: "clearDocument", enabled: false },
    {
      label: "关闭当前标签",
      action: "closeDocument",
      enabled: false,
      accelerator: "CommandOrControl+W",
    },
  ]);
});

test("adds Toggle Sidebar first in the View menu", () => {
  menuModule.registerMenuActions({} as never, () => undefined);

  const latestMenu = menus[menus.length - 1] as {
    label?: string;
    submenu?: {
      label?: string;
      action?: string;
      accelerator?: string;
      type?: string;
    }[];
  }[];
  const viewMenu = latestMenu.find(({ label }) => label === "视图");

  expect(viewMenu?.submenu?.slice(0, 2)).toEqual([
    {
      label: "切换侧栏",
      action: "toggleSidebar",
      accelerator: "CommandOrControl+B",
    },
    { type: "divider" },
  ]);
});

test("synchronizes command availability once and rejects malformed state", () => {
  menuModule.registerMenuActions({} as never, () => undefined);
  const count = menus.length;
  for (const value of [
    null,
    {},
    { protocolVersion: 2, availability: {} },
    {
      protocolVersion: 1,
      availability: {
        selectDocument: true,
        reloadDocument: false,
        clearDocument: false,
        unknown: true,
      },
    },
    {
      protocolVersion: 1,
      availability: {
        selectDocument: true,
        reloadDocument: false,
        clearDocument: "yes",
      },
    },
  ]) {
    menuModule.setCommandAvailabilityInMenu(value);
  }
  expect(menus).toHaveLength(count);
  const value = {
    protocolVersion: 1,
    availability: {
      selectDocument: true,
      reloadDocument: false,
      clearDocument: true,
      closeDocument: true,
    },
  };
  menuModule.setCommandAvailabilityInMenu(value);
  menuModule.setCommandAvailabilityInMenu(value);
  expect(menus).toHaveLength(count + 1);
  const latest = menus[menus.length - 1] as {
    submenu: { action?: string; enabled?: boolean }[];
  }[];
  expect(
    latest[1].submenu
      .filter((item) => item.action)
      .map((item) => [item.action, item.enabled])
  ).toEqual([
    ["selectDocument", true],
    ["reloadDocument", false],
    ["clearDocument", true],
    ["closeDocument", true],
  ]);
});

test("guards disabled document menu dispatch and resets on registration", () => {
  const execute = mock(() => undefined);
  const window = {} as never;
  menuModule.registerMenuActions(window, execute);
  applicationMenuListener?.({ data: { action: "selectDocument" } });
  expect(execute).not.toHaveBeenCalled();
  menuModule.setCommandAvailabilityInMenu({
    protocolVersion: 1,
    availability: {
      selectDocument: true,
      reloadDocument: false,
      clearDocument: true,
      closeDocument: true,
    },
  });
  applicationMenuListener?.({ data: { action: "selectDocument" } });
  applicationMenuListener?.({ data: { action: "reloadDocument" } });
  applicationMenuListener?.({ data: { action: "clearDocument" } });
  applicationMenuListener?.({ data: { action: "closeDocument" } });
  expect(execute).toHaveBeenNthCalledWith(
    1,
    { type: "selectDocument", args: {} },
    window
  );
  expect(execute).toHaveBeenNthCalledWith(
    2,
    { type: "clearDocument", args: {} },
    window
  );
  expect(execute).toHaveBeenNthCalledWith(
    3,
    { type: "closeDocument", args: {} },
    window
  );
  menuModule.registerMenuActions(window, execute);
  applicationMenuListener?.({ data: { action: "selectDocument" } });
  expect(execute).toHaveBeenCalledTimes(3);
});

test("dispatches the Toggle Sidebar menu action", () => {
  const fakeWindow = {} as never;
  const executeCommand = mock(() => undefined);
  menuModule.registerMenuActions(fakeWindow, executeCommand);

  expect(applicationMenuListener).toBeFunction();
  applicationMenuListener?.({ data: { action: "toggleSidebar" } });

  expect(executeCommand).toHaveBeenCalledWith(
    { type: "toggleSidebar", args: {} },
    fakeWindow
  );
});

test("rebuilds every native menu role and custom action in Chinese", async () => {
  menuModule.registerMenuActions({} as never, () => undefined);
  await (
    menuModule as typeof menuModule & {
      setLocaleInMenu?: (locale: "zh-CN") => Promise<void>;
    }
  ).setLocaleInMenu?.("zh-CN");

  const latestMenu = menus[menus.length - 1] as {
    label?: string;
    submenu?: {
      label?: string;
      role?: string;
      action?: string;
    }[];
  }[];

  expect(latestMenu.slice(1).map(({ label }) => label)).toEqual([
    "文件",
    "编辑",
    "视图",
    "窗口",
    "帮助",
  ]);
  expect(
    latestMenu[0]?.submenu?.find(({ role }) => role === "quit")?.label
  ).toBe("退出 Agentic Markdown");
  expect(
    latestMenu
      .find(({ label }) => label === "编辑")
      ?.submenu?.find(({ role }) => role === "undo")?.label
  ).toBe("撤销");
  expect(
    latestMenu
      .find(({ label }) => label === "窗口")
      ?.submenu?.find(({ role }) => role === "toggleFullScreen")?.label
  ).toBe("切换全屏");
  expect(
    latestMenu
      .find(({ label }) => label === "帮助")
      ?.submenu?.find(({ action }) => action === "openDocumentation")?.label
  ).toBe("查看文档");
});
