import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { electrobun } from "@/lib/electrobun";
import { getTranslationResources } from "@/shared/i18n";
import { logRendererEvent } from "@/shared/logging";

import { App } from "../app";
import {
  bootstrapRenderer,
  initializeRendererI18n,
} from "../lib/renderer-i18n";

const root = createRoot(document.getElementById("root")!);
const startupCopy = getTranslationResources();

function renderApp(): void {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}

function renderStartupFailure(): void {
  logRendererEvent("renderer.start_failed");
  root.render(
    <main
      className="flex size-full items-center justify-center p-8 text-center"
      role="alert"
    >
      <div className="flex max-w-md flex-col items-center gap-4">
        <h1 className="text-lg font-semibold">
          {startupCopy["zh-CN"].common.startupFailure.title}
        </h1>
        <p className="text-muted-foreground text-sm">
          {startupCopy["zh-CN"].common.startupFailure.description}
        </p>
        <button
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-medium"
          type="button"
          onClick={() =>
            electrobun.rpc?.send.executeCommand({ type: "reload", args: {} })
          }
        >
          {startupCopy["zh-CN"].common.startupFailure.retry}
        </button>
      </div>
    </main>
  );
}

void bootstrapRenderer({
  initialize: async () => {
    const rpc = electrobun.rpc;
    if (!rpc) throw new Error("Desktop RPC is unavailable.");
    await initializeRendererI18n({
      documentRoot: document.documentElement,
      rpc,
    });
  },
  renderApp,
  renderFailure: renderStartupFailure,
});
