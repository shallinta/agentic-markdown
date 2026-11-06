import { expect, test } from "bun:test";

import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseReadingMarkdown as parseCanonicalMarkdown } from "../client/canonical-parser";
import { createLocalImages } from "../client/local-images";
import { firstReaderImageCandidate } from "../client/reader-image-candidate";
import { createReaderImageReceiver } from "../client/reader-image-receiver";
import { ReadingImagePlaceholder, ReadingSnapshotImage } from "../components/reading-image";

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

test("independent reading attaches a receiver only to the selected AST node", () => {
  const source = "![first](same.png) ![later](same.png)";
  const tree = parseCanonicalMarkdown(source);
  const candidate = firstReaderImageCandidate(tree, source.length);
  if (!candidate) throw new Error("missing first image");
  const receiver = createReaderImageReceiver(new EventTarget(), crypto.randomUUID());
  function imageTypes(content: ReactNode): unknown[] {
    return Children.toArray(content).flatMap((element) => {
      if (!isValidElement<{ children?: ReactNode }>(element)) return [];
      if (element.type === ReadingSnapshotImage || element.type === ReadingImagePlaceholder) return [element.type];
      return imageTypes(element.props.children);
    });
  }
  try {
    receiver.setTarget(candidate.node);
    expect(imageTypes(commonmarkContent(tree, source))).toEqual([ReadingImagePlaceholder, ReadingImagePlaceholder]);
    expect(imageTypes(commonmarkContent(tree, source, undefined, undefined, undefined, {
      node: candidate.node, receiver, current: () => false,
    }))).toEqual([ReadingSnapshotImage, ReadingImagePlaceholder]);
  } finally {
    receiver.close();
  }
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
