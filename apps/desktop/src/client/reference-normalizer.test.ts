import { expect, test } from "bun:test";

import { normalizeIdentifier } from "micromark-util-normalize-identifier";

import { ReferenceNormalizer } from "./reference-normalizer";

for (const value of [
  "  a\t\r\nb  ",
  "ΟΣ\u0301 ΣΑ",
  "İı",
  "ﬃß",
  "ᾈᾀ",
  "𐐀𐐨",
  "\ud800x\udc00",
  "\u00a0 a \u00a0",
  "\t \n",
]) {
  test(`stream reference ${JSON.stringify(value)}`, () => {
    const normalizer = new ReferenceNormalizer(1000);
    // Deliberately test boundaries between surrogate code units, not code points.
    for (const unit of value.split("")) normalizer.push(unit);
    normalizer.finish();
    expect(normalizer.value).toBe(normalizeIdentifier(value));
    expect(normalizer.overflow).toBe(false);
  });
}
test("actual definition maximum rejects only impossible membership", () => {
  const normalizer = new ReferenceNormalizer(1);
  for (const unit of "   a   ") normalizer.push(unit);
  normalizer.finish();
  expect(normalizer.value).toBe("A");
  expect(normalizer.overflow).toBe(false);
  normalizer.push("b");
  expect(normalizer.overflow).toBe(true);
});
