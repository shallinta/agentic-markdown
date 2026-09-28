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
      response = { requestId, tree: encodeMarkdownTree(parser.parse(text)) };
    } catch {
      response = { requestId, error: true };
    }
    self.postMessage(response);
  }
);
