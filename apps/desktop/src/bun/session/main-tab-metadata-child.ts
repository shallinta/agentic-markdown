import { readFile } from "node:fs/promises";

import { createMainTabMetadataStore } from "./main-tab-metadata";

// Explicit test-process runner. Not imported by production startup.
const [operation, isolatedDir, inputPath] = process.argv.slice(2);
if (!isolatedDir || !["write", "read"].includes(operation ?? ""))
  throw Error("Explicit isolated fixture arguments required");
const store = createMainTabMetadataStore(isolatedDir);
try {
  if (operation === "write") {
    if (!inputPath) throw Error("Input fixture required");
    const input: unknown = JSON.parse(await readFile(inputPath, "utf8"));
    const result = await store.write(input);
    if (result.status !== "committed") throw Error("Fixture commit failed");
    process.stdout.write(JSON.stringify({ status: "committed" }));
  } else process.stdout.write(JSON.stringify(await store.read()));
} finally {
  await store.close();
}
