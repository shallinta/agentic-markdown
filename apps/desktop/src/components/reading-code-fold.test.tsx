import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { ReadingCode } from "./reading-code";

const fold = {
  id: 3,
  controller: {
    registerCodeButton: () => () => undefined,
    registerCodeBody: () => () => undefined,
    toggleCode: () => undefined,
  },
};

test("the independent reader fold control keeps the audited child order and exact code", () => {
  const value = "  const sample = '<tag>';\n\n  trailing  ";
  const html = renderToStaticMarkup(<ReadingCode value={value} language="js" current={() => true} fold={fold} />);
  expect(html).toBe(
    '<div class="reading-code">' +
      '<span class="reading-code-language">js · 3 行</span>' +
      '<button type="button" class="reading-code-copy" aria-label="复制代码正文">复制</button>' +
      '<button type="button" class="reading-code-toggle" aria-expanded="true" aria-label="折叠代码">›</button>' +
      '<pre class="reading-code-body"><code>  const sample = &#x27;&lt;tag&gt;&#x27;;\n\n  trailing  </code></pre>' +
      '<p class="reading-code-status" role="status" aria-live="polite"></p></div>'
  );
});

test("the line summary handles empty, mixed, and trailing line breaks and leaves ordinary blocks unchanged", () => {
  const text = "one\r\ntwo\rthree\n";
  const html = renderToStaticMarkup(<ReadingCode value={text} fold={fold} />);
  expect(html).toContain("代码 · 4 行");
  expect(html).toContain(`<code>${text}</code>`);
  expect(renderToStaticMarkup(<ReadingCode value="" fold={fold} />)).toContain("代码 · 0 行");
  expect(renderToStaticMarkup(<ReadingCode value="one" language="js" />)).toBe(
    '<div class="reading-code"><span class="reading-code-language">js</span>' +
      '<button type="button" class="reading-code-copy" aria-label="复制代码正文" disabled="">复制</button>' +
      '<pre class="reading-code-body"><code>one</code></pre>' +
      '<p class="reading-code-status" role="status" aria-live="polite"></p></div>'
  );
});
