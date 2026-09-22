/** Read-time facts only, not a future editing or saving policy. */
export interface TextFidelity {
  encoding: "utf-8";
  bom: boolean;
  lf: number;
  crlf: number;
  loneCr: number;
  newlineStyle: "none" | "lf" | "crlf" | "mixed";
  dominantNewline: "none" | "lf" | "crlf" | "tie";
  ending: "none" | "lf" | "crlf" | "cr";
}

/** One scan, constant-size output, no normalized copy or line array. */
export function analyzeTextFidelity(text: string): TextFidelity {
  let lf = 0;
  let crlf = 0;
  let loneCr = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text.charCodeAt(index);
    if (character === 13) {
      if (text.charCodeAt(index + 1) === 10) {
        crlf++;
        index++;
      } else loneCr++;
    } else if (character === 10) lf++;
  }
  return {
    encoding: "utf-8",
    bom: text.charCodeAt(0) === 0xfeff,
    lf,
    crlf,
    loneCr,
    newlineStyle: lf && crlf ? "mixed" : lf ? "lf" : crlf ? "crlf" : "none",
    dominantNewline:
      lf === crlf ? (lf ? "tie" : "none") : lf > crlf ? "lf" : "crlf",
    ending: text.endsWith("\r\n")
      ? "crlf"
      : text.endsWith("\n")
        ? "lf"
        : text.endsWith("\r")
          ? "cr"
          : "none",
  };
}

/** Require exact facts, not merely plausible counters or enum spellings. */
export function isTextFidelity(
  value: unknown,
  text: string
): value is TextFidelity {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const expected = analyzeTextFidelity(text);
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, actual]) => candidate[key] === actual)
  );
}
