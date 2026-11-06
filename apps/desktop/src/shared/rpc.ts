import type { RPCSchema } from "electrobun";

import type { Command, CommandAvailabilityMessage } from "./commands";
import type {
  DiscardRequest,
  DiscardResponse,
  ReloadCommitRequest,
  ReloadCommitResponse,
} from "./discard";
import type {
  DocumentErrorCode,
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

export interface ReadingSnapshotSource {
  handle: string;
  documentId: string;
  expectedRevision: number;
  expectedHash: string;
}

export type OpenReadingSnapshotResponse =
  | { ok: true; submitted: true }
  | { ok: false; error: DocumentErrorCode | "UNAVAILABLE" };

export interface DesktopRPCType {
  bun: RPCSchema<{
    requests: {
      trashDocument: { params: import("./trash-document").TrashRequest; response: import("./trash-document").TrashResponse };
      beginMRUSession: { params: import("./document-mru").MRUEnvelope; response: import("./document-mru").MRUSessionResponse };
      recordDocumentActivation: { params: import("./document-mru").MRURecordRequest; response: import("./document-mru").MRUAck };
      resolveDocumentMRU: { params: import("./document-mru").MRUResolveRequest; response: import("./document-mru").MRUResolveResponse };
      removeStandalone: { params: import("./standalone-removal").RemovalRequest; response: import("./standalone-removal").RemovalResponse };
      removeFolderRoot: { params: import("./folder-removal").FolderRemovalRequest; response: import("./folder-removal").FolderRemovalResponse };
      revealDocument: { params: DocumentHandleRequest; response: DocumentResponse };
      openDefaultDocument: { params: DocumentHandleRequest; response: DocumentResponse };
      openReadingSnapshot: {
        params: ReadingSnapshotSource;
        response: OpenReadingSnapshotResponse;
      };
      recentFiles: {
        params: import("./recent-files").RecentRequest;
        response: import("./recent-files").RecentResponse;
      };
      reopenRecentFile: {
        params: DocumentRequest & { id: string };
        response: DocumentResponse;
      };
      getSourceWrapping: {
        params: Record<string, never>;
        response: import("./source-wrapping").SourceWrappingResponse;
      };
      setSourceWrapping: {
        params: { enabled: boolean };
        response: import("./source-wrapping").SourceWrappingResponse;
      };
      observeDocument: {
        params: import("./document-observation").ObservationRequest;
        response: { ok: boolean; requestId: string };
      };
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
      createMarkdown: {
        params: import("./create-markdown").CreateMarkdownRequest;
        response: import("./create-markdown").CreateMarkdownResponse;
      };
      duplicateMarkdown: {
        params: import("./create-markdown").CreateMarkdownRequest;
        response: import("./create-markdown").CreateMarkdownResponse;
      };
      createFolder: {
        params: import("./create-folder").CreateFolderRequest;
        response: import("./create-folder").CreateFolderResponse;
      };
      openWorkspaceDocument: {
        params: import("./workspace").WorkspaceOpenRequest;
        response: DocumentResponse;
      };
      revealWorkspaceItem: {
        params: import("./workspace").WorkspaceRevealRequest;
        response: DocumentResponse;
      };
      openDefaultWorkspaceItem: {
        params: import("./workspace").WorkspaceDefaultOpenRequest;
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
      rasterPasteLab: {
        params: import("./raster-paste-lab").RasterPasteLabRequest;
        response: import("./raster-paste-lab").RasterPasteLabResponse;
      };
      searchLabRequest: {
        params: import("./search-lab").SearchLabRequest;
        response: import("./search-lab").SearchLabResponse;
      };
      contentSearchRequest: {
        params: import("./content-search").ContentSearchRequest;
        response: import("./content-search").ContentSearchResponse;
      };
      prepareContentSearchDocument: {
        params: import("./content-search").ContentSearchPrepareRequest;
        response: import("./content-search").ContentSearchPrepareResponse;
      };
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
      trashNotice: { reason: "exit-pending" };
      documentCapabilityChanged: { handle: string };
      recentFilesFailed: { reason: import("./recent-files").RecentFailure };
      documentExternalChanged: import("./document-observation").ObservationEvent;
      contentSearchProgress: import("./content-search").ContentSearchProgress;
      updateStatusChanged: UpdateStatusChangedPayload;
      executeCommand: Command;
      fullScreenChanged: { fullScreen: boolean };
      localeChanged: { locale: SupportedLocale };
    };
  }>;
}
