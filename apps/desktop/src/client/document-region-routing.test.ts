import { expect, test } from "bun:test";

import {
  routeDocumentRegion,
  setSecondaryRegionExpanded,
  type DocumentRegion,
  type DocumentRegionLayout,
} from "./document-region-routing";

const documentId = "resolved-document-identity";
const open = { kind: "open" } as const;
const layout: DocumentRegionLayout = Object.freeze({
  secondaryOpen: true,
  activeRegion: "secondary",
  secondaryFull: false,
});

test("ordinary persistent open reuses the existing owner before activity and capacity", () => {
  for (const existingRegion of ["main", "secondary"] as const) {
    const result = routeDocumentRegion({
      documentId,
      existingRegion,
      layout: {
        ...layout,
        activeRegion: existingRegion === "main" ? "secondary" : "main",
        secondaryFull: true,
      },
      intent: open,
    });
    expect(result).toEqual({
      kind: "activate",
      documentId,
      region: existingRegion,
    });
  }
  expect(
    routeDocumentRegion({
      documentId,
      existingRegion: "secondary",
      layout: { ...layout, secondaryOpen: false },
      intent: open,
    })
  ).toEqual({ kind: "hidden-existing", documentId, region: "secondary" });
});

test("new document follows only the available active region, with explicit full fallback", () => {
  const route = (next: DocumentRegionLayout) =>
    routeDocumentRegion({
      documentId,
      existingRegion: null,
      layout: next,
      intent: open,
    });
  expect(route(layout)).toEqual({
    kind: "open",
    documentId,
    region: "secondary",
  });
  for (const activeRegion of [null, "main"] as const)
    expect(route({ ...layout, activeRegion })).toEqual({
      kind: "open",
      documentId,
      region: "main",
    });
  expect(route({ ...layout, secondaryOpen: false })).toEqual({
    kind: "open",
    documentId,
    region: "main",
  });
  expect(route({ ...layout, secondaryFull: true })).toEqual({
    kind: "open",
    documentId,
    region: "main",
    notice: "secondary-full",
  });
  expect(
    route({ ...layout, secondaryFull: true, activeRegion: "main" })
  ).toEqual({ kind: "open", documentId, region: "main" });
});

test("explicit moves require an open identity and never fallback or duplicate same-region documents", () => {
  const move = (
    existingRegion: DocumentRegion | null,
    target: DocumentRegion,
    next = layout
  ) =>
    routeDocumentRegion({
      documentId,
      existingRegion,
      layout: next,
      intent: { kind: "move", target },
    });
  expect(move(null, "main")).toEqual({
    kind: "blocked",
    documentId,
    reason: "not-open",
  });
  expect(move(null, "secondary")).toEqual({
    kind: "blocked",
    documentId,
    reason: "not-open",
  });
  expect(move("main", "secondary")).toEqual({
    kind: "move",
    documentId,
    region: "secondary",
  });
  expect(
    move("main", "secondary", { ...layout, secondaryOpen: false })
  ).toEqual({ kind: "blocked", documentId, reason: "secondary-closed" });
  expect(move("main", "secondary", { ...layout, secondaryFull: true })).toEqual(
    { kind: "blocked", documentId, reason: "secondary-full" }
  );
  expect(
    move("secondary", "main", {
      ...layout,
      secondaryOpen: false,
      secondaryFull: true,
    })
  ).toEqual({ kind: "hidden-existing", documentId, region: "secondary" });
  expect(move("secondary", "main")).toEqual({
    kind: "move",
    documentId,
    region: "main",
  });
  expect(move("main", "main")).toEqual({
    kind: "activate",
    documentId,
    region: "main",
  });
  expect(
    move("secondary", "secondary", { ...layout, secondaryFull: true })
  ).toEqual({ kind: "activate", documentId, region: "secondary" });
  expect(
    move("secondary", "secondary", { ...layout, secondaryOpen: false })
  ).toEqual({ kind: "hidden-existing", documentId, region: "secondary" });
});

test("layout transitions only change visibility and active region, preserving inputs", () => {
  const before = Object.freeze({
    secondaryOpen: false,
    activeRegion: "main" as const,
    secondaryFull: true,
  });
  const expanded = setSecondaryRegionExpanded(before, true);
  expect(expanded).toEqual({
    secondaryOpen: true,
    activeRegion: "secondary",
    secondaryFull: true,
  });
  expect(setSecondaryRegionExpanded(expanded, false)).toEqual(before);
  expect(before).toEqual({
    secondaryOpen: false,
    activeRegion: "main",
    secondaryFull: true,
  });
  const request = Object.freeze({
    documentId,
    existingRegion: "main" as const,
    layout: before,
    intent: Object.freeze({
      kind: "move" as const,
      target: "secondary" as const,
    }),
  });
  routeDocumentRegion(request);
  expect(request.layout).toBe(before);
  expect(request.existingRegion).toBe("main");
});
