import { nameToEmoji } from "gemoji";

/** Run with --check to verify the committed fixed map, or print its source. */
export function generatedEmojiMap() {
  const entries = Object.entries(nameToEmoji).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  );
  for (const [name, value] of entries)
    if (
      !/^[A-Za-z0-9_+-]+$/.test(name) ||
      !value ||
      /[\p{Cc}\p{Cs}]/u.test(value)
    )
      throw new Error("Fixed Emoji mapping contains unsupported data");
  return `// Generated from gemoji@8.1.0; run apps/desktop/scripts/generate-emoji-map.ts.
// MIT: Titus Wormer, underlying GitHub gemoji data. See emoji-map.LICENSE.
// No descriptions or search index are imported into the runtime.
export const EMOJI_MAPPING_VERSION = "gemoji@8.1.0";
export const EMOJI_MAX_NAME = ${Math.max(...entries.map(([name]) => name.length))};
export const emojiNames: Readonly<Record<string, string>> = Object.freeze(${JSON.stringify(Object.fromEntries(entries), null, 2)});
`;
}

if (import.meta.main) {
  const output = generatedEmojiMap();
  if (process.argv.includes("--check")) {
    const actual = await Bun.file(
      new URL("../src/client/emoji-map.ts", import.meta.url)
    ).text();
    if (output !== actual) throw new Error("Fixed Emoji map is out of date");
    console.info("Fixed Emoji map is reproducible.");
  } else process.stdout.write(output);
}
