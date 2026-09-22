import { readdir } from "node:fs/promises";

type Documents = Record<string, string>;

// Only these records predate the obligation mechanism. New L1 slices are checked.
const HISTORICAL_ITERATIONS = new Set([
  "F-001-app-shell.md",
  "F-003a-document-read-service.md",
  "F-004a-single-file-authorization.md",
  "F-005a-document-task-cancellation.md",
  "F-006a-command-entrypoints.md",
  "F-007a-chinese-shell-theme.md",
  "F-008a-shell-security-baseline.md",
]);

export function verifyObligations(
  register: string,
  spec: string,
  docs: Documents
): void {
  const features = new Map<string, string>();
  for (const line of spec.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (/^F-\d{3}$/.test(cells[1] ?? "")) {
      if (features.has(cells[1]!)) throw new Error("Duplicate feature ID");
      features.set(cells[1]!, cells[6] ?? "");
    }
  }
  const entries = new Map<
    string,
    { owner: string; state: string; iteration: string }
  >();
  for (const line of register.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim());
    if (!cells[1]?.startsWith("OBL-")) continue;
    const [, id, source, owner, delivery, state, iteration, evidence] = cells;
    if (cells.length !== 9 || !/^OBL-\d{3}$/.test(id) || entries.has(id))
      throw new Error("Invalid or duplicate obligation ID/table row");
    if (!source || !delivery || !features.has(owner!))
      throw new Error(`${id}: unknown owner or empty definition`);
    if (!["待承接", "实现中", "待人工验收", "已验收"].includes(state!))
      throw new Error(`${id}: invalid state`);
    if (state !== "已验收" && features.get(owner!)?.startsWith("已验收"))
      throw new Error(`${id}: accepted owner still has pending obligation`);
    if (
      state === "已验收" &&
      (!evidence || evidence === "—" || !/\d{4}-\d{2}-\d{2}/.test(evidence))
    )
      throw new Error(`${id}: accepted without dated evidence`);
    if (state !== "待承接" && iteration === "—")
      throw new Error(`${id}: missing iteration`);
    entries.set(id, { owner: owner!, state: state!, iteration: iteration! });
  }
  if (!entries.size) throw new Error("Empty obligation register");
  const claims = new Map<string, Set<string>>();
  const deferred = new Map<string, Set<string>>();
  for (const [name, text] of Object.entries(docs)) {
    const parent = /^F-\d{3}/.exec(name)?.[0];
    if (!parent || HISTORICAL_ITERATIONS.has(name)) continue;
    if (!features.has(parent)) throw new Error(`${name}: unknown feature`);
    if ([...text.matchAll(/^> 状态：[^\n]+$/gm)].length !== 1)
      throw new Error(`${name}: expected exactly one > 状态： header`);
    const markers = [...text.matchAll(/<!-- obligations: ([^\n]+) -->/g)];
    if (markers.length !== 1)
      throw new Error(`${name}: missing or duplicate obligations marker`);
    const list =
      markers[0]![1] === "none"
        ? []
        : markers[0]![1]!.split(",").map((id) => id.trim());
    if (new Set(list).size !== list.length)
      throw new Error(`${name}: duplicate claims`);
    for (const id of list) {
      if (entries.get(id)?.owner !== parent)
        throw new Error(`${name}: unknown obligation or wrong owner ${id}`);
      const target =
        /^\[[^\]]+\]\(\.\/iterations\/([^/#]+\.md)(?:#[^)]*)?\)$/.exec(
          entries.get(id)!.iteration
        )?.[1];
      if (target !== name)
        throw new Error(
          `${name}: claim missing reciprocal register link ${id}`
        );
    }
    for (const label of ["F-002", "中文与外观", "命令与键盘", "安全与日志"]) {
      if (!text.includes(label))
        throw new Error(`${name}: missing inherited checklist ${label}`);
    }
    claims.set(name, new Set(list));
    const deferredMarkers = [
      ...text.matchAll(/<!-- deferred-obligations: ([^\n]+) -->/g),
    ];
    if (deferredMarkers.length !== 1)
      throw new Error(`${name}: missing or duplicate deferred marker`);
    const deferredValue = deferredMarkers[0]?.[1];
    const deferredList =
      !deferredValue || deferredValue === "none"
        ? []
        : deferredValue.split(",").map((id) => id.trim());
    if (new Set(deferredList).size !== deferredList.length)
      throw new Error(`${name}: duplicate deferred IDs`);
    for (const id of deferredList) {
      if (entries.get(id)?.owner !== parent || list.includes(id))
        throw new Error(`${name}: invalid deferred obligation ${id}`);
    }
    deferred.set(name, new Set(deferredList));
  }
  for (const [id, entry] of entries) {
    if (entry.iteration === "—") continue;
    const match =
      /^\[[^\]]+\]\(\.\/iterations\/([^/#]+\.md)(?:#[^)]*)?\)$/.exec(
        entry.iteration
      );
    if (!match || !claims.get(match[1]!)?.has(id))
      throw new Error(`${id}: missing iteration or reciprocal claim`);
    if (
      entry.state === "已验收" &&
      !/^> 状态：已验收\s*$/m.test(docs[match[1]!]!)
    )
      throw new Error(`${id}: iteration not accepted`);
  }
  for (const [feature, state] of features) {
    if (
      Number(feature.slice(2)) < 9 ||
      ["未讨论", "待专项设计", "部分待专项设计", "待发布前讨论"].includes(state)
    )
      continue;
    const featureDocs = [...claims.keys()].filter((name) =>
      name.startsWith(feature)
    );
    if (!featureDocs.length)
      throw new Error(`${feature}: active feature has no iteration record`);
    for (const [id, entry] of entries) {
      if (
        entry.owner === feature &&
        !featureDocs.some(
          (name) => claims.get(name)?.has(id) || deferred.get(name)?.has(id)
        )
      )
        throw new Error(`${feature}: unclaimed obligation ${id}`);
    }
  }
}

if (import.meta.main) {
  try {
    const docs: Documents = {};
    const dir = new URL("../docs/iterations/", import.meta.url);
    for (const name of await readdir(dir)) {
      if (/^F-\d{3}[a-z]?-.*\.md$/.test(name))
        docs[name] = await Bun.file(new URL(name, dir)).text();
    }
    verifyObligations(
      await Bun.file(
        new URL("../docs/deferred-obligations.md", import.meta.url)
      ).text(),
      await Bun.file(
        new URL("../docs/mvp-product-spec.md", import.meta.url)
      ).text(),
      docs
    );
    console.info(
      "Obligation ownership, claims, state and evidence references are consistent."
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
