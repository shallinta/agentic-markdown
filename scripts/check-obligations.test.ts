import { expect, test } from "bun:test";

import { verifyObligations } from "./check-obligations";

const spec = "| F-009 | 1 | 文件 | W-01 | F-001 | 未讨论 | 打开 |";
const row = "| OBL-001 | W-01 | F-009 | 文件打开 | 待承接 | — | — |";
const linkedRow = row.replace(
  "待承接 | —",
  "待承接 | [记录](./iterations/F-009-open.md)"
);
const doc =
  "> 状态：实现中\n<!-- obligations: OBL-001 -->\n<!-- deferred-obligations: none -->\nF-002 中文与外观 命令与键盘 安全与日志";

test("multiple reciprocal slices retain pending work and require all accepted before closure", () => {
  const links =
    "[A](./iterations/F-009-open.md)、[B](./iterations/F-009b-open.md)";
  const multi = row.replace("待承接 | —", `实现中 | ${links}`);
  const docs = {
    "F-009-open.md": doc.replace("状态：实现中", "状态：已验收"),
    "F-009b-open.md": doc,
  };
  expect(() => verifyObligations(multi, spec, docs)).not.toThrow();
  const accepted = multi
    .replace("实现中", "已验收")
    .replace("| — |", "| 2026-09-26 用户确认 | ");
  expect(() => verifyObligations(accepted, spec, docs)).toThrow(
    "iteration not accepted"
  );
  expect(() =>
    verifyObligations(accepted, spec, {
      ...docs,
      "F-009b-open.md": docs["F-009-open.md"],
    })
  ).not.toThrow();
  expect(() =>
    verifyObligations(multi, spec, { "F-009-open.md": docs["F-009-open.md"] })
  ).toThrow("reciprocal claim");
  expect(() =>
    verifyObligations(multi, spec, {
      ...docs,
      "F-009b-open.md": doc.replace(
        "obligations: OBL-001",
        "obligations: none"
      ),
    })
  ).toThrow("reciprocal claim");
});

test("rejects malformed and duplicate links including repeated targets with fragments", () => {
  for (const link of [
    "[A](./iterations/F-009-open.md)、oops",
    "[A](./iterations/F-009-open.md), [B](./iterations/F-009b-open.md)",
    "[A](./iterations/F-009-open.md)、",
  ])
    expect(() =>
      verifyObligations(row.replace("待承接 | —", `实现中 | ${link}`), spec, {})
    ).toThrow("malformed iteration link");
  for (const second of ["F-009-open.md", "F-009-open.md#section"])
    expect(() =>
      verifyObligations(
        row.replace(
          "待承接 | —",
          `实现中 | [A](./iterations/F-009-open.md)、[B](./iterations/${second})`
        ),
        spec,
        {}
      )
    ).toThrow("duplicate iteration links");
});
test("allows pending and active reciprocal claims", () => {
  expect(() => verifyObligations(row, spec, {})).not.toThrow();
  expect(() =>
    verifyObligations(linkedRow, spec.replace("未讨论", "实现中"), {
      "F-009-open.md": doc,
    })
  ).not.toThrow();
});
test("rejects completed owner with pending obligation", () => {
  expect(() =>
    verifyObligations(row, spec.replace("未讨论", "已验收"), {})
  ).toThrow("pending obligation");
});
test("rejects unknown owners and duplicate IDs", () => {
  expect(() =>
    verifyObligations(row.replace("F-009", "F-099"), spec, {})
  ).toThrow("unknown owner");
  expect(() => verifyObligations(`${row}\n${row}`, spec, {})).toThrow(
    "duplicate obligation"
  );
});
test("rejects missing claims, unknown IDs and missing checklist", () => {
  expect(() =>
    verifyObligations(row, spec, { "F-009-open.md": "> 状态：实现中" })
  ).toThrow("marker");
  expect(() =>
    verifyObligations(row, spec, {
      "F-009-open.md": doc.replace("OBL-001", "OBL-999"),
    })
  ).toThrow("unknown obligation");
  expect(() =>
    verifyObligations(linkedRow, spec, {
      "F-009-open.md": doc.replace("命令与键盘", ""),
    })
  ).toThrow("checklist");
});
test("rejects claims whose register has no reciprocal link", () => {
  expect(() => verifyObligations(row, spec, { "F-009-open.md": doc })).toThrow(
    "reciprocal register link"
  );
});
test("rejects completion without evidence and broken reciprocal link", () => {
  expect(() =>
    verifyObligations(row.replace("待承接", "已验收"), spec, {})
  ).toThrow("dated evidence");
  expect(() =>
    verifyObligations(
      row.replace(
        "待承接 | —",
        "实现中 | [记录](./iterations/F-009-missing.md)"
      ),
      spec,
      {}
    )
  ).toThrow("reciprocal claim");
});
test("rejects active feature without all assigned obligations", () => {
  expect(() =>
    verifyObligations(row, spec.replace("未讨论", "实现中"), {
      "F-009-open.md": doc.replace("OBL-001", "none"),
    })
  ).toThrow("unclaimed obligation");
});
test("allows explicit slice deferral but never closes accepted parent", () => {
  const deferredDoc = doc
    .replace("OBL-001", "none")
    .replace("deferred-obligations: none", "deferred-obligations: OBL-001");
  expect(() =>
    verifyObligations(row, spec.replace("未讨论", "部分完成"), {
      "F-009a-open.md": deferredDoc,
    })
  ).not.toThrow();
  expect(() =>
    verifyObligations(row, spec.replace("未讨论", "已验收"), {
      "F-009a-open.md": deferredDoc,
    })
  ).toThrow("pending obligation");
});
test("allows accepted obligation with dated evidence and accepted iteration", () => {
  const done = row.replace(
    "待承接 | — | —",
    "已验收 | [记录](./iterations/F-009-open.md) | 2026-09-21 用户验收，见迭代记录"
  );
  expect(() =>
    verifyObligations(done, spec.replace("未讨论", "已验收"), {
      "F-009-open.md": doc.replace("状态：实现中", "状态：已验收"),
    })
  ).not.toThrow();
});
test("requires the canonical status header and exactly one deferred marker", () => {
  expect(() =>
    verifyObligations(linkedRow, spec, {
      "F-009-open.md": doc.replace("> 状态：", "- 状态："),
    })
  ).toThrow("状态");
  expect(() =>
    verifyObligations(linkedRow, spec, {
      "F-009-open.md": doc.replace("<!-- deferred-obligations: none -->", ""),
    })
  ).toThrow("deferred marker");
  expect(() =>
    verifyObligations(linkedRow, spec, {
      "F-009-open.md": `${doc}\n<!-- deferred-obligations: none -->`,
    })
  ).toThrow("deferred marker");
});
test("exempts only exact historical records, not future L1 slices", () => {
  const withL1 = `${spec}\n| F-003 | 3 | 文档 | G-01 | F-001 | 已验收 | 读取 |`;
  expect(() =>
    verifyObligations(row, withL1, {
      "F-003a-document-read-service.md": "historical",
    })
  ).not.toThrow();
  expect(() =>
    verifyObligations(row, withL1, { "F-003b-new-read.md": "> 状态：实现中" })
  ).toThrow("marker");
  expect(() =>
    verifyObligations(row, withL1, {
      "F-003b-new-read.md": doc.replace("OBL-001", "none"),
    })
  ).not.toThrow();
});
