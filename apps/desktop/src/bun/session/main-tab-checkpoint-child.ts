import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";

// Test subprocess only; no application startup import or automatic restoration.
const directory = process.argv[2];
if (!directory) throw Error("Explicit isolated fixture directory required");
const store = createMainTabCheckpointMetadataStore(directory);
try {
  process.stdout.write(JSON.stringify(await store.read()));
} finally {
  await store.close();
}
