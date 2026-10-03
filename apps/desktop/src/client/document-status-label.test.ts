import { expect, test } from "bun:test";

import {
  documentCapabilitySuffix,
  documentStatusLabel,
} from "./document-status-label";

test("status distinguishes reading view from document save capability", () => {
  const writable = { writable: true, reason: "writable" } as const;
  expect(documentStatusLabel("reading", writable)).toBe(
    "阅读模式 · 只读视图（已有未保存内容仍可保存） · "
  );
  expect(documentStatusLabel("reading", writable)).not.toContain("可编辑");
  expect(documentStatusLabel("editing", writable)).toBe("编辑模式 · 可编辑 · ");
  expect(documentStatusLabel("source", writable)).toBe("源码模式 · 可编辑 · ");
  for (const mode of ["editing", "reading", "source"] as const) {
    for (const reason of ["readonly", "invalid", "unavailable"] as const) {
      const label = documentStatusLabel(mode, { writable: false, reason });
      expect(label).toContain("只读：");
      expect(label).not.toContain("可编辑");
      expect(label).not.toContain("仍可保存");
    }
  }
});

test("compact capability label preserves unavailable/invalid/readonly distinctions", () => {
  expect(documentCapabilitySuffix({ writable: true, reason: "writable" })).toBe(
    ""
  );
  expect(
    documentCapabilitySuffix({ writable: false, reason: "readonly" })
  ).toBe(" · 只读");
  expect(documentCapabilitySuffix({ writable: false, reason: "invalid" })).toBe(
    " · 授权失效"
  );
  expect(
    documentCapabilitySuffix({ writable: false, reason: "unavailable" })
  ).toBe(" · 权限确认中");
});
