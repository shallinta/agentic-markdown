import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { Command } from "../../shared/commands";

interface ReaderWindow {
  on(name: "focus" | "blur" | "close", listener: () => void): void;
  show(): void;
  requestClose(): void;
  close(): void;
}

interface MainWindow {
  url: string | null;
  on(name: "focus" | "blur", listener: () => void): void;
  activate(): void;
}

export function createReaderLab(open: () => ReaderWindow) {
  let reader: ReaderWindow | undefined;
  let attempted = false;
  let owner: "main" | "opening" | "reader" | "unknown" = "main";
  const requestReaderClose = () => {
    try {
      reader?.requestClose();
    } catch {
      console.warn("Reader lab window could not close");
    }
  };

  return {
    bindMain(main: MainWindow): void {
      main.on("focus", () => {
        if (owner !== "opening") owner = "main";
      });
      main.on("blur", () => {
        if (reader && owner === "main") owner = "unknown";
      });
    },
    openAfterMainReady(main: MainWindow): void {
      if (attempted || main.url !== PACKAGED_VIEW_URL) return;
      attempted = true;
      owner = "opening";
      try {
        const child = open();
        reader = child;
        child.on("focus", () => {
          if (reader === child) owner = "reader";
        });
        child.on("blur", () => {
          if (reader === child && owner === "reader") owner = "unknown";
        });
        child.on("close", () => {
          if (reader !== child) return;
          reader = undefined;
          owner = "main";
        });
        child.show();
      } catch {
        console.warn("Reader lab window could not open");
        if (reader) requestReaderClose();
        else owner = "main";
      }
    },
    interceptMenu(command: Command): boolean {
      if (owner === "main") return false;
      if (owner === "reader" && command.type === "closeDocument")
        requestReaderClose();
      return true;
    },
    activateMainForDiscard(main: MainWindow): void {
      if (reader && owner !== "main") {
        try {
          main.activate();
        } catch {
          // Activation is best effort; still ask the main renderer to guard quit.
          console.warn("Reader lab could not activate main window");
        }
      }
    },
    dispose(): void {
      attempted = true;
      reader?.close();
    },
  };
}
