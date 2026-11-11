import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

import {
  MAIN_TAB_METADATA_MAX_BYTES,
  validMainTabSessionMetadata,
  type MainTabSessionMetadata,
} from "./main-tab-metadata";
import { createMainTabPositionProbeStore } from "./main-tab-position-probe";

// Explicit isolated process fixture, never imported by application startup.
const [operation, directory, inputPath] = process.argv.slice(2);
if (
  !directory ||
  !["write", "read", "old-read-write"].includes(operation ?? "")
)
  throw Error("Fixture arguments required");
if (operation === "old-read-write") {
  // The former five-field schema, using the unchanged strict storage boundary.
  const oldSchema = (value: unknown): value is MainTabSessionMetadata =>
    validMainTabSessionMetadata(value) &&
    value.tabs.every(
      (tab) => !Object.prototype.hasOwnProperty.call(tab, "position")
    );
  const store = createSettingsStore(
    join(directory, "main-tab-position-probe.json"),
    (value) => (oldSchema(value) ? value : { tabs: [], activeIndex: null }),
    { maxBytes: MAIN_TAB_METADATA_MAX_BYTES, validateData: oldSchema }
  );
  const before = await store.readPersisted();
  const write = await store.updateObserved(() => ({
    tabs: [],
    activeIndex: null,
  }));
  process.stdout.write(
    JSON.stringify({ before: before.status, attempted: write.attempted })
  );
} else {
  const store = createMainTabPositionProbeStore(directory);
  try {
    if (operation === "write") {
      if (!inputPath) throw Error("Input required");
      const value: unknown = JSON.parse(await readFile(inputPath, "utf8"));
      process.stdout.write(JSON.stringify(await store.write(value)));
    } else process.stdout.write(JSON.stringify(await store.read()));
  } finally {
    await store.close();
  }
}
