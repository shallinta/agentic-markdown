import { describe, expect, test } from "bun:test";

import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState, type Transaction } from "@codemirror/state";

import { MAX_DOCUMENT_BYTES } from "../shared/documents";

import { pauseEditorParser, switchEditorMode } from "./editor-mode";
import { planRasterPaste, rasterPasteTransaction } from "./raster-paste-plan";
import { createRawEditorState, rawText, writePermission } from "./raw-buffer";

const path = "./assets/image-a1234567-a123-4123-8123-0123456789ab-4.png";
const link = `![图片](${path})`;

function selected(raw: string, anchor: number, head = anchor) {
  return createRawEditorState(raw).update({ selection: { anchor, head } }).state;
}

describe("raster paste insertion plan", () => {
  test("replaces a single text range, preserves BOM/CRLF and creates a separate undo event", () => {
    const raw = "\uFEFF甲😀乙\r\n\r\n末尾\r\n";
    const before = selected(raw, 2, 4);
    const plan = planRasterPaste(before);
    expect(plan).toBeDefined();
    const paste = rasterPasteTransaction(before, plan!, path);
    expect(paste?.isUserEvent("input.paste")).toBe(true);
    expect(paste?.state.field(rawText)).toBe(`\uFEFF甲${link}乙\r\n\r\n末尾\r\n`);
    expect(paste?.newSelection.main).toEqual(EditorSelection.cursor(2 + link.length));

    let state = paste!.state.update({ changes: { from: 0, insert: "a" }, userEvent: "input.type" }).state;
    const dispatch = (transaction: Transaction) => { state = transaction.state; };
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(paste!.state.field(rawText));
    expect(undo({ state, dispatch })).toBe(true);
    expect(state.field(rawText)).toBe(raw);
  });

  test("accepts isolated empty text and rejects protected or uncertain Markdown contexts", () => {
    expect(planRasterPaste(selected("", 0))).toBeDefined();
    expect(planRasterPaste(selected("\uFEFF", 1))).toBeDefined();
    expect(planRasterPaste(selected("上文\n\n\n\n下文", 4))).toBeDefined();
    for (const [raw, from, to] of [
      ["\uFEFF正文", 0, 1], ["甲😀乙", 2, 2], ["\n正文", 0, 0],
      ["上文\n下文", 0, 4], ["普通\n后续", 1, 1],
      ["# 标题", 2, 2], ["    代码", 5, 5], ["- 列表", 3, 3], ["> 引用", 3, 3],
      ["```\n代码\n```", 5, 5], ["```\n\n", 5, 5], ["```\n\n```", 4, 4],
      ["---\n\n---", 4, 4], ["<script>\n\n", 10, 10],
      ["正文 `代码` 末尾", 4, 4], ["正文 [文字](目标)", 5, 5],
      ["正文 ![文字](目标)", 6, 6], ["正文 `代码` 末尾", 2, 9],
      ["正文\\", 3, 3], ["a".repeat(10_000), 1, 1],
    ] as const) {
      expect(planRasterPaste(selected(raw, from, to))).toBeUndefined();
    }
  });

  test("rejects stale range, changed document, read-only state and non-generated paths", () => {
    const original = selected("正文文字", 1, 3);
    const plan = planRasterPaste(original)!;
    expect(plan).toBeDefined();
    expect(rasterPasteTransaction(original.update({ selection: { anchor: 3, head: 1 } }).state, plan, path)).toBeUndefined();
    const changed = original.update({ changes: { from: 4, insert: "！" } }).state;
    expect(rasterPasteTransaction(changed, plan, path)).toBeUndefined();
    const readOnly = original.update({ effects: writePermission.reconfigure(EditorState.readOnly.of(true)) }).state;
    expect(rasterPasteTransaction(readOnly, plan, path)).toBeUndefined();
    const source = original.update({ effects: switchEditorMode("source") }).state;
    expect(rasterPasteTransaction(source, plan, path)).toBeUndefined();
    const paused = original.update({ effects: pauseEditorParser(true) }).state;
    expect(rasterPasteTransaction(paused, plan, path)).toBeUndefined();
    const multi = createRawEditorState("正文文字", EditorState.allowMultipleSelections.of(true)).update({
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(3)]),
    }).state;
    expect(planRasterPaste(multi)).toBeUndefined();
    for (const invalid of [null, path + "\n", path.replace("-4.png", "-5.png"), path.replace(".png", ".jpeg"),
      path.replace("-4123-", "-1123-"), path.replace("-8123-", "-7123-"), path.replace("./assets", "../assets")]) {
      expect(rasterPasteTransaction(original, plan, invalid)).toBeUndefined();
    }
    expect(rasterPasteTransaction(original, plan, path.replace("-4.png", ".jpg"))).toBeDefined();
  });

  test("reserves the longest generated link using exact raw UTF-8 bytes", () => {
    const bytes = (text: string) => new TextEncoder().encode(text).length;
    const tail = "\r\n\r\n";
    const fill = "x".repeat(MAX_DOCUMENT_BYTES - bytes(`\uFEFF甲${link}乙${tail}`));
    const raw = `\uFEFF甲😀乙${tail}${fill}`;
    const before = selected(raw, 2, 4);
    const plan = planRasterPaste(before);
    expect(plan).toBeDefined();
    const paste = rasterPasteTransaction(before, plan!, path);
    expect(bytes(paste!.state.field(rawText))).toBe(MAX_DOCUMENT_BYTES);
    expect(planRasterPaste(selected(raw + "x", 2, 4))).toBeUndefined();
  });
});
