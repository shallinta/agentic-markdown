import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@agentic-markdown/ui/ui/dialog";
import { useRef, useSyncExternalStore } from "react";

import { discardGuard } from "@/client/discard-guard";

export function DocumentDiscardDialog({ buttonClass }: { buttonClass: string }) {
  const previousFocus = useRef<HTMLElement | null>(null);
  const dialog = useSyncExternalStore(discardGuard.subscribe, discardGuard.getSnapshot);
  return (
    <Dialog
      open={!!dialog}
      onOpenChange={(open) => {
        if (!open) discardGuard.respond(false);
      }}
    >
      <DialogContent
        showCloseButton={false}
        role="alertdialog"
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={() => {
          previousFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (previousFocus.current?.isConnected)
            previousFocus.current.focus();
        }}
      >
        <DialogTitle>确认放弃修改</DialogTitle>
        <DialogDescription>{dialog?.message}</DialogDescription>
        <div className="mt-2 flex justify-end gap-3">
          <button
            className={buttonClass}
            onClick={() => discardGuard.respond(false)}
          >
            继续编辑
          </button>
          <button
            className={buttonClass}
            onClick={() => discardGuard.respond(true)}
          >
            放弃变更
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
