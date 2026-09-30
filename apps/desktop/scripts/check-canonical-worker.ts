/** Build in memory with real Vite worker resolution, then execute without DOM.
 * This catches browser-only dependency branches missed by Bun source tests.
 * It is not a WKWebView/CSP or native-worker cancellation acceptance test.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { build } from "vite";

import {
  CANONICAL_CONFIG,
  canonicalCorpus,
} from "../src/shared/canonical-corpus";

const desktop = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
process.chdir(desktop);
const output = await build({
  configFile: path.join(desktop, "vite.config.ts"),
  logLevel: "silent",
  build: { write: false, emptyOutDir: false },
});
if ("on" in output || Array.isArray(output))
  throw new Error("Unexpected build output");
const chunk = output.output.find(
  (value) => value.type === "chunk" && value.fileName.includes("canonical-lab")
);
if (chunk?.type !== "chunk") throw new Error("Missing canonical chunk");
const literal = /'(?:\\.|[^'\\])*'/.exec(
  chunk.code.slice(chunk.code.indexOf("'(function"))
);
if (!literal) throw new Error("Missing inline worker");
const source: unknown = vm.runInNewContext(literal[0]);
if (typeof source !== "string") throw new Error("Invalid inline worker");
let receive: ((event: { data: unknown }) => void) | undefined;
const responses: { ok: boolean; row?: { passed: boolean } }[] = [];
const self = {
  addEventListener: (_type: string, callback: typeof receive) => {
    receive = callback;
  },
  postMessage: (value: (typeof responses)[number]) => {
    responses.push(value);
  },
};
vm.runInNewContext(source, {
  self,
  performance,
  URL,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
});
if (!receive) throw new Error("Worker did not register");
for (const sample of canonicalCorpus)
  receive({ data: { id: sample.id, config: CANONICAL_CONFIG } });
if (
  responses.length !== canonicalCorpus.length ||
  responses.some((value) => !value.ok || !value.row?.passed)
)
  throw new Error("Bundled worker corpus failed");
console.info(
  `Bundled no-DOM worker: ${responses.length}/${canonicalCorpus.length} fixed samples passed`
);
