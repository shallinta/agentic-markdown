/** Fixed synthetic examples only; not a user-document protocol. */
export const CANONICAL_CONFIG = "commonmark-core-1";
interface CanonicalSample {
  id: string;
  label: string;
  text: string;
  expected: Record<string, number>;
  editor: Record<string, number>;
  decoded?: string;
  headings?: number[];
  targets?: string[];
  ranges?: { kind: string; from: number; to: number; source: string }[];
}
export const canonicalCorpus: readonly CanonicalSample[] = [
  {
    id: "heading",
    headings: [1, 2],
    label: "标题与容器",
    text: "# 标题\n\n> - 项目\n\n次级\n---",
    expected: { heading: 2, blockquote: 1, list: 1, listItem: 1 },
    editor: { heading: 2, blockquote: 1, list: 1, listItem: 1 },
  },
  {
    id: "inline",
    targets: ["local.md"],
    label: "行内链接与强调",
    text: "[**标签**](local.md) 与 `代码`",
    expected: { link: 1, strong: 1, inlineCode: 1 },
    editor: { link: 1, strong: 1, inlineCode: 1 },
  },
  {
    id: "reference-defined",
    targets: ["local.md"],
    label: "有定义的引用",
    text: "[标签][ref]\n\n[ref]: local.md",
    expected: { linkReference: 1, definition: 1 },
    editor: { referenceCandidate: 1, definition: 1 },
  },
  {
    id: "reference-missing",
    label: "无定义的引用",
    text: "[标签][ref]",
    expected: {},
    editor: { referenceCandidate: 1 },
  },
  {
    id: "characters",
    label: "转义与实体",
    text: "\\* &amp; &#65; &NotEqualTilde;",
    expected: {},
    editor: { escape: 1, entity: 3 },
    decoded: "* & A ≂̸",
  },
  {
    id: "breaks",
    label: "硬换行与软换行",
    text: "一  \n二\\\n三\n四",
    expected: { break: 2 },
    editor: { break: 2 },
  },
  {
    id: "literal",
    label: "代码与惰性 HTML",
    text: "```md\n<script>x</script>\n```\n\n<script>x</script>",
    expected: { code: 1, html: 1 },
    editor: { code: 1, html: 1 },
  },
  {
    id: "mixed",
    headings: [1],
    targets: ["x"],
    label: "BOM、混合行尾与组合",
    text: "\uFEFF> 标题 &amp;\r\n> ===\n\n- [标签](x)  \r\n  下一行",
    expected: {
      blockquote: 1,
      heading: 1,
      list: 1,
      listItem: 1,
      link: 1,
      break: 1,
    },
    editor: {
      blockquote: 1,
      heading: 1,
      list: 1,
      listItem: 1,
      link: 1,
      break: 1,
      entity: 1,
    },
  },
  {
    id: "reference-changed",
    label: "引用定义目标变化",
    text: "[标签][ref]\n\n[ref]: changed.md",
    expected: { linkReference: 1, definition: 1 },
    editor: { referenceCandidate: 1, definition: 1 },
    targets: ["changed.md"],
  },
  {
    id: "positions",
    label: "BOM、CRLF 与 emoji 精确范围",
    text: "\uFEFF# 😀\r\n\r\n[标签](x)\n",
    expected: { heading: 1, link: 1 },
    editor: { heading: 1, link: 1 },
    headings: [1],
    targets: ["x"],
    ranges: [
      { kind: "heading", from: 1, to: 5, source: "# 😀" },
      { kind: "link", from: 9, to: 16, source: "[标签](x)" },
    ],
  },
];
export interface CanonicalRow {
  id: string;
  canonical: Record<string, number>;
  editor: Record<string, number>;
  passed: boolean;
  rangesValid: boolean;
  decodedMatches: boolean;
  semanticMatches: boolean;
  headings: number[];
  targets: string[];
  milliseconds: number;
}
