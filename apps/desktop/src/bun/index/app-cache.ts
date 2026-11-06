import { lstatSync, realpathSync, type BigIntStats } from "node:fs";
import { mkdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { getAppHomePath } from "@agentic-markdown/shared/server";

import { record } from "./protocol";
import { searchWithIndexReuse, type IndexReuseInput } from "./reuse";

type BoundaryError = "CANCELLED" | "UNAVAILABLE";

const fail = (error: BoundaryError) => ({ ok: false as const, error, accepted: false });

/** The supplied rows must come from a fresh authorized snapshot. */
export async function searchAppIndexCache(input: IndexReuseInput, current: () => boolean) {
  let stopped: BoundaryError | undefined;
  const boundaryFailure = () => fail(stopped ?? "UNAVAILABLE");
  const callerCurrent = () => {
    if (stopped) return false;
    try {
      if (current()) return true;
      stopped = "CANCELLED";
    } catch {
      stopped = "UNAVAILABLE";
    }
    return false;
  };
  if (!callerCurrent()) return boundaryFailure();
  const uid = process.getuid?.();
  const home = getAppHomePath();
  if (uid === undefined || !isAbsolute(home) || resolve(home) !== home)
    return fail("UNAVAILABLE");

  const owner = BigInt(uid);
  const pins: { path: string; stat: BigIntStats }[] = [];
  const pin = (path: string, privateMode: boolean) => {
    const stat = lstatSync(path, { bigint: true });
    if (!stat.isDirectory() || stat.uid !== owner ||
        (privateMode ? (stat.mode & 0o7777n) !== 0o700n : (stat.mode & 0o022n) !== 0n))
      throw Error("Index cache directory unavailable");
    pins.push({ path, stat });
  };
  const cacheCurrent = () => {
    if (!callerCurrent()) return false;
    try {
      if (realpathSync(home) !== home) throw Error("Index cache home unavailable");
      for (const { path, stat } of pins) {
        const latest = lstatSync(path, { bigint: true });
        if (latest.dev !== stat.dev || latest.ino !== stat.ino ||
            latest.uid !== stat.uid || latest.mode !== stat.mode)
          throw Error("Index cache directory changed");
      }
      return true;
    } catch {
      stopped = "UNAVAILABLE";
      return false;
    }
  };

  try {
    pin(home, false);
    let directory = home;
    for (const name of ["search-index", "limited-v1"]) {
      if (!cacheCurrent()) return boundaryFailure();
      directory = join(directory, name);
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (error) {
        if (!record(error) || error.code !== "EEXIST") throw error;
      }
      if (!cacheCurrent()) return boundaryFailure();
      pin(directory, true);
    }
    if (!cacheCurrent()) return boundaryFailure();
    const result = await searchWithIndexReuse(directory, input, cacheCurrent);
    if (!result.ok && (result.error === "UNKNOWN" || result.error === "SCHEMA" || result.error === "BUSY"))
      return result;
    return cacheCurrent() ? result : boundaryFailure();
  } catch {
    callerCurrent();
    return boundaryFailure();
  }
}
