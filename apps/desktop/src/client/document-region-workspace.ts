import {
  routeDocumentRegion,
  setSecondaryRegionExpanded,
  type DocumentRegion,
} from "./document-region-routing";
import {
  allocateSecondaryPaneHeight,
  SECONDARY_MIN_HEIGHT,
} from "./secondary-pane-height";
import { removeSecondaryPaneHeight } from "./secondary-pane-removal";

export interface RegionDocument {
  readonly documentId: string;
}
export interface DocumentRegionWorkspace {
  readonly main: readonly RegionDocument[];
  readonly secondary: readonly RegionDocument[];
  readonly secondaryHeights: readonly number[];
  readonly secondaryHeight: number;
  readonly secondaryOpen: boolean;
  readonly activeRegion: DocumentRegion | null;
  readonly mainActiveId: string | null;
}
export type DocumentRegionWorkspaceAction =
  | { kind: "open"; document: RegionDocument }
  | { kind: "move"; documentId: string; target: DocumentRegion }
  | { kind: "visibility"; expanded: boolean };
export type DocumentRegionWorkspaceReceipt =
  | {
      kind: "opened" | "activated" | "moved";
      documentId: string;
      region: DocumentRegion;
      notice?: "secondary-full";
    }
  | { kind: "visibility"; expanded: boolean }
  | {
      kind: "blocked";
      reason: "invalid" | "secondary-closed" | "secondary-full" | "not-open";
    }
  | { kind: "defer"; reason: "hidden-existing"; documentId: string };

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function valid(state: DocumentRegionWorkspace): boolean {
  if (
    !isArray(state.main) ||
    !isArray(state.secondary) ||
    !isArray(state.secondaryHeights) ||
    !Number.isFinite(state.secondaryHeight) ||
    state.secondaryHeight < 0 ||
    typeof state.secondaryOpen !== "boolean" ||
    ![null, "main", "secondary"].includes(state.activeRegion) ||
    (!state.secondaryOpen && state.activeRegion === "secondary") ||
    state.secondary.length !== state.secondaryHeights.length
  )
    return false;
  const identities = new Set<string>();
  for (const document of [...state.main, ...state.secondary]) {
    if (
      !document ||
      typeof document.documentId !== "string" ||
      !document.documentId ||
      identities.has(document.documentId)
    )
      return false;
    identities.add(document.documentId);
  }
  if (
    state.mainActiveId !== null &&
    !state.main.some((document) => document.documentId === state.mainActiveId)
  )
    return false;
  let total = 0;
  for (const height of state.secondaryHeights) {
    if (!Number.isFinite(height) || height < SECONDARY_MIN_HEIGHT) return false;
    total += height;
  }
  return (
    Number.isFinite(total) &&
    (!state.secondary.length ||
      Math.abs(total - state.secondaryHeight) <=
        Number.EPSILON * Math.max(1, total, state.secondaryHeight) * 8)
  );
}

/** Isolated model transaction. No editor state, document grants, or UI effects. */
export function applyDocumentRegionWorkspace(
  state: DocumentRegionWorkspace,
  action: DocumentRegionWorkspaceAction
): { state: DocumentRegionWorkspace; receipt: DocumentRegionWorkspaceReceipt } {
  const invalid = (): {
    state: DocumentRegionWorkspace;
    receipt: DocumentRegionWorkspaceReceipt;
  } => ({ state, receipt: { kind: "blocked", reason: "invalid" } });
  if (!valid(state)) return invalid();
  if (action.kind === "visibility") {
    if (typeof action.expanded !== "boolean") return invalid();
    const next = setSecondaryRegionExpanded(
      {
        secondaryOpen: state.secondaryOpen,
        activeRegion: state.activeRegion,
        secondaryFull: false,
      },
      action.expanded
    );
    return {
      state:
        next.secondaryOpen === state.secondaryOpen &&
        next.activeRegion === state.activeRegion
          ? state
          : {
              ...state,
              secondaryOpen: next.secondaryOpen,
              activeRegion: next.activeRegion,
            },
      receipt: { kind: "visibility", expanded: action.expanded },
    };
  }
  const documentId =
    action.kind === "open" ? action.document?.documentId : action.documentId;
  if (
    typeof documentId !== "string" ||
    !documentId ||
    (action.kind === "move" &&
      action.target !== "main" &&
      action.target !== "secondary")
  )
    return invalid();
  const mainDocument = state.main.find(
    (document) => document.documentId === documentId
  );
  const secondaryIndex = state.secondary.findIndex(
    (document) => document.documentId === documentId
  );
  const existingRegion = mainDocument
    ? "main"
    : secondaryIndex >= 0
      ? "secondary"
      : null;
  const needsAllocation =
    state.secondaryOpen &&
    (action.kind === "open"
      ? !existingRegion && state.activeRegion === "secondary"
      : existingRegion === "main" && action.target === "secondary");
  const allocation = needsAllocation
    ? allocateSecondaryPaneHeight(state.secondaryHeight, state.secondaryHeights)
    : undefined;
  if (allocation && !allocation.ok && allocation.reason === "invalid")
    return invalid();
  const route = routeDocumentRegion({
    documentId,
    existingRegion,
    layout: {
      secondaryOpen: state.secondaryOpen,
      activeRegion: state.activeRegion,
      secondaryFull: allocation?.ok === false,
    },
    intent:
      action.kind === "open"
        ? { kind: "open" }
        : { kind: "move", target: action.target },
  });
  if (route.kind === "blocked")
    return { state, receipt: { kind: "blocked", reason: route.reason } };
  if (route.kind === "hidden-existing")
    return {
      state,
      receipt: { kind: "defer", reason: "hidden-existing", documentId },
    };
  if (route.kind === "activate")
    return {
      state:
        state.activeRegion === route.region &&
        (route.region !== "main" || state.mainActiveId === documentId)
          ? state
          : {
              ...state,
              activeRegion: route.region,
              mainActiveId:
                route.region === "main" ? documentId : state.mainActiveId,
            },
      receipt: { kind: "activated", documentId, region: route.region },
    };
  const document =
    mainDocument ??
    state.secondary[secondaryIndex] ??
    (action.kind === "open" ? action.document : undefined);
  if (!document) return invalid();
  if (route.region === "secondary") {
    if (!allocation?.ok) return invalid();
    return {
      state: {
        ...state,
        main: mainDocument
          ? state.main.filter((item) => item.documentId !== documentId)
          : state.main,
        secondary: [...state.secondary, document],
        secondaryHeights: allocation.heights,
        activeRegion: "secondary",
        mainActiveId:
          state.mainActiveId === documentId ? null : state.mainActiveId,
      },
      receipt: {
        kind: route.kind === "open" ? "opened" : "moved",
        documentId,
        region: "secondary",
      },
    };
  }
  const heights =
    secondaryIndex >= 0
      ? removeSecondaryPaneHeight(state.secondaryHeights, secondaryIndex)
      : state.secondaryHeights;
  if (!heights) return invalid();
  const secondary =
    secondaryIndex >= 0
      ? state.secondary.filter((item) => item.documentId !== documentId)
      : state.secondary;
  return {
    state: {
      ...state,
      main: [...state.main, document],
      secondary,
      secondaryHeights: heights,
      secondaryOpen:
        secondaryIndex >= 0 && !secondary.length ? false : state.secondaryOpen,
      activeRegion: "main",
      mainActiveId: documentId,
    },
    receipt: {
      kind: route.kind === "open" ? "opened" : "moved",
      documentId,
      region: "main",
      ...(route.kind === "open" && route.notice
        ? { notice: route.notice }
        : {}),
    },
  };
}
