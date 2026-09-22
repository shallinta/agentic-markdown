import type { RPCSchema } from "electrobun";

import type { Command, CommandAvailabilityMessage } from "./commands";
import type {
  DiscardRequest,
  DiscardResponse,
  ReloadCommitRequest,
  ReloadCommitResponse,
} from "./discard";
import type {
  DocumentHandleRequest,
  DocumentRequest,
  DocumentResponse,
} from "./documents";
import type { SupportedLocale } from "./i18n";
import type { UpdateMode, UpdateStatusChangedPayload } from "./updates";

export interface DesktopRPCType {
  bun: RPCSchema<{
    requests: {
      selectDocument: { params: DocumentRequest; response: DocumentResponse };
      cancelDocument: { params: DocumentRequest; response: DocumentResponse };
      readDocument: {
        params: DocumentHandleRequest;
        response: DocumentResponse;
      };
      releaseDocument: {
        params: DocumentHandleRequest;
        response: DocumentResponse;
      };
      updateMode: { params: Record<string, never>; response: UpdateMode };
      setUpdateMode: { params: { mode: UpdateMode }; response: null };
      getLocale: {
        params: Record<string, never>;
        response: SupportedLocale;
      };
      setLocale: {
        params: { locale: SupportedLocale };
        response: null;
      };
      pendingInstalledVersion: {
        params: Record<string, never>;
        response: string | null;
      };
      isFullScreen: {
        params: Record<string, never>;
        response: { fullScreen: boolean };
      };
    };
    messages: {
      executeCommand: Command;
      commandAvailabilityChanged: CommandAvailabilityMessage;
    };
  }>;
  webview: RPCSchema<{
    requests: {
      prepareDiscard: { params: DiscardRequest; response: DiscardResponse };
      commitReload: {
        params: ReloadCommitRequest;
        response: ReloadCommitResponse;
      };
    };
    messages: {
      finishDiscard: { requestId: string };
      updateStatusChanged: UpdateStatusChangedPayload;
      executeCommand: Command;
      fullScreenChanged: { fullScreen: boolean };
      localeChanged: { locale: SupportedLocale };
    };
  }>;
}
