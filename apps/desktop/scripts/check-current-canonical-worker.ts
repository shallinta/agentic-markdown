/** Real Vite Worker bundle in a no-DOM VM; not native WK/CSP/IME evidence. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { build } from "vite";

import {
  CANONICAL_CONFIG,
  type CanonicalResult,
} from "../src/client/current-canonical-protocol";

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
if ("on" in output || Array.isArray(output)) throw Error("Unexpected output");
let source: string | undefined;
for (const chunk of output.output) {
  if (chunk.type !== "chunk") continue;
  for (const match of chunk.code.matchAll(/'\(function(?:\\.|[^'\\])*'/g)) {
    const candidate: unknown = vm.runInNewContext(match[0]);
    if (
      typeof candidate === "string" &&
      candidate.includes("Invalid current canonical request")
    )
      source = candidate;
  }
}
if (!source) throw Error("Current canonical worker missing");
let receive: ((event: { data: unknown }) => void) | undefined;
const responses: { ok: boolean; result?: CanonicalResult }[] = [];
vm.runInNewContext(source, {
  self: {
    addEventListener: (_type: string, callback: typeof receive) => {
      receive = callback;
    },
    postMessage: (value: (typeof responses)[number]) => {
      responses.push(value);
    },
  },
  performance,
  URL,
  TextEncoder,
  TextDecoder,
  setTimeout,
  clearTimeout,
});
if (!receive) throw Error("Worker listener missing");
const samples = [
  "\uFEFF# 中文 😀\r\n\r\n[链接](https://example.invalid)\r\n",
  "# 未保存\n\n<script>globalThis.executed = true</script>",
  "",
  "# 真实文档版本\n".repeat(1000),
];
for (const [index, text] of samples.entries())
  receive({
    data: {
      documentId: `session-${index}`,
      revision: index,
      requestId: index + 1,
      config: CANONICAL_CONFIG,
      text,
    },
  });
for (const [index, value] of responses.entries()) {
  if (
    !value.ok ||
    value.result?.documentId !== `session-${index}` ||
    value.result.revision !== index ||
    value.result.requestId !== index + 1 ||
    value.result.tree.type !== "root" ||
    value.result.config !== CANONICAL_CONFIG
  )
    throw Error("Worker identity/content result failed");
}
if (
  responses.length !== samples.length ||
  responses[0].result?.tree.children[0].position?.start.offset !== 1 ||
  responses[2].result?.tree.children.length !== 0 ||
  responses[3].result?.tree.children.length !== 1000
)
  throw Error("Worker content failed");
receive({
  data: {
    documentId: "d",
    revision: 0,
    requestId: 10,
    config: "unknown",
    text: "# unsupported",
  },
});
if (responses[responses.length - 1]?.ok !== false)
  throw Error("Invalid config accepted");
console.info(
  `Bundled current-document no-DOM Worker: ${samples.length} valid + 1 invalid request passed`
);
