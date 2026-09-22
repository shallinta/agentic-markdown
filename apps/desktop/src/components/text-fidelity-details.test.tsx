import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { analyzeTextFidelity } from "../shared/text-fidelity";

import { TextFidelityDetails } from "./text-fidelity-details";

test("diagnostics describe mixed ties and isolated CR in Chinese", () => {
  const html = renderToStaticMarkup(
    <dl>
      <TextFidelityDetails fidelity={analyzeTextFidelity("\ufeffa\n\r\n\r")} />
    </dl>
  );
  for (const text of [
    "UTF-8",
    "有（保留原文）",
    "混合（LF 与 CRLF）",
    "并列（LF 与 CRLF）",
    "孤立 CR",
    "末尾换行",
  ])
    expect(html).toContain(text);
});
test("BOM-only diagnostics have no newline", () => {
  const html = renderToStaticMarkup(
    <dl>
      <TextFidelityDetails fidelity={analyzeTextFidelity("\ufeff")} />
    </dl>
  );
  expect(html).toContain("无 LF/CRLF");
  expect(html).toContain("无换行");
});
