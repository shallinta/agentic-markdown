export const FRONTMATTER_DIAGNOSTIC_CONFIG = "yaml-syntax-2.9.0-1";
export const FRONTMATTER_DIAGNOSTIC_LIMIT = 65_536;
export const FRONTMATTER_DIAGNOSTIC_COUNT = 32;
export interface FrontmatterDiagnostic {
  code: string;
  from: number;
  to: number;
}
export interface FrontmatterDiagnosticResult {
  hasErrors: boolean;
  hasWarnings: boolean;
  truncated: boolean;
  diagnostics: readonly FrontmatterDiagnostic[];
}
export interface FrontmatterDiagnosticRequest {
  config: typeof FRONTMATTER_DIAGNOSTIC_CONFIG;
  requestId: number;
  body: string;
}
export function validFrontmatterDiagnostic(
  value: unknown,
  length: number
): value is FrontmatterDiagnosticResult {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<FrontmatterDiagnosticResult>;
  return (
    typeof v.hasErrors === "boolean" &&
    typeof v.hasWarnings === "boolean" &&
    typeof v.truncated === "boolean" &&
    Array.isArray(v.diagnostics) &&
    v.diagnostics.length <= FRONTMATTER_DIAGNOSTIC_COUNT &&
    v.diagnostics.every((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const d = item as Partial<FrontmatterDiagnostic>;
      return (
        typeof d.code === "string" &&
        /^[A-Z_]{1,64}$/.test(d.code) &&
        Number.isSafeInteger(d.from) &&
        Number.isSafeInteger(d.to) &&
        d.from! >= 0 &&
        d.to! >= d.from! &&
        d.to! <= length
      );
    })
  );
}
