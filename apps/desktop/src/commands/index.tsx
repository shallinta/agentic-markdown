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

import { isExternalTextTarget } from "@/client/history-target";
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
  const saveDocument = registry.isCommandEnabled("saveDocument");
  const clearDocument = registry.isCommandEnabled("clearDocument");
  const closeDocument = registry.isCommandEnabled("closeDocument");
  const undoDocument = registry.isCommandEnabled("undoDocument");
  const redoDocument = registry.isCommandEnabled("redoDocument");
  const [documentHistory, setDocumentHistory] = useState(true);
  useEffect(() => {
    const update = () =>
      setDocumentHistory(!isExternalTextTarget(document.activeElement));
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    update();
    return () => {
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
    };
  }, []);
  useEffect(() => {
    const availability: CommandAvailability = {
      selectDocument,
      reloadDocument,
      saveDocument,
      clearDocument,
      closeDocument,
      undoDocument,
      redoDocument,
      documentHistory,
    };
    electrobun.rpc?.send.commandAvailabilityChanged({
      protocolVersion: 1,
      availability,
    });
  }, [
    selectDocument,
    saveDocument,
    reloadDocument,
    clearDocument,
    closeDocument,
    undoDocument,
    redoDocument,
    documentHistory,
  ]);
  useEffect(
    () => () => {
      electrobun.rpc?.send.commandAvailabilityChanged({
        protocolVersion: 1,
        availability: {
          selectDocument: false,
          reloadDocument: false,
          saveDocument: false,
          clearDocument: false,
          closeDocument: false,
          undoDocument: false,
          redoDocument: false,
          documentHistory: false,
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
