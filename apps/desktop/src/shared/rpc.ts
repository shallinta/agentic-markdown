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
  SaveDocumentRequest,
  SaveDocumentResponse,
  DocumentSavesSettledResponse,
  WriteCapabilityResponse,
} from "./documents";
import type { SupportedLocale } from "./i18n";
import type { PerfRequest, PerfResponse } from "./perf-lab";
import type { UpdateMode, UpdateStatusChangedPayload } from "./updates";

export interface DesktopRPCType {
  bun: RPCSchema<{
    requests: {
      getSourceWrapping: { params: Record<string, never>; response: import("./source-wrapping").SourceWrappingResponse };
      setSourceWrapping: { params: { enabled: boolean }; response: import("./source-wrapping").SourceWrappingResponse };
      observeDocument: { params: import("./document-observation").ObservationRequest; response: { ok: boolean; requestId: string } };
      getSidebarLayout: {
        params: Record<string, never>;
        response: {
          ok: boolean;
          layout?: import("@agentic-markdown/shared/sidebar-layout").SidebarLayout;
        };
      };
      saveSidebarLayout: {
        params: import("@agentic-markdown/shared/sidebar-layout").SidebarLayout;
        response: { ok: boolean };
      };
      workspaceRequest: {
        params: import("./workspace").WorkspaceRequest;
        response: import("./workspace").WorkspaceResponse;
      };
      openWorkspaceDocument: {
        params: import("./workspace").WorkspaceOpenRequest;
        response: DocumentResponse;
      };
      readLocalImage: {
        params: import("./local-images").LocalImageRequest;
        response: import("./local-images").LocalImageResponse;
      };
      perfLabStatus: {
        params: Record<string, never>;
        response: { enabled: boolean; autorun: boolean };
      };
      perfLabRequest: { params: PerfRequest; response: PerfResponse };
      checkDocumentWriteCapability: {
        params: DocumentHandleRequest;
        response: WriteCapabilityResponse;
      };
      saveDocument: {
        params: SaveDocumentRequest;
        response: SaveDocumentResponse;
      };
      waitForDocumentSaves: {
        params: DocumentRequest;
        response: DocumentSavesSettledResponse;
      };
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
      documentCapabilityChanged: { handle: string };
      documentExternalChanged: import("./document-observation").ObservationEvent;
      updateStatusChanged: UpdateStatusChangedPayload;
      executeCommand: Command;
      fullScreenChanged: { fullScreen: boolean };
      localeChanged: { locale: SupportedLocale };
    };
  }>;
}
