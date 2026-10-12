import { MARKDOWN_GRAMMAR } from "../shared/markdown-profile";

import { BomAwareParser } from "./bom-aware-parser";
import {
  encodeMarkdownTree,
  type MarkdownParseRequest,
  type MarkdownParseResponse,
} from "./markdown-tree-wire";

const parser = new BomAwareParser();
self.addEventListener(
  "message",
  (event: MessageEvent<MarkdownParseRequest>) => {
    const { requestId, text } = event.data;
    let response: MarkdownParseResponse;
    try {
      if (event.data.config !== MARKDOWN_GRAMMAR)
        throw new Error("Invalid grammar");
      response = {
        config: MARKDOWN_GRAMMAR,
        requestId,
        tree: encodeMarkdownTree(parser.parse(text)),
      };
    } catch {
      response = { config: MARKDOWN_GRAMMAR, requestId, error: true };
    }
    self.postMessage(response);
  }
);
