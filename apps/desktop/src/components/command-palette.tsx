"use client";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@agentic-markdown/ui/ui/command";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { useCommands } from "@/commands";
import { useUpdateStatus } from "@/components/update-status-provider";
import { useUpdateMode } from "@/hooks/use-update-mode";
import {
  COMMAND_META,
  PRODUCT_COMMANDS,
  type Command as AppCommand,
  type CommandType,
} from "@/shared/commands";

/**
 * The ⌘⇧P command palette. Lists every registered command (from
 * {@link COMMAND_META}) and runs the selected one. Commands are shown by
 * product labels and shortcuts. Pass `blacklist` to hide commands that
 * need context the palette can't provide (e.g. a file path).
 */
export function CommandPalette({
  open,
  onOpenChange,
  blacklist = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blacklist?: string[];
}) {
  const { executeCommand, isCommandEnabled } = useCommands();
  const previousFocus = useRef<HTMLElement | null>(null);
  const pendingCommand = useRef<CommandType | null>(null);
  const { t } = useTranslation("commands");
  const { readyVersion } = useUpdateStatus();
  const { mode: updateMode } = useUpdateMode();
  const label = (type: CommandType): string => {
    if (
      type === "selectDocument" ||
      type === "reloadDocument" ||
      type === "clearDocument" ||
      type === "closeDocument"
    )
      return PRODUCT_COMMANDS[type]!.label;
    return PRODUCT_COMMANDS[type]?.label ?? t(type);
  };

  const types = (Object.keys(COMMAND_META) as CommandType[]).filter(
    (type) =>
      !blacklist.includes(type) &&
      (type !== "checkForUpdates" || updateMode !== "off") &&
      (type !== "applyUpdateAndRestart" || readyVersion !== null)
  );

  const run = (type: CommandType) => {
    if (!isCommandEnabled(type)) return;
    pendingCommand.current = type;
    onOpenChange(false);
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="命令面板"
      description="搜索名称，使用方向键选择并按 Enter 执行命令。"
      contentProps={{
        onOpenAutoFocus: () => {
          previousFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          pendingCommand.current = null;
        },
        onCloseAutoFocus: (event) => {
          event.preventDefault();
          const previous = previousFocus.current;
          if (previous?.isConnected) previous.focus();
          const type = pendingCommand.current;
          pendingCommand.current = null;
          // Close focus restoration finishes before a command opens a new UI.
          if (type)
            queueMicrotask(() =>
              executeCommand({ type, args: {} } as AppCommand)
            );
        },
      }}
    >
      <Command>
        <CommandInput placeholder="搜索命令…" />
        <CommandList>
          <CommandEmpty>未找到命令。</CommandEmpty>
          {types.map((type) => (
            <CommandItem
              key={type}
              value={label(type)}
              disabled={!isCommandEnabled(type)}
              onSelect={() => run(type)}
            >
              {label(type)}
              {PRODUCT_COMMANDS[type]?.shortcut && (
                <CommandShortcut>
                  {PRODUCT_COMMANDS[type]?.shortcut}
                </CommandShortcut>
              )}
            </CommandItem>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
