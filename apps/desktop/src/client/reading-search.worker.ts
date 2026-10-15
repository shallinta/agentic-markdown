import {
  READING_SEARCH_UNITS,
  READING_SEARCH_NODES,
} from "./reading-search-dom";
import {
  projectReading,
  type ReadingLeaf,
  type ReadingProjection,
} from "./reading-search-projection";
import { createSearchEngine } from "./source-search-engine";
import { validSearchRequest } from "./source-search-protocol";

const search = createSearchEngine(READING_SEARCH_UNITS);
let projection: ReadingProjection | undefined;
let epoch = "";
let initialized = false;
self.onmessage = (event: MessageEvent<unknown>) => {
  const data = event.data;
  if (
    data &&
    typeof data === "object" &&
    "kind" in data &&
    data.kind === "prepare"
  ) {
    const p = data as { kind: string; epoch: unknown; leaves: unknown };
    if (
      typeof p.epoch !== "string" ||
      p.epoch.length > 100 ||
      !Array.isArray(p.leaves) ||
      p.leaves.length > READING_SEARCH_NODES * 3
    )
      throw Error("Invalid reading projection");
    let units = 0;
    const ids = new Set<number>();
    for (const candidate of p.leaves as unknown[]) {
      if (!candidate || typeof candidate !== "object")
        throw Error("Invalid reading leaf");
      const leaf = candidate as Record<string, unknown>;
      if (
        typeof leaf.id !== "number" ||
        !Number.isSafeInteger(leaf.id) ||
        leaf.id < 0 ||
        ids.has(leaf.id) ||
        typeof leaf.text !== "string" ||
        typeof leaf.flow !== "string" ||
        !["normal", "pre", "boundary"].includes(leaf.flow)
      )
        throw Error("Invalid reading leaf");
      ids.add(leaf.id);
      units += leaf.text.length + (leaf.flow === "boundary" ? 1 : 0);
      if (units > READING_SEARCH_UNITS)
        throw Error("Reading projection budget");
    }
    epoch = p.epoch;
    initialized = false;
    const job = projectReading(p.leaves as ReadingLeaf[], READING_SEARCH_UNITS);
    let result = job.next();
    while (!result.done) result = job.next();
    projection = result.value;
    self.postMessage({
      kind: "prepared",
      epoch,
      length: projection.text.length,
      runs: projection.runs,
    });
    return;
  }
  if (
    !projection ||
    !validSearchRequest(data, READING_SEARCH_UNITS) ||
    data.epoch !== epoch
  )
    throw Error("Stale reading search");
  const request =
    data.kind === "scan" && !initialized
      ? { ...data, text: projection.text, boundaries: projection.boundaries }
      : data;
  const response = search(request);
  if (data.kind === "scan") initialized = true;
  self.postMessage(response);
};
