import { expect, test } from "bun:test";

import { renderToStaticMarkup } from "react-dom/server";

import { parseCanonicalMarkdown } from "../client/canonical-parser";
import { createLocalImages } from "../client/local-images";

import {
  commonmarkContent,
  isControlledReadingElement,
} from "./commonmark-content";

test("reference image uses first definition and does not fetch before intersection", () => {
  let calls = 0;
  const images = createLocalImages("handle", () => {
    calls++;
    return Promise.resolve({});
  });
  const source =
    "![替代][x]\n\n[x]: https://first.example/a\n[x]: https://second.example/b\n\n![本地](assets/a.png)";
  const html = renderToStaticMarkup(
    commonmarkContent(parseCanonicalMarkdown(source), source, images)
  );
  expect(html).toContain("first.example");
  expect(html).not.toContain("second.example");
  expect(html).toContain("图片等待加载");
  expect(html).not.toContain("src=");
  expect(calls).toBe(0);
  images.dispose();
});

test("image audit narrowly permits raster data, rejects every active URL/attribute", () => {
  const base = {
    src: "data:image/png;base64,AAAA",
    alt: "中文",
    width: "2",
    height: "2",
    decoding: "async",
    draggable: "false",
  };
  const audit = (extra: Record<string, string>) =>
    isControlledReadingElement({
      namespaceURI: "http://www.w3.org/1999/xhtml",
      localName: "img",
      attributes: Object.entries({ ...base, ...extra }).map(
        ([name, value]) => ({ name, value })
      ),
    });
  expect(audit({})).toBe(true);
  for (const src of [
    "https://example.com/a.png",
    "file:///a.png",
    "data:image/svg+xml;base64,AAAA",
    "data:text/html;base64,AAAA",
  ])
    expect(audit({ src })).toBe(false);
  const extras: Record<string, string>[] = [
    { onload: "evil" },
    { srcset: "evil" },
    { style: "background:url(evil)" },
    { width: "99999999" },
  ];
  for (const extra of extras) expect(audit(extra)).toBe(false);
});
