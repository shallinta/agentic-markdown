import { parseDocument } from "yaml";

import {
  FRONTMATTER_DIAGNOSTIC_COUNT,
  FRONTMATTER_DIAGNOSTIC_LIMIT,
  validFrontmatterDiagnostic,
  type FrontmatterDiagnosticResult,
} from "./frontmatter-diagnostic-protocol";

/** Worker only. Syntax nodes never become application values or execute custom tags. */
export function diagnoseFrontmatter(body: string): FrontmatterDiagnosticResult {
  if (body.length > FRONTMATTER_DIAGNOSTIC_LIMIT)
    throw new Error("Diagnostic input limit");
  const document = parseDocument(body, {
    prettyErrors: false,
    logLevel: "silent",
  });
  const diagnostics: { code: string; from: number; to: number }[] = [];
  for (const list of [document.errors, document.warnings]) {
    const count = Math.min(
      list.length,
      FRONTMATTER_DIAGNOSTIC_COUNT - diagnostics.length
    );
    for (let index = 0; index < count; index++) {
      const item = list[index];
      // Only YAML's exact virtual EOF unit is normalized, never arbitrary overflow.
      const to =
        item.pos[0] === body.length && item.pos[1] === body.length + 1
          ? body.length
          : item.pos[1];
      diagnostics.push({ code: item.code, from: item.pos[0], to });
    }
  }
  const result = {
    hasErrors: document.errors.length > 0,
    hasWarnings: document.warnings.length > 0,
    truncated:
      document.errors.length + document.warnings.length > diagnostics.length,
    diagnostics,
  };
  if (!validFrontmatterDiagnostic(result, body.length))
    throw new Error("Invalid diagnostic range");
  return result;
}
