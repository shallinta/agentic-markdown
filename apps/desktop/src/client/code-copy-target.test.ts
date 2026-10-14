import { expect, test } from "bun:test";

import { ensureSyntaxTree } from "@codemirror/language";

import { parseCanonicalMarkdown } from "./canonical-parser";
import {
  findCodeCopyValue,
  rawCodeTarget,
  type CodeCopyTarget,
} from "./code-copy-target";
import { createRawEditorState, rawOffset } from "./raw-buffer";

function finish(query: ReturnType<typeof findCodeCopyValue>) {
  let result = query.next(),
    yields = 0;
  while (!result.done) {
    yields++;
    result = query.next();
  }
  return { value: result.value, yields };
}
const samples = [
  "```ts info\n a\n```",
  "~~~\na\n~~~",
  "    a\n    b\n",
  "> ```ts\n> a\n> ```",
  "- ```\n  a\n  ```",
  ">     a\n>     b",
  "- item\n\n      a\n      b",
  "> - ```\n>   a\n>   ```",
  "```\n```",
  "```",
  "```ts\na",
  "  ```\n  a\n  ```",
  "    a\n\n    b\n\nend",
  "\ta\n\tb",
  "```\na\n```\n~~~\nb\n~~~",
  " \t a\n \t b",
  "> \t a\n> \t b",
  "````md\n```js\na\n```\n````",
  "    ```\n    a\n    ```",
];
test("code copy matches actual canonical bodies across containers, indentation, BOM and EOL", () => {
  for (const sample of samples)
    for (const eol of ["\n", "\r\n", "\r"])
      for (const bom of ["", "\ufeff"]) {
        const raw = bom + sample.replaceAll("\n", eol),
          state = createRawEditorState(raw);
        const tree = ensureSyntaxTree(state, state.doc.length, 1000)!;
        const canonical = parseCanonicalMarkdown(raw),
          expected: string[] = [];
        function visit(node: {
          type: string;
          value?: string;
          children?: unknown[];
        }) {
          if (node.type === "code") expected.push(node.value!);
          for (const child of node.children ?? []) visit(child as typeof node);
        }
        visit(canonical);
        const actual: (string | null)[] = [];
        tree.iterate({
          enter(node) {
            if (node.name === "FencedCode" || node.name === "CodeBlock")
              actual.push(
                finish(
                  findCodeCopyValue(canonical, raw, {
                    kind: node.name,
                    from: rawOffset(raw, node.from),
                    to: rawOffset(raw, node.to),
                  })
                ).value
              );
          },
        });
        expect(actual).toEqual(expected);
      }
});
test("matcher rejects wrong endpoints, duplicate candidates, crossline and nonspace gaps", () => {
  const target: CodeCopyTarget = { kind: "CodeBlock", from: 4, to: 5 };
  const code = {
    type: "code",
    value: "a",
    position: { start: { offset: 0 }, end: { offset: 5 } },
  };
  expect(
    finish(findCodeCopyValue({ children: [code, code] }, "    a", target)).value
  ).toBeNull();
  for (const raw of ["\n   a", ">   a", "x   a"])
    expect(finish(findCodeCopyValue(code, raw, target)).value).toBeNull();
  expect(
    finish(findCodeCopyValue({ ...code, lang: "js" }, "    a", target)).value
  ).toBeNull();
  expect(
    finish(findCodeCopyValue(code, "    a", { ...target, to: 4 })).value
  ).toBeNull();
  expect(
    finish(findCodeCopyValue(code, "    a", { ...target, kind: "FencedCode" }))
      .value
  ).toBeNull();
});
test("large child lists and indentation gaps yield rather than expanding synchronously", () => {
  const raw = " ".repeat(9000) + "a";
  const target: CodeCopyTarget = {
    kind: "CodeBlock",
    from: 9000,
    to: raw.length,
  };
  const code = {
    type: "code",
    value: "a",
    position: { start: { offset: 0 }, end: { offset: raw.length } },
  };
  expect(
    finish(findCodeCopyValue(code, raw, target)).yields
  ).toBeGreaterThanOrEqual(2);
  const children = Array.from({ length: 1000 }, () => ({ type: "paragraph" }));
  const query = findCodeCopyValue(
    { children: [...children, code] },
    raw,
    target
  );
  expect(query.next().done).toBe(false);
  expect(finish(query).value).toBe("a");
});
test("invalid metadata cannot produce a copied value", () => {
  for (const node of [
    null,
    {},
    { type: "code", value: "bad" },
    {
      type: "code",
      value: 2,
      position: { start: { offset: 0 }, end: { offset: 1 } },
    },
  ])
    expect(
      finish(
        findCodeCopyValue(node, "a", { kind: "FencedCode", from: 0, to: 1 })
      ).value
    ).toBeNull();
});

test("preparation maps two editor endpoints in one yielding pass preserving BOM and mixed EOL", () => {
  const raw = "\ufeff" + "x\r\n".repeat(5000) + "```\r\na\r```";
  const start = 10001,
    end = 10010;
  const query = rawCodeTarget(raw, {
    kind: "FencedCode",
    from: start,
    to: end,
  });
  let result = query.next(),
    yields = 0;
  while (!result.done) {
    yields++;
    result = query.next();
  }
  expect(yields).toBeGreaterThan(0);
  expect(result.value.from).toBe(rawOffset(raw, start));
  expect(result.value.to).toBe(rawOffset(raw, end));
});
