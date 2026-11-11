import { MAIN_TAB_METADATA_MAX_TABS } from "../../shared/main-tab-checkpoint";

import {
  validMainTabSessionMetadata,
  type MainTabMetadata,
} from "./main-tab-metadata";
import {
  copyStoredMainTabPosition,
  type StoredMainTabPosition,
} from "./main-tab-position-codec";
import { copyMainTabStandaloneSource } from "./main-tab-standalone-source";

export type MixedMainTabRow = (
  | (MainTabMetadata & { kind: "root" })
  | {
      kind: "standalone";
      path: string;
      fingerprint: string;
      pinned: boolean;
      mode: "editing" | "source";
    }
) & { position?: StoredMainTabPosition };
export interface MixedMainTabMetadata {
  schemaVersion: 3;
  tabs: MixedMainTabRow[];
  activeIndex: number | null;
}

/** Read own data fields without invoking accessors or serialization hooks. */
function fields(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const result: Record<string, unknown> = Object.create(null) as Record<
    string,
    unknown
  >;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") return;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      return;
    result[key] = descriptor.value;
  }
  return result;
}
const exact = (value: object, keys: string[]) =>
  Object.keys(value).sort().join() === keys.sort().join();

/** Isolated candidate codec. It grants no authority for either source kind. */
export function copyMixedMainTabMetadata(
  value: unknown
): MixedMainTabMetadata | undefined {
  try {
    const top = fields(value);
    if (
      !top ||
      !exact(top, ["schemaVersion", "tabs", "activeIndex"]) ||
      top.schemaVersion !== 3 ||
      !Array.isArray(top.tabs)
    )
      return;
    const length = top.tabs.length;
    if (
      length > MAIN_TAB_METADATA_MAX_TABS ||
      (length === 0
        ? top.activeIndex !== null
        : !Number.isSafeInteger(top.activeIndex) ||
          typeof top.activeIndex !== "number" ||
          top.activeIndex < 0 ||
          top.activeIndex >= length)
    )
      return;
    const tabs: MixedMainTabRow[] = [];
    const roots: MainTabMetadata[] = [];
    const standalonePaths = new Set<string>();
    for (let index = 0; index < length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(
        top.tabs,
        String(index)
      );
      if (!descriptor || !("value" in descriptor)) return;
      const row = fields(descriptor.value);
      if (!row || (row.kind !== "root" && row.kind !== "standalone")) return;
      const hasPosition = Object.prototype.hasOwnProperty.call(row, "position");
      if (
        !exact(row, [
          "kind",
          "fingerprint",
          "pinned",
          "mode",
          ...(row.kind === "root" ? ["rootId", "relativePath"] : ["path"]),
          ...(hasPosition ? ["position"] : []),
        ]) ||
        typeof row.pinned !== "boolean" ||
        (row.mode !== "editing" && row.mode !== "source") ||
        typeof row.fingerprint !== "string"
      )
        return;
      const position = hasPosition
        ? copyStoredMainTabPosition(row.position)
        : undefined;
      if (hasPosition && !position) return;
      if (row.kind === "root") {
        if (
          typeof row.rootId !== "string" ||
          typeof row.relativePath !== "string"
        )
          return;
        const base: MainTabMetadata = {
          rootId: row.rootId,
          relativePath: row.relativePath,
          fingerprint: row.fingerprint,
          pinned: row.pinned,
          mode: row.mode,
        };
        roots.push(base);
        tabs.push({ kind: "root", ...base, ...(position ? { position } : {}) });
      } else {
        if (
          typeof row.path !== "string" ||
          standalonePaths.has(row.path) ||
          !copyMainTabStandaloneSource({
            path: row.path,
            fingerprint: row.fingerprint,
          })
        )
          return;
        standalonePaths.add(row.path);
        tabs.push({
          kind: "standalone",
          path: row.path,
          fingerprint: row.fingerprint,
          pinned: row.pinned,
          mode: row.mode,
          ...(position ? { position } : {}),
        });
      }
    }
    if (
      !validMainTabSessionMetadata({
        tabs: roots,
        activeIndex: roots.length ? 0 : null,
      })
    )
      return;
    return {
      schemaVersion: 3,
      tabs,
      activeIndex: top.activeIndex as number | null,
    };
  } catch {
    return;
  }
}

export function decodeMixedMainTabMetadata(
  value: unknown
):
  | { status: "valid"; data: MixedMainTabMetadata }
  | { status: "future" }
  | { status: "invalid" } {
  try {
    const top = fields(value);
    if (!top) return { status: "invalid" };
    if (
      typeof top.schemaVersion === "number" &&
      Number.isSafeInteger(top.schemaVersion) &&
      top.schemaVersion > 3
    )
      return { status: "future" };
    if (top.schemaVersion === 3) {
      const data = copyMixedMainTabMetadata(value);
      return data ? { status: "valid", data } : { status: "invalid" };
    }
    const positioned = top.schemaVersion === 2;
    if (
      !exact(top, [
        "tabs",
        "activeIndex",
        ...(positioned ? ["schemaVersion"] : []),
      ]) ||
      !Array.isArray(top.tabs) ||
      top.tabs.length > MAIN_TAB_METADATA_MAX_TABS
    )
      return { status: "invalid" };
    const tabs: Record<string, unknown>[] = [];
    for (let index = 0; index < top.tabs.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(
        top.tabs,
        String(index)
      );
      const row =
        descriptor && "value" in descriptor
          ? fields(descriptor.value)
          : undefined;
      if (
        !row ||
        !exact(row, [
          "rootId",
          "relativePath",
          "fingerprint",
          "pinned",
          "mode",
          ...(positioned &&
          Object.prototype.hasOwnProperty.call(row, "position")
            ? ["position"]
            : []),
        ])
      )
        return { status: "invalid" };
      tabs.push({ ...row, kind: "root" });
    }
    const data = copyMixedMainTabMetadata({
      schemaVersion: 3,
      tabs,
      activeIndex: top.activeIndex,
    });
    return data ? { status: "valid", data } : { status: "invalid" };
  } catch {
    return { status: "invalid" };
  }
}
