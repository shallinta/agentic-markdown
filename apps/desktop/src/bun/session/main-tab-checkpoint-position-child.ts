import { readFile } from "node:fs/promises";

import { createMainTabCheckpointMetadataStore } from "./main-tab-metadata";

const [operation, directory, input] = process.argv.slice(2);
if (!directory || !["read", "write"].includes(operation ?? ""))
  throw Error("Explicit fixture arguments required");
const store = createMainTabCheckpointMetadataStore(directory);
try {
  const result =
    operation === "write"
      ? await store.writePositions(
          JSON.parse(await readFile(input, "utf8")),
          () => true
        )
      : await store.read();
  process.stdout.write(JSON.stringify(result));
} finally {
  await store.close();
}
