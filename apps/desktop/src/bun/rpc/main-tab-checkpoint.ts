import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import {
  validMainTabCheckpointRequest,
  type MainTabCheckpointResponse,
} from "../../shared/main-tab-checkpoint";
import type { createGuardedMainTabCheckpoint } from "../session/main-tab-checkpoint";

type Writer = Pick<
  ReturnType<typeof createGuardedMainTabCheckpoint>,
  "write" | "close"
>;
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
    async request(input: unknown): Promise<MainTabCheckpointResponse> {
      if (!validMainTabCheckpointRequest(input) || !available())
        return rejected();
      const ticket = ++generation;
      try {
        writer ??= createWriter();
        const result = await writer.write(
          { tabs: input.tabs, activeIndex: input.activeIndex },
          () => ticket === generation && available()
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
