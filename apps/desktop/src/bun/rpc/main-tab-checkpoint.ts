import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import {
  validMainTabCheckpointRequest,
  type MainTabCheckpointResponse,
  type MainTabSourceInput,
} from "../../shared/main-tab-checkpoint";
import type { createGuardedMainTabCheckpoint } from "../session/main-tab-checkpoint";
import type { MainTabMetadataObservation } from "../session/main-tab-metadata";

type Writer = Pick<
  ReturnType<typeof createGuardedMainTabCheckpoint>,
  "write" | "clear" | "close"
> &
  Partial<Pick<ReturnType<typeof createGuardedMainTabCheckpoint>, "claim">>;
/** One ordinary packaged main-window lifecycle. No startup or exit writes. */
export function createMainTabCheckpointRPC(
  enabled: boolean,
  isPackagedMain: () => boolean,
  createWriter: () => Writer
) {
  let ready = false,
    closed = false,
    suspensions = 0,
    generation = 0;
  let writer: Writer | undefined;
  const available = () =>
    enabled && !closed && ready && !suspensions && isPackagedMain();
  const rejected = (): MainTabCheckpointResponse => ({
    protocolVersion: 1,
    status: "rejected",
  });
  return {
    ready(event: unknown) {
      generation++;
      ready =
        !!event &&
        typeof event === "object" &&
        "data" in event &&
        !!event.data &&
        typeof event.data === "object" &&
        "detail" in event.data &&
        event.data.detail === PACKAGED_VIEW_URL;
    },
    navigate() {
      ready = false;
      generation++;
      const retired = writer;
      writer = undefined;
      void retired?.close().catch(() => undefined);
    },
    suspend() {
      suspensions++;
      generation++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          suspensions--;
        }
      };
    },
    prepareClaim() {
      const ticket = generation;
      return async (
        receipt: MainTabMetadataObservation,
        callerCurrent: () => boolean = () => true,
        sources?: readonly MainTabSourceInput[]
      ) => {
        const current = () =>
          ticket === generation && available() && callerCurrent() === true;
        if (!current()) return false;
        try {
          writer ??= createWriter();
          return (await writer.claim?.(receipt, current, sources)) ?? false;
        } catch {
          return false;
        }
      };
    },
    async request(input: unknown): Promise<MainTabCheckpointResponse> {
      if (!validMainTabCheckpointRequest(input) || !available())
        return rejected();
      const ticket = ++generation;
      try {
        writer ??= createWriter();
        const current = () => ticket === generation && available();
        const result =
          "op" in input
            ? await writer.clear(current)
            : await writer.write(
                { tabs: input.tabs, activeIndex: input.activeIndex },
                current
              );
        // A completed publication is not undone by a later lifecycle event.
        return { protocolVersion: 1, status: result.status };
      } catch {
        return { protocolVersion: 1, status: "unknown" };
      }
    },
    dispose() {
      closed = true;
      ready = false;
      generation++;
      // Metadata completion cannot hold up application shutdown.
      void writer?.close().catch(() => undefined);
    },
  };
}
