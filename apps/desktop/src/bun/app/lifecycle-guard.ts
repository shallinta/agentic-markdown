import type { DiscardReason } from "../../shared/discard";

import type { BeforeQuitEvent } from "./shutdown-coordinator";

export function createLifecycleGuard({
  guard,
  stop,
  quit,
  reload,
  update,
  beforeUpdate,
}: {
  guard: (
    reason: DiscardReason,
    execute: (requestId: string) => Promise<boolean> | boolean
  ) => Promise<boolean>;
  stop: () => Promise<void>;
  quit: () => boolean | void;
  reload: (requestId: string) => Promise<boolean>;
  update: () => Promise<boolean>;
  beforeUpdate: () => Promise<void>;
}) {
  let approvedQuit = false;
  const beforeQuit = (event: BeforeQuitEvent) => {
    if (approvedQuit) return;
    event.response = { allow: false };
    void guard("quit", async () => {
      await stop();
      approvedQuit = true;
      try {
        return quit() !== false;
      } finally {
        approvedQuit = false;
      }
    });
  };
  return {
    beforeQuit,
    // Main-window close has the same product semantics as application quit.
    beforeClose: (event: BeforeQuitEvent) => {
      event.response = { allow: false };
      beforeQuit(event);
    },
    reload: () => guard("reload", (requestId) => reload(requestId)),
    update: () =>
      guard("update", async () => {
        // Do not dispose document handles before an updater no-op or failure.
        await beforeUpdate();
        approvedQuit = true;
        try {
          return await update();
        } finally {
          approvedQuit = false;
        }
      }),
  };
}
