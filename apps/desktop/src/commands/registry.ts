import {
  COMMAND_META,
  type Command,
  type CommandArgs,
  type CommandType,
} from "../shared/commands";

export type CommandHandlers = {
  [T in CommandType]?: (args: CommandArgs<T>) => void | Promise<void>;
};
export type CommandGuards = Partial<Record<CommandType, () => boolean>>;
type Handler = (args: never) => void | Promise<void>;

/** Guards read live owner state at dispatch time, not the last React render. */
export function createCommandRegistry(
  forward: (command: Command) => void,
  failed: () => void
) {
  const entries = new Map<
    CommandType,
    { handler: Handler; guard?: () => boolean }
  >();
  const listeners = new Set<() => void>();
  let revision = 0;
  const notify = () => {
    revision++;
    listeners.forEach((listener) => listener());
  };
  const isCommandEnabled = (type: CommandType) => {
    if (!Object.prototype.hasOwnProperty.call(COMMAND_META, type)) return false;
    if (COMMAND_META[type].target === "bun") return true;
    const entry = entries.get(type);
    return !!entry && (entry.guard?.() ?? true);
  };
  return {
    notify,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => revision,
    isCommandEnabled,
    executeCommand(this: void, command: Command) {
      try {
        if (!isCommandEnabled(command.type)) return;
        if (COMMAND_META[command.type].target === "bun") {
          forward(command);
          return;
        }
        const result = entries
          .get(command.type)!
          .handler(command.args as never);
        void Promise.resolve(result).catch(() => failed());
      } catch {
        failed();
      }
    },
    registerCommandHandlers(
      this: void,
      handlers: CommandHandlers,
      guards: CommandGuards = {}
    ) {
      const owned = Object.entries(handlers).map(([key, handler]) => {
        const type = key as CommandType;
        const entry = { handler: handler as Handler, guard: guards[type] };
        entries.set(type, entry);
        return [type, entry] as const;
      });
      notify();
      return () => {
        owned.forEach(([type, entry]) => {
          if (entries.get(type) === entry) entries.delete(type);
        });
        notify();
      };
    },
  };
}
