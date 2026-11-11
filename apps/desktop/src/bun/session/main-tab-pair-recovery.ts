import {
  createMainTabRecoveryReaderCore,
  type MainTabGroupRecoveryDependencies,
  type MainTabGroupRecoveryResult,
} from "./main-tab-group-recovery";
import type { SingleMainTabRecoveryInput } from "./main-tab-single-recovery";

export type MainTabPairRecoveryResult =
  | (Extract<MainTabGroupRecoveryResult, { status: "ready" }> & {
      activeIndex: 0 | 1;
    })
  | Exclude<MainTabGroupRecoveryResult, { status: "ready" }>;

/** Keeps the ordinary window's exact-two boundary and per-open history verification. */
export function createMainTabPairRecoveryReader(
  directory: string,
  dependencies: MainTabGroupRecoveryDependencies
) {
  const reader = createMainTabRecoveryReaderCore(directory, dependencies, true);
  return {
    async read(
      input: SingleMainTabRecoveryInput,
      current: () => boolean
    ): Promise<MainTabPairRecoveryResult> {
      const result = await reader.read(input, current);
      if (result.status !== "ready") return result;
      if (result.activeIndex === 0 || result.activeIndex === 1)
        return { ...result, activeIndex: result.activeIndex };
      return (await result.release()) === "released"
        ? { status: "rejected", reason: "unavailable" }
        : { status: "unknown", reason: "release" };
    },
    close: () => reader.close(),
  };
}
