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
  | GenericCommand<"openSourceSearch">
  | GenericCommand<"closeSourceSearch">
  | GenericCommand<"nextSourceMatch">
  | GenericCommand<"previousSourceMatch">
  | GenericCommand<"formatBold", { documentId: string; token?: string }>
  | GenericCommand<"formatItalic", { documentId: string; token?: string }>
  | GenericCommand<"formatCode", { documentId: string; token?: string }>
  | GenericCommand<"setRootHidden", { root: string; showHidden: boolean }>
  | GenericCommand<"readingThemePaper">
  | GenericCommand<"readingThemeInk">
  | GenericCommand<"toggleReadingMode">
  | GenericCommand<"toggleSourceMode">
  | GenericCommand<"undoDocument", { documentId?: string }>
  | GenericCommand<"redoDocument", { documentId?: string }>
  | GenericCommand<"addSourceCursorAbove", { documentId: string }>
  | GenericCommand<"addSourceCursorBelow", { documentId: string }>
  | GenericCommand<"simplifySourceSelection", { documentId: string }>
  | GenericCommand<"continueList", { documentId: string }>
  | GenericCommand<"listSoftBreak", { documentId: string }>
  | GenericCommand<"selectDocument">
  | GenericCommand<"selectFolder">
  | GenericCommand<"saveDocument">
  | GenericCommand<"reloadDocument">
  | GenericCommand<"clearDocument">
  | GenericCommand<"closeDocument">
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

/** RPC types are erased at runtime; reject malformed and surplus payloads. */
export function isCommand(value: unknown): value is Command {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(input, "type") ||
    !Object.prototype.hasOwnProperty.call(input, "args")
  )
    return false;
  if (
    typeof input.type !== "string" ||
    !Object.prototype.hasOwnProperty.call(COMMAND_META, input.type)
  )
    return false;
  if (
    typeof input.args !== "object" ||
    input.args === null ||
    Array.isArray(input.args)
  )
    return false;
  const args = input.args as Record<string, unknown>;
  const keys = Object.keys(args);
  if (
    input.type === "formatBold" ||
    input.type === "formatItalic" ||
    input.type === "formatCode"
  )
    return (
      (keys.length === 1 ||
        (keys.length === 2 &&
          typeof args.token === "string" &&
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
            args.token
          ))) &&
      keys.every((key) => key === "documentId" || key === "token") &&
      typeof args.documentId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        args.documentId
      )
    );
  if (
    input.type === "continueList" ||
    input.type === "listSoftBreak" ||
    input.type === "addSourceCursorAbove" ||
    input.type === "addSourceCursorBelow" ||
    input.type === "simplifySourceSelection"
  )
    return (
      keys.length === 1 &&
      keys[0] === "documentId" &&
      typeof args.documentId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        args.documentId
      )
    );
  if (input.type === "setRootHidden")
    return (
      keys.length === 2 &&
      typeof args.root === "string" &&
      /^[a-f\d-]{36}$/i.test(args.root) &&
      typeof args.showHidden === "boolean"
    );
  if (input.type === "undoDocument" || input.type === "redoDocument")
    return (
      keys.length === 0 ||
      (keys.length === 1 &&
        keys[0] === "documentId" &&
        typeof args.documentId === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          args.documentId
        ))
    );
  if (input.type === "openLink")
    return (
      keys.length === 1 &&
      Object.prototype.hasOwnProperty.call(args, "url") &&
      typeof args.url === "string"
    );
  if (input.type === "openSettings")
    return (
      keys.length === 0 ||
      (keys.length === 1 &&
        Object.prototype.hasOwnProperty.call(args, "tab") &&
        (args.tab === "general" || args.tab === "about"))
    );
  return keys.length === 0;
}
export type CommandArgs<T extends CommandType> = Extract<
  Command,
  { type: T }
>["args"];

export const COMMAND_META: Record<
  CommandType,
  { target: "webview" | "bun"; palette?: false }
> = {
  openSourceSearch: { target: "webview", palette: false },
  closeSourceSearch: { target: "webview", palette: false },
  nextSourceMatch: { target: "webview", palette: false },
  previousSourceMatch: { target: "webview", palette: false },
  formatBold: { target: "webview" },
  formatItalic: { target: "webview" },
  formatCode: { target: "webview" },
  readingThemePaper: { target: "webview" },
  readingThemeInk: { target: "webview" },
  toggleReadingMode: { target: "webview" },
  toggleSourceMode: { target: "webview", palette: false },
  undoDocument: { target: "webview" },
  redoDocument: { target: "webview" },
  addSourceCursorAbove: { target: "webview", palette: false },
  addSourceCursorBelow: { target: "webview", palette: false },
  simplifySourceSelection: { target: "webview", palette: false },
  continueList: { target: "webview", palette: false },
  listSoftBreak: { target: "webview", palette: false },
  selectDocument: { target: "webview" },
  selectFolder: { target: "webview" },
  setRootHidden: { target: "webview", palette: false },
  saveDocument: { target: "webview" },
  reloadDocument: { target: "webview" },
  clearDocument: { target: "webview" },
  closeDocument: { target: "webview" },
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
  formatBold: { label: "切换粗体", shortcut: "⌘⇧B" },
  formatItalic: { label: "切换斜体", shortcut: "⌘⇧I" },
  formatCode: { label: "切换行内代码", shortcut: "⌘E" },
  addSourceCursorAbove: { label: "向上添加光标", shortcut: "⌘⌥↑" },
  addSourceCursorBelow: { label: "向下添加光标", shortcut: "⌘⌥↓" },
  simplifySourceSelection: { label: "保留主选区", shortcut: "Escape" },
  continueList: { label: "列表续写", shortcut: "Enter" },
  listSoftBreak: { label: "列表项内换行", shortcut: "⇧Enter" },
  readingThemePaper: { label: "阅读主题：纸页" },
  readingThemeInk: { label: "阅读主题：墨夜" },
  toggleReadingMode: { label: "切换编辑 / 阅读模式" },
  undoDocument: {
    label: "撤销",
    accelerator: "CommandOrControl+Z",
    shortcut: "⌘Z",
  },
  redoDocument: {
    label: "重做",
    accelerator: "CommandOrControl+Shift+Z",
    shortcut: "⌘⇧Z",
  },
  selectDocument: {
    label: "选择 Markdown 文件",
    accelerator: "CommandOrControl+O",
    shortcut: "⌘O",
  },
  selectFolder: { label: "加入文件夹" },
  setRootHidden: { label: "显示隐藏文件" },
  reloadDocument: { label: "重新读取" },
  saveDocument: {
    label: "保存当前文档",
    accelerator: "CommandOrControl+S",
    shortcut: "⌘S",
  },
  clearDocument: { label: "清空窗口" },
  closeDocument: {
    label: "关闭当前标签",
    accelerator: "CommandOrControl+W",
    shortcut: "⌘W",
  },
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
  "selectFolder",
  "selectDocument",
  "saveDocument",
  "reloadDocument",
  "clearDocument",
  "closeDocument",
] as const;
export type DocumentCommandType = (typeof DOCUMENT_COMMAND_TYPES)[number];
export type CommandAvailability = Record<
  DocumentCommandType | "undoDocument" | "redoDocument" | "documentHistory",
  boolean
>;
const AVAILABILITY_KEYS = [
  ...DOCUMENT_COMMAND_TYPES,
  "undoDocument",
  "redoDocument",
  "documentHistory",
] as const;
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
    Object.keys(availability).length === AVAILABILITY_KEYS.length &&
    AVAILABILITY_KEYS.every(
      (type) =>
        Object.prototype.hasOwnProperty.call(availability, type) &&
        typeof availability[type] === "boolean"
    )
  );
}
