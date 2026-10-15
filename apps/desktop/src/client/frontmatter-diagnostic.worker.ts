import { diagnoseFrontmatter } from "./frontmatter-diagnostic";
import {
  FRONTMATTER_DIAGNOSTIC_CONFIG,
  FRONTMATTER_DIAGNOSTIC_LIMIT,
  type FrontmatterDiagnosticRequest,
} from "./frontmatter-diagnostic-protocol";
self.addEventListener("message", (event: MessageEvent<unknown>) => {
  const request = event.data as Partial<FrontmatterDiagnosticRequest> | null;
  try {
    if (
      request?.config !== FRONTMATTER_DIAGNOSTIC_CONFIG ||
      !Number.isSafeInteger(request.requestId) ||
      request.requestId! <= 0 ||
      typeof request.body !== "string" ||
      request.body.length > FRONTMATTER_DIAGNOSTIC_LIMIT
    )
      throw new Error("Invalid diagnostic request");
    self.postMessage({
      config: FRONTMATTER_DIAGNOSTIC_CONFIG,
      requestId: request.requestId,
      result: diagnoseFrontmatter(request.body),
    });
  } catch {
    self.postMessage({
      config: FRONTMATTER_DIAGNOSTIC_CONFIG,
      requestId: request?.requestId,
      unavailable: true,
    });
  }
});
