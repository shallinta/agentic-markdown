import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

import { createMixedMainTabMetadataStore } from "./main-tab-mixed-metadata-store";

const [operation, directory, input] = process.argv.slice(2);
if (!directory || !["read", "write", "stale"].includes(operation))
  throw Error("Explicit mixed-session fixture operation and directory required");

const store = createMixedMainTabMetadataStore(directory);
try {
  if (operation === "read") {
    const result = await store.read();
    const expected: unknown = input && JSON.parse(await readFile(input, "utf8"));
    const receipt = result.status === "valid"
      ? { status: result.status, matches: isDeepStrictEqual(result.data, expected) }
      : result;
    process.stdout.write(JSON.stringify(receipt));
  } else {
    if (!input) throw Error("Explicit mixed-session fixture input required");
    const data: unknown = JSON.parse(await readFile(input, "utf8"));
    process.stdout.write(JSON.stringify(await store.write(data, () => operation === "write")));
  }
} finally {
  await store.close();
}
