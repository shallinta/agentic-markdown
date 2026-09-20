/** Base shape for every command. */
export interface GenericCommand<T extends string, A = Record<string, never>> {
  type: T;
  args: A;
}

export type SettingsTab = "general" | "about";

export interface OpenSettingsCommand extends GenericCommand<
  "openSettings",
  { tab?: SettingsTab }
> {}

export interface OpenCommandPaletteCommand extends GenericCommand<"openCommandPalette"> {}
export interface ToggleSidebarCommand extends GenericCommand<"toggleSidebar"> {}
export interface ZoomInCommand extends GenericCommand<"zoomIn"> {}
export interface ZoomOutCommand extends GenericCommand<"zoomOut"> {}
export interface ResetZoomCommand extends GenericCommand<"resetZoom"> {}
export interface ReloadCommand extends GenericCommand<"reload"> {}
export interface ToggleMaximizedCommand extends GenericCommand<"toggleMaximized"> {}

export interface OpenLinkCommand extends GenericCommand<
  "openLink",
  { url: string }
> {}

export interface CheckForUpdatesCommand extends GenericCommand<"checkForUpdates"> {}
export interface ApplyUpdateAndRestartCommand extends GenericCommand<"applyUpdateAndRestart"> {}

export type Command =
  | GenericCommand<"selectDocument">
  | GenericCommand<"reloadDocument">
  | GenericCommand<"clearDocument">
  | OpenSettingsCommand
  | OpenCommandPaletteCommand
  | ToggleSidebarCommand
  | ZoomInCommand
  | ZoomOutCommand
  | ResetZoomCommand
  | ReloadCommand
  | ToggleMaximizedCommand
  | OpenLinkCommand
  | CheckForUpdatesCommand
  | ApplyUpdateAndRestartCommand;

export type CommandType = Command["type"];
export type CommandArgs<T extends CommandType> = Extract<
  Command,
  { type: T }
>["args"];

export const COMMAND_META: Record<CommandType, { target: "webview" | "bun" }> =
  {
    selectDocument: { target: "webview" },
    reloadDocument: { target: "webview" },
    clearDocument: { target: "webview" },
    openSettings: { target: "webview" },
    openCommandPalette: { target: "webview" },
    toggleSidebar: { target: "webview" },
    zoomIn: { target: "bun" },
    zoomOut: { target: "bun" },
    resetZoom: { target: "bun" },
    reload: { target: "bun" },
    toggleMaximized: { target: "bun" },
    openLink: { target: "bun" },
    checkForUpdates: { target: "bun" },
    applyUpdateAndRestart: { target: "bun" },
  };

/** Product commands; other starter commands remain inherited drafts. */
export const PRODUCT_COMMANDS: Partial<
  Record<
    CommandType,
    {
      label: string;
      accelerator?: string;
      shortcut?: string;
    }
  >
> = {
  selectDocument: {
    label: "选择 Markdown 文件",
    accelerator: "CommandOrControl+O",
    shortcut: "⌘O",
  },
  reloadDocument: { label: "重新读取" },
  clearDocument: { label: "清空" },
  toggleSidebar: {
    label: "切换侧栏",
    accelerator: "CommandOrControl+B",
    shortcut: "⌘B",
  },
  openCommandPalette: {
    label: "打开命令面板",
    accelerator: "CommandOrControl+Shift+P",
    shortcut: "⌘⇧P",
  },
};

export const DOCUMENT_COMMAND_TYPES = [
  "selectDocument",
  "reloadDocument",
  "clearDocument",
] as const;
export type DocumentCommandType = (typeof DOCUMENT_COMMAND_TYPES)[number];
export type CommandAvailability = Record<DocumentCommandType, boolean>;
export interface CommandAvailabilityMessage {
  protocolVersion: 1;
  availability: CommandAvailability;
}

export function isCommandAvailabilityMessage(
  value: unknown
): value is CommandAvailabilityMessage {
  if (typeof value !== "object" || value === null) return false;
  const input = value as Record<string, unknown>;
  if (
    input.protocolVersion !== 1 ||
    Object.keys(input).length !== 2 ||
    typeof input.availability !== "object" ||
    input.availability === null
  )
    return false;
  const availability = input.availability as Record<string, unknown>;
  return (
    Object.keys(availability).length === DOCUMENT_COMMAND_TYPES.length &&
    DOCUMENT_COMMAND_TYPES.every(
      (type) =>
        Object.prototype.hasOwnProperty.call(availability, type) &&
        typeof availability[type] === "boolean"
    )
  );
}
