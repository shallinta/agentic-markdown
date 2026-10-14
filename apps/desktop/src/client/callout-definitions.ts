import type { Tree } from "@lezer/common";
import { normalizeIdentifier } from "micromark-util-normalize-identifier";

/** Runs only on a completed fixed-profile tree in the independent Worker. */
export function calloutDefinitions(tree: Tree, text: string): string[] {
  const labels = new Set<string>();
  tree.iterate({
    enter(ref) {
      if (ref.name !== "LinkReference")
        return [
          "Document",
          "Blockquote",
          "BulletList",
          "OrderedList",
          "ListItem",
        ].includes(ref.name)
          ? undefined
          : false;
      const label = ref.node.getChild("LinkLabel");
      if (!label) return false;
      const omitted: { from: number; to: number }[] = [];
      label.cursor().iterate((node) => {
        if (node.name === "QuoteMark")
          omitted.push({ from: node.from, to: node.to });
      });
      let value = "",
        skip = 0;
      for (let at = label.from + 1; at < label.to - 1; at++) {
        while (skip < omitted.length && omitted[skip].to <= at) skip++;
        if (skip < omitted.length && omitted[skip].from <= at) continue;
        value += text[at];
      }
      const normalized = normalizeIdentifier(value);
      labels.add(normalized);
      return false;
    },
  });
  return [...labels];
}
