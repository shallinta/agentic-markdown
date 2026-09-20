"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { electrobun } from "@/lib/electrobun";
import { type CommandAvailability, type CommandType } from "@/shared/commands";

import {
  createCommandRegistry,
  type CommandHandlers,
  type CommandGuards,
} from "./registry";

export type { CommandHandlers } from "./registry";
type Registry = ReturnType<typeof createCommandRegistry>;
const CommandContext = createContext<(Registry & { revision: number }) | null>(
  null
);

export function CommandProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(() =>
    createCommandRegistry(
      (command) => electrobun.rpc?.send.executeCommand(command),
      () => toast.error("命令执行失败，请重试。")
    )
  );
  const revision = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot
  );
  const selectDocument = registry.isCommandEnabled("selectDocument");
  const reloadDocument = registry.isCommandEnabled("reloadDocument");
  const clearDocument = registry.isCommandEnabled("clearDocument");
  useEffect(() => {
    const availability: CommandAvailability = {
      selectDocument,
      reloadDocument,
      clearDocument,
    };
    electrobun.rpc?.send.commandAvailabilityChanged({
      protocolVersion: 1,
      availability,
    });
  }, [selectDocument, reloadDocument, clearDocument]);
  useEffect(
    () => () => {
      electrobun.rpc?.send.commandAvailabilityChanged({
        protocolVersion: 1,
        availability: {
          selectDocument: false,
          reloadDocument: false,
          clearDocument: false,
        },
      });
    },
    []
  );
  const value = useMemo(
    () => ({ ...registry, revision }),
    [registry, revision]
  );
  return (
    <CommandContext.Provider value={value}>{children}</CommandContext.Provider>
  );
}

export function useCommands() {
  const value = useContext(CommandContext);
  if (!value)
    throw new Error("useCommands must be used within a CommandProvider");
  return value;
}

/** Stable registration with fresh post-commit handlers and availability. */
export function useRegisterCommands(
  handlers: CommandHandlers,
  enabled = true,
  guards: CommandGuards = {}
) {
  const { registerCommandHandlers, notify } = useCommands();
  const latest = useRef({ handlers, guards });
  useEffect(() => {
    latest.current = { handlers, guards };
  });
  useEffect(() => {
    if (!enabled) return;
    const keys = Object.keys(latest.current.handlers) as CommandType[];
    const trampolineHandlers: CommandHandlers = {};
    const trampolineGuards: CommandGuards = {};
    for (const key of keys) {
      (
        trampolineHandlers as Record<
          string,
          (args: never) => void | Promise<void>
        >
      )[key] = (args) => latest.current.handlers[key]?.(args);
      trampolineGuards[key] = () => latest.current.guards[key]?.() ?? true;
    }
    return registerCommandHandlers(trampolineHandlers, trampolineGuards);
  }, [registerCommandHandlers, enabled]);
  return notify;
}
