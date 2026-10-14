// Frozen short semantic cases from the approved F-051b experiments.
export const calloutQueryFixtures = [
  {
    id: "NOTE",
    raw: "> [!NOTE]\n> body",
    expected: true,
  },
  {
    id: "TIP",
    raw: "> [!TIP]\n> body",
    expected: true,
  },
  {
    id: "IMPORTANT",
    raw: "> [!IMPORTANT]\n> body",
    expected: true,
  },
  {
    id: "WARNING",
    raw: "> [!WARNING]\n> body",
    expected: true,
  },
  {
    id: "CAUTION",
    raw: "> [!CAUTION]\n> body",
    expected: true,
  },
  {
    id: "lower",
    raw: "> [!note]\n> body",
    expected: false,
  },
  {
    id: "unknown",
    raw: "> [!OTHER]\n> body",
    expected: false,
  },
  {
    id: 'suffix" "',
    raw: "> [!NOTE] \n> body",
    expected: false,
  },
  {
    id: 'suffix"  "',
    raw: "> [!NOTE]  \n> body",
    expected: false,
  },
  {
    id: 'suffix"\\t"',
    raw: "> [!NOTE]\t\n> body",
    expected: false,
  },
  {
    id: 'suffix" custom"',
    raw: "> [!NOTE] custom\n> body",
    expected: false,
  },
  {
    id: 'suffix"+"',
    raw: "> [!NOTE]+\n> body",
    expected: false,
  },
  {
    id: 'suffix"-"',
    raw: "> [!NOTE]-\n> body",
    expected: false,
  },
  {
    id: "empty",
    raw: "> [!NOTE]",
    expected: false,
  },
  {
    id: "emptyblank",
    raw: "> [!NOTE]\n>",
    expected: false,
  },
  {
    id: "paragraph",
    raw: "> [!NOTE]\n>\n> body",
    expected: true,
  },
  {
    id: "lazy",
    raw: "> [!NOTE]\nbody",
    expected: true,
  },
  {
    id: "beforedefinition",
    raw: "> [a]: /url\n> [!NOTE]\n> body",
    expected: false,
  },
  {
    id: "same-definition",
    raw: "> [!NOTE]\n> body\n\n[!NOTE]: /url",
    expected: false,
  },
  {
    id: "escape-open",
    raw: "> \\[!NOTE]\n> body",
    expected: false,
  },
  {
    id: "escape-bang",
    raw: "> [\\!NOTE]\n> body",
    expected: false,
  },
  {
    id: "numeric",
    raw: "> &#91;!NOTE]\n> body",
    expected: false,
  },
  {
    id: "entity",
    raw: "> &lbrack;!NOTE]\n> body",
    expected: false,
  },
  {
    id: "inline",
    raw: "> `[!NOTE]`\n> body",
    expected: false,
  },
  {
    id: "link",
    raw: "> [!NOTE](/url)\n> body",
    expected: false,
  },
  {
    id: "image",
    raw: "> ![!NOTE](/img)\n> body",
    expected: false,
  },
  {
    id: "list",
    raw: "- > [!NOTE]\n  > body",
    expected: false,
  },
  {
    id: "nested",
    raw: "> > [!NOTE]\n> > body",
    expected: false,
  },
  {
    id: "inner-marker",
    raw: "> [!NOTE]\n> body\n>\n> > [!TIP]\n> > inner",
    expected: true,
  },
  {
    id: "inline-body",
    raw: "> [!NOTE]\n> **bold** ~~strike~~ [link](/url) https://example.com",
    expected: true,
  },
  {
    id: "task",
    raw: "> [!NOTE]\n>\n> - [x] done",
    expected: true,
  },
  {
    id: "table",
    raw: "> [!NOTE]\n>\n> | a | b |\n> | - | - |\n> | x | y |",
    expected: true,
  },
  {
    id: "html",
    raw: "> [!NOTE]\n>\n> <script>alert(1)</script>",
    expected: true,
  },
  {
    id: "empty-code",
    raw: "> [!NOTE]\n>\n> ```\n> ```",
    expected: true,
  },
  {
    id: "empty-html",
    raw: "> [!NOTE]\n>\n> <div></div>",
    expected: true,
  },
  {
    id: "definition-only",
    raw: "> [!NOTE]\n>\n> [a]: /url",
    expected: false,
  },
  {
    id: "empty-nested",
    raw: "> [!NOTE]\n>\n> >",
    expected: false,
  },
  {
    id: "lf",
    raw: "> [!TIP]\n> body",
    expected: true,
  },
  {
    id: "crlf",
    raw: "> [!TIP]\r\n> body",
    expected: true,
  },
  {
    id: "cr",
    raw: "> [!TIP]\r> body",
    expected: true,
  },
  {
    id: "bom",
    raw: "﻿> [!TIP]\r\n> body",
    expected: true,
  },
  {
    id: "neighbor",
    raw: "before\n\n> [!NOTE]\n> body\n\nafter",
    expected: true,
  },
  {
    id: "escaped-body",
    raw: "> [!NOTE]\n> &amp; \\* body",
    expected: true,
  },
  {
    id: "www-body",
    raw: "> [!NOTE]\n> visit www.example.com",
    expected: true,
  },
  {
    id: "email-body",
    raw: "> [!NOTE]\n> mail a@example.com",
    expected: true,
  },
  {
    id: "mixed-eol",
    raw: "> [!NOTE]\r\n> body\r> continuation\n> final",
    expected: true,
  },
  {
    id: "bom-missing-text",
    raw: "﻿> [!NOTE]\r\n> visit www&#46;example.com",
    expected: true,
  },
  {
    id: "empty-first-line",
    raw: ">\n> [!NOTE]\n> body",
    expected: false,
  },
  {
    id: "empty-spaced-first-line",
    raw: ">   \n> [!NOTE]\n> body",
    expected: false,
  },
  {
    id: "leading-definition-blank",
    raw: "> [a]: /url\n>\n> [!NOTE]\n> body",
    expected: false,
  },
  {
    id: "label-collision",
    raw: "> [!NOTE]\n> body\n\n[!note]: /url",
    expected: false,
  },
  {
    id: "nested-list",
    raw: "- outer\n\n  > [!NOTE]\n  > body",
    expected: false,
  },
  {
    id: "nested-both",
    raw: "> outer\n>\n> > [!NOTE]\n> > body",
    expected: false,
  },
  {
    id: "entity-marker-url",
    raw: "> &#91;!NOTE]\n> visit www&#46;example.com",
    expected: false,
  },
  {
    id: "escaped-marker-url",
    raw: "> \\[!NOTE]\n> visit www&#46;example.com",
    expected: false,
  },
  {
    id: "link-marker-url",
    raw: "> [!NOTE](/url)\n> visit www&#46;example.com",
    expected: false,
  },
  {
    id: "missing-position-0",
    raw: "> [!NOTE]\n> visit www&#46;example.com",
    expected: true,
  },
  {
    id: "missing-position-1",
    raw: "> [!NOTE]\n> visit www\\.example.com",
    expected: true,
  },
  {
    id: "missing-position-2",
    raw: "> [!NOTE]\n> visit &#104;ttps://example.com",
    expected: true,
  },
  {
    id: "entity-whitespace-only",
    raw: "> [!NOTE]\n> &nbsp;",
    expected: false,
  },
  {
    id: "normalize-label-0",
    raw: "> [!NOTE]\n> body\n\n[ !note ]: /url",
    expected: false,
  },
  {
    id: "normalize-label-1",
    raw: "> [!NOTE]\n> body\n\n[\n!NOTE\n]: /url",
    expected: false,
  },
  {
    id: "normalize-label-2",
    raw: "> [!NOTE]\n> body\n\n> [\n> !NOTE\n> ]: /url",
    expected: false,
  },
  {
    id: "normalize-label-3",
    raw: "> [!NOTE]\n> body\n\n- [!NOTE]: /url",
    expected: false,
  },
  {
    id: "distinct-label-0",
    raw: "> [!NOTE]\n> body\n\n[\\!NOTE]: /url",
    expected: true,
  },
  {
    id: "distinct-label-1",
    raw: "> [!NOTE]\n> body\n\n[!NO&#84;E]: /url",
    expected: true,
  },
  {
    id: "distinct-label-2",
    raw: "> [!NOTE]\n> body\n\n[!NO TE]: /url",
    expected: true,
  },
  {
    id: "decoded-blank-0",
    raw: "> [!NOTE]\n> &Tab;",
    expected: false,
  },
  {
    id: "decoded-blank-1",
    raw: "> [!NOTE]\n> &#32;",
    expected: false,
  },
  {
    id: "decoded-blank-2",
    raw: "> [!NOTE]\n> &#xA0;",
    expected: false,
  },
  {
    id: "replacement-entity",
    raw: "> [!NOTE]\n> &#0;",
    expected: true,
  },
] as const;
