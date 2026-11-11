import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import {
  validMainTabRecoveryRequest,
  type MainTabRecoveryResponse,
} from "../../shared/main-tab-recovery";
import type { MainTabMetadataObservation } from "../session/main-tab-metadata";
import type {
  createMainTabPairRecoveryReader,
  MainTabPairRecoveryResult,
} from "../session/main-tab-pair-recovery";
import type {
  createSingleMainTabRecoveryReader,
  SingleMainTabRecoveryResult,
} from "../session/main-tab-single-recovery";


type PairReader = ReturnType<typeof createMainTabPairRecoveryReader>;
type Pair = Extract<MainTabPairRecoveryResult, { status: "ready" }>;
type Reader = ReturnType<typeof createSingleMainTabRecoveryReader>;
type Ready = Extract<SingleMainTabRecoveryResult, { status: "ready" }>;
interface Slot {
  id: string;
  epoch: number;
  cancelled: boolean;
  result?: Ready | Pair;
  delivered?: number;
  itemPending?: boolean;
  quarantined?: boolean;
  adopted?: boolean;
  claim?: (
    receipt: MainTabMetadataObservation,
    current: () => boolean
  ) => Promise<boolean>;
  opening: Promise<MainTabRecoveryResponse>;
  finishing?: Promise<MainTabRecoveryResponse>;
  releasing?: Promise<"released" | "unknown">;
}
/** One delivery slot; suspension cannot revoke a grant already handed to the renderer. */
export function createMainTabRecoveryRPC(
  enabled: boolean,
  isPackagedMain: () => boolean,
  createReader: () => Reader,
  prepareClaim?: () => (
    receipt: MainTabMetadataObservation,
    current: () => boolean
  ) => Promise<boolean>,
  createPairReader?: () => PairReader
) {
  let pairReader: PairReader | undefined;
  let reader: Reader | undefined, slot: Slot | undefined;
  // Never evict an ID within a page: late RPC dispatch must not revive it.
  const seen = new Set<string>();
  const maxSeen = 128;
  let ready = false,
    closed = false,
    suspensions = 0,
    epoch = 0;
  let last:
    | { id: string; adopted: boolean; response: MainTabRecoveryResponse }
    | undefined;
  const response = (
    requestId: string,
    status: "finished" | "rejected" | "unknown"
  ): MainTabRecoveryResponse => ({ protocolVersion: 1, requestId, status });
  const available = () =>
    enabled && !closed && ready && !suspensions && isPackagedMain();
  const release = async (target: Slot): Promise<MainTabRecoveryResponse> => {
    target.cancelled = true;
    if (target.quarantined) return response(target.id, "unknown");
    const outcome = target.result
      ? await (target.releasing ??= target.result
          .release()
          .catch(() => "unknown" as const))
      : "released";
    return response(target.id, outcome === "released" ? "finished" : "unknown");
  };
  const retire = () => {
    ready = false;
    epoch++;
    const old = slot;
    slot = undefined;
    if (old && !old.adopted) {
      old.cancelled = true;
      void old.opening.then(() => release(old)).catch(() => undefined);
    }
    const oldReader = reader;
    reader = undefined;
    void oldReader?.close().catch(() => undefined);
    const oldPair = pairReader;
    pairReader = undefined;
    void oldPair?.close().catch(() => undefined);
    last = undefined;
    seen.clear();
  };
  return {
    ready(event: unknown) {
      const data =
        event && typeof event === "object" && "data" in event
          ? event.data
          : undefined;
      ready =
        !!data &&
        typeof data === "object" &&
        "detail" in data &&
        data.detail === PACKAGED_VIEW_URL;
    },
    navigate: retire,
    suspend() {
      suspensions++;
      epoch++;
      let done = false;
      return () => {
        if (!done) {
          done = true;
          suspensions--;
        }
      };
    },
    dispose() {
      closed = true;
      retire();
    },
    async request(input: unknown): Promise<MainTabRecoveryResponse> {
      if (!validMainTabRecoveryRequest(input)) return response("", "rejected");
      const { requestId } = input;
      if (input.op === "pair-item") {
        const target = slot;
        if (
          target?.id !== requestId ||
          !target.result ||
          !("tabs" in target.result) ||
          target.quarantined ||
          target.cancelled ||
          target.finishing ||
          target.itemPending ||
          (target.delivered ?? 0) !== input.index ||
          !available() ||
          target.epoch !== epoch
        )
          return response(requestId, "rejected");
        const result = target.result;
        target.itemPending = true;
        try {
          const valid =
            result.current() &&
            (input.index === 0 || (await result.revalidate()));
          if (
            !valid ||
            !result.current() ||
            slot !== target ||
            target.cancelled ||
            target.finishing ||
            !available() ||
            target.epoch !== epoch
          ) {
            const freed = await release(target);
            if (
              freed.status === "finished" &&
              slot === target &&
              !target.finishing
            )
              slot = undefined;
            return response(
              requestId,
              freed.status === "finished" ? "rejected" : "unknown"
            );
          }
          const item = result.tabs[input.index];
          target.delivered = input.index + 1;
          return {
            protocolVersion: 1,
            requestId,
            status: "pair-item",
            index: input.index,
            ...item,
          };
        } catch {
          const freed = await release(target);
          if (
            freed.status === "finished" &&
            slot === target &&
            !target.finishing
          )
            slot = undefined;
          return response(
            requestId,
            freed.status === "finished" ? "rejected" : "unknown"
          );
        } finally {
          target.itemPending = false;
        }
      }
      if (input.op === "finish") {
        if (slot?.id === requestId && slot.quarantined)
          return response(requestId, "unknown");
        if (last?.id === requestId)
          return last.adopted === input.adopted
            ? last.response
            : response(requestId, "rejected");
        const target = slot;
        if (target?.id !== requestId) {
          if (
            !target &&
            !input.adopted &&
            enabled &&
            !closed &&
            !seen.has(requestId) &&
            seen.size < maxSeen
          ) {
            seen.add(requestId);
            const result = response(requestId, "finished");
            last = { id: requestId, adopted: false, response: result };
            return result;
          }
          return response(requestId, "rejected");
        }
        if (target.finishing)
          return input.adopted === !!target.adopted
            ? target.finishing
            : response(requestId, "rejected");
        if (input.adopted) {
          if (
            !target.result ||
            target.cancelled ||
            ("tabs" in target.result &&
              (target.delivered !== 2 || target.itemPending))
          )
            return response(requestId, "rejected");
          target.adopted = true;
          target.finishing = (async () => {
            try {
              const receipt = target.result!;
              if (receipt.ownership)
                await target.claim?.(
                  receipt.ownership,
                  () =>
                    slot === target &&
                    target.epoch === epoch &&
                    available() &&
                    receipt.current()
                );
            } catch {
              /* Grant ownership already transferred; metadata failure never releases it. */
            }
            const result = response(requestId, "finished");
            if (slot === target) {
              slot = undefined;
              last = { id: requestId, adopted: true, response: result };
            }
            return result;
          })();
          return target.finishing;
        }
        target.cancelled = true;
        target.finishing = (async () => {
          await target.opening;
          const result = await release(target);
          if (slot === target) {
            if (result.status === "finished") slot = undefined;
            last = { id: requestId, adopted: false, response: result };
          }
          return result;
        })();
        return target.finishing;
      }
      if (!available() || slot || seen.has(requestId) || seen.size >= maxSeen)
        return response(requestId, "rejected");
      seen.add(requestId);
      const target: Slot = {
        id: requestId,
        epoch,
        cancelled: false,
        claim: prepareClaim?.(),
        opening: Promise.resolve(response(requestId, "rejected")),
      };
      slot = target;
      target.opening = (async () => {
        try {
          reader ??= createReader();
          const current = () =>
            slot === target &&
            !target.cancelled &&
            target.epoch === epoch &&
            available();
          let result: SingleMainTabRecoveryResult | MainTabPairRecoveryResult =
            await reader.read(input, current);
          if (
            result.status === "rejected" &&
            result.reason === "unavailable" &&
            current() &&
            createPairReader
          ) {
            pairReader ??= createPairReader();
            result = await pairReader.read(input, current);
          }
          if (result.status !== "ready") {
            target.quarantined = result.status === "unknown";
            return response(
              requestId,
              result.status === "unknown" ? "unknown" : "rejected"
            );
          }
          target.result = result;
          if (!current() || !result.current()) {
            const freed = await release(target);
            if (
              freed.status === "finished" &&
              slot === target &&
              !target.finishing
            )
              slot = undefined;
            return response(
              requestId,
              freed.status === "finished" ? "rejected" : "unknown"
            );
          }
          if ("tabs" in result)
            return {
              protocolVersion: 1,
              requestId,
              status: "pair",
              activeIndex: result.activeIndex,
            };
          return {
            protocolVersion: 1,
            requestId,
            status: "ready",
            snapshot: result.snapshot,
            mode: result.mode,
            pinned: result.pinned,
          };
        } catch {
          target.quarantined = true;
          return response(requestId, "unknown");
        } finally {
          if (
            slot === target &&
            !target.result &&
            !target.finishing &&
            !target.quarantined
          )
            slot = undefined;
        }
      })();
      return target.opening;
    },
  };
}
