import type {
  createMainTabCheckpointMetadataStore,
  MainTabMetadataFailure,
  MainTabMetadataRead,
} from "./main-tab-metadata";
import {
  decodeMixedMainTabMetadata,
  type MixedMainTabMetadata,
} from "./main-tab-mixed-metadata";
import type { createMixedMainTabMetadataStore } from "./main-tab-mixed-metadata-store";

interface CheckpointReaders {
  mixed: Pick<ReturnType<typeof createMixedMainTabMetadataStore>, "read">;
  directory: Pick<
    ReturnType<typeof createMainTabCheckpointMetadataStore>,
    "read"
  >;
}
export type MainTabCheckpointCoexistenceRead =
  | {
      status: "valid";
      source: "mixed" | "directory";
      data: MixedMainTabMetadata;
    }
  | { status: "missing" | MainTabMetadataFailure };

/** Read-only precedence, not a snapshot across files or authorization to reopen. */
export async function readMainTabCheckpointCoexistence({
  mixed,
  directory,
}: CheckpointReaders): Promise<MainTabCheckpointCoexistenceRead> {
  try {
    const first = await mixed.read();
    if (first.status === "valid") return { ...first, source: "mixed" };
    if (first.status !== "missing") return first;

    let legacy: MainTabMetadataRead;
    try {
      legacy = await directory.read();
    } catch {
      legacy = { status: "io" };
    }

    // A newly published mixed record takes precedence even over a legacy error.
    const latest = await mixed.read();
    if (latest.status === "valid") return { ...latest, source: "mixed" };
    if (latest.status !== "missing") return latest;
    if (legacy.status !== "valid") return legacy;
    const decoded = decodeMixedMainTabMetadata(
      legacy.positioned ?? legacy.data
    );
    return decoded.status === "valid"
      ? { status: "valid", source: "directory", data: decoded.data }
      : { status: decoded.status === "future" ? "future" : "corrupt" };
  } catch {
    return { status: "io" };
  }
}
