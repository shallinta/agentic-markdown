export type DocumentRegion = "main" | "secondary";

export interface DocumentRegionLayout {
  readonly secondaryOpen: boolean;
  readonly activeRegion: DocumentRegion | null;
  readonly secondaryFull: boolean;
}

export type DocumentRegionRoute =
  | { kind: "hidden-existing"; documentId: string; region: "secondary" }
  | { kind: "activate" | "move"; documentId: string; region: DocumentRegion }
  | {
      kind: "open";
      documentId: string;
      region: DocumentRegion;
      notice?: "secondary-full";
    }
  | {
      kind: "blocked";
      documentId: string;
      reason: "secondary-closed" | "secondary-full" | "not-open";
    };

/** hidden-existing is unresolved presentation policy, not a product rejection.
 * Advisory decision for an already resolved identity; grants and ownership stay with the caller. */
export function routeDocumentRegion(input: {
  readonly documentId: string;
  readonly existingRegion: DocumentRegion | null;
  readonly layout: DocumentRegionLayout;
  readonly intent:
    | { readonly kind: "open" }
    | { readonly kind: "move"; readonly target: DocumentRegion };
}): DocumentRegionRoute {
  const { documentId, existingRegion, layout, intent } = input;
  if (intent.kind === "open") {
    // Existing identity wins over activity and capacity. Hidden-instance exposure is not decided here.
    if (existingRegion)
      return existingRegion === "secondary" && !layout.secondaryOpen
        ? { kind: "hidden-existing", documentId, region: "secondary" }
        : { kind: "activate", documentId, region: existingRegion };
    if (layout.activeRegion !== "secondary" || !layout.secondaryOpen)
      return { kind: "open", documentId, region: "main" };
    return layout.secondaryFull
      ? { kind: "open", documentId, region: "main", notice: "secondary-full" }
      : { kind: "open", documentId, region: "secondary" };
  }

  if (!existingRegion)
    return { kind: "blocked", documentId, reason: "not-open" };
  if (existingRegion === "secondary" && !layout.secondaryOpen)
    return { kind: "hidden-existing", documentId, region: "secondary" };
  if (existingRegion === intent.target)
    return { kind: "activate", documentId, region: existingRegion };
  if (intent.target === "secondary") {
    if (!layout.secondaryOpen)
      return { kind: "blocked", documentId, reason: "secondary-closed" };
    if (layout.secondaryFull)
      return { kind: "blocked", documentId, reason: "secondary-full" };
  }
  return { kind: "move", documentId, region: intent.target };
}

/** Layout-only transition: expanding activates secondary, collapsing returns to main. */
export function setSecondaryRegionExpanded(
  layout: DocumentRegionLayout,
  expanded: boolean
): DocumentRegionLayout {
  return {
    ...layout,
    secondaryOpen: expanded,
    activeRegion: expanded ? "secondary" : "main",
  };
}
