import type { TextFidelity } from "../shared/text-fidelity";

const styleNames = {
  none: "无 LF/CRLF",
  lf: "LF",
  crlf: "CRLF",
  mixed: "混合（LF 与 CRLF）",
};
const dominantNames = {
  none: "无 LF/CRLF",
  lf: "LF",
  crlf: "CRLF",
  tie: "并列（LF 与 CRLF）",
};
const endingNames = { none: "无换行", lf: "LF", crlf: "CRLF", cr: "孤立 CR" };

export function TextFidelityDetails({ fidelity }: { fidelity: TextFidelity }) {
  return (
    <>
      <dt>编码</dt>
      <dd>UTF-8</dd>
      <dt>开头 BOM</dt>
      <dd>{fidelity.bom ? "有（保留原文）" : "无"}</dd>
      <dt>换行风格</dt>
      <dd>{styleNames[fidelity.newlineStyle]}</dd>
      <dt>换行计数</dt>
      <dd>
        LF：{fidelity.lf} · CRLF：{fidelity.crlf} · 孤立 CR：{fidelity.loneCr}
      </dd>
      <dt>主换行风格</dt>
      <dd>{dominantNames[fidelity.dominantNewline]}</dd>
      <dt>末尾换行</dt>
      <dd>{endingNames[fidelity.ending]}</dd>
    </>
  );
}
