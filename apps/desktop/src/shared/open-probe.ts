/** Fixed disposable corpus only. All large samples stay below the production 1 MiB limit. */
export const OPEN_PROBE_CASES = 6;
export function openProbeText(index: number): string {
  const head = "\uFEFF# 打开样本\r\n\n";
  switch (index) {
    case 0:
      return head + "普通 **小样本**\n尾段\r\n";
    case 1:
      return head + "ordinary short line\n".repeat(40_000);
    case 2:
      return head + "**bold** *em* [link](local.md) &amp;\n\n".repeat(20_000);
    case 3:
      return head + "```js\n" + "const value = 1;\n".repeat(40_000) + "```\n";
    case 4:
      return head + "```js\n" + "const value = 1;\n".repeat(40_000);
    case 5:
      return (
        head +
        "## 标题\n\n> 引用\n\n- item\n\n**bold**\n\n```js\nx\n```\n\n".repeat(
          10_000
        )
      );
    default:
      throw new Error("Unknown sample");
  }
}
