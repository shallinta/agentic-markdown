/** Existing search block ids may have gaps; ordinal ranges index visible blocks. */
export interface ReadingRootBlock {
  id: number;
  from: number;
  to: number;
  headingDepth?: number;
}
export interface ReadingHeadingSection {
  headingBlock: number;
  headingId: number;
  depth: number;
  parentHeadingId: number | null;
  bodyStart: number;
  end: number;
  from: number;
  to: number;
}
export interface ReadingHeadingProjection {
  blocks: ReadingRootBlock[];
  sections: ReadingHeadingSection[];
}

/** O(n) over the rendered root blocks. Never parses, visits descendants, or retains text. */
export function readingHeadingSections(
  blocks: readonly ReadingRootBlock[]
): ReadingHeadingSection[] | undefined {
  const sections: ReadingHeadingSection[] = [];
  const stack: ReadingHeadingSection[] = [];
  const close = (end: number) => {
    const section = stack.pop()!;
    section.end = end;
    section.to = blocks[end - 1].to;
  };
  for (const [index, block] of blocks.entries()) {
    if (
      !Number.isSafeInteger(block.id) ||
      block.id < 0 ||
      !Number.isSafeInteger(block.from) ||
      !Number.isSafeInteger(block.to) ||
      block.from < 0 ||
      block.to < block.from ||
      (index > 0 &&
        (block.id <= blocks[index - 1].id ||
          block.from < blocks[index - 1].to)) ||
      (block.headingDepth !== undefined &&
        (!Number.isInteger(block.headingDepth) ||
          block.headingDepth < 1 ||
          block.headingDepth > 6))
    )
      return undefined;
    if (block.headingDepth === undefined) continue;
    while (stack.length && stack[stack.length - 1].depth >= block.headingDepth)
      close(index);
    const section: ReadingHeadingSection = {
      headingBlock: index,
      headingId: block.id,
      depth: block.headingDepth,
      parentHeadingId: stack[stack.length - 1]?.headingId ?? null,
      bodyStart: index + 1,
      end: blocks.length,
      from: block.from,
      to: block.to,
    };
    sections.push(section);
    stack.push(section);
  }
  while (stack.length) close(blocks.length);
  return sections.filter((section) => section.end > section.bodyStart);
}
