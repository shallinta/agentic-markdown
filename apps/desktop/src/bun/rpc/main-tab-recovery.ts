import { PACKAGED_VIEW_URL } from "../../security/shell-policy";
import type { MainTabSourceInput } from "../../shared/main-tab-checkpoint";
import {
  validMainTabRecoveryRequest,
  type MainTabRecoveryResponse,
} from "../../shared/main-tab-recovery";
import type {
  createMainTabGroupRecoveryReader,
  createMainTabMultiRootRecoveryReader,
  MainTabGroupRecoveryResult,
} from "../session/main-tab-group-recovery";
import type { MainTabMetadataObservation } from "../session/main-tab-metadata";
import type {
  createSingleMainTabRecoveryReader,
  SingleMainTabRecoveryResult,
} from "../session/main-tab-single-recovery";

type MultiReader = ReturnType<typeof createMainTabMultiRootRecoveryReader>;
type GroupReader = ReturnType<typeof createMainTabGroupRecoveryReader>;
type Group = Extract<MainTabGroupRecoveryResult, { status: "ready" }>;
type Reader = ReturnType<typeof createSingleMainTabRecoveryReader>;
type Ready = Extract<SingleMainTabRecoveryResult, { status: "ready" }>;
interface Slot {
  id: string;
  epoch: number;
  cancelled: boolean;
  openAbort: AbortController;
  result?: Ready | Group;
  delivered?: number;
  itemPending?: boolean;
  quarantined?: boolean;
  adopted?: boolean;
  claim?: (
    receipt: MainTabMetadataObservation,
    current: () => boolean,
    sources?: readonly MainTabSourceInput[]
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
    current: () => boolean,
    sources?: readonly MainTabSourceInput[]
  ) => Promise<boolean>,
  createGroupReader?: () => GroupReader,
  createMultiReader?: () => MultiReader
) {
  let groupReader: GroupReader | undefined;
  let multiReader: MultiReader | undefined;
  let reader: Reader | undefined, slot: Slot | undefined;
  // Never evict an ID within a page: late RPC dispatch must not revive it.
  const seen = new Set<string>();
  const clean = new Set<string>();
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
    target.openAbort.abort();
    if (target.quarantined) return response(target.id, "unknown");
    const outcome = target.result
      ? await (target.releasing ??= target.result
          .release()
          .catch(() => "unknown" as const))
      : "released";
    return response(target.id, outcome === "released" ? "finished" : "unknown");
  };
  const settleClean = (target: Slot) => {
    if (slot !== target) return;
    clean.add(target.id);
    if (!target.finishing) slot = undefined;
  };
  const retire = () => {
    ready = false;
    epoch++;
    const old = slot;
    slot = undefined;
    if (old && !old.adopted) {
      old.cancelled = true;
      old.openAbort.abort();
      void old.opening.then(() => release(old)).catch(() => undefined);
    }
    const oldReader = reader;
    reader = undefined;
    void oldReader?.close().catch(() => undefined);
    const oldPair = groupReader;
    groupReader = undefined;
    void oldPair?.close().catch(() => undefined);
    const oldMulti = multiReader;
    multiReader = undefined;
    void oldMulti?.close().catch(() => undefined);
    last = undefined;
    seen.clear();
    clean.clear();
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
      if (slot && !slot.adopted) slot.openAbort.abort();
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
      if (input.op === "group-item") {
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
          input.index >= target.result.tabs.length ||
          !available() ||
          target.epoch !== epoch
        )
          return response(requestId, "rejected");
        const result = target.result;
        target.itemPending = true;
        try {
          const valid =
            result.current() &&
            (input.index !== result.tabs.length - 1 ||
              (await result.revalidate()));
          if (
            !valid ||
            !result.current() ||
            (input.index === result.tabs.length - 1 && result.verifyDelivery && !result.verifyDelivery()) ||
            slot !== target ||
            target.cancelled ||
            target.finishing ||
            !available() ||
            target.epoch !== epoch
          ) {
            const freed = await release(target);
            if (freed.status === "finished") settleClean(target);
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
            status: "group-item",
            index: input.index,
            ...item,
          };
        } catch {
          const freed = await release(target);
          if (freed.status === "finished") settleClean(target);
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
        if (clean.has(requestId))
          return response(requestId, input.adopted ? "rejected" : "finished");
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
            clean.add(requestId);
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
              (target.delivered !== target.result.tabs.length ||
                target.itemPending))
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
                    receipt.current(),
                  ("tabs" in receipt ? receipt.tabs : [receipt]).map(item => ({ handle: item.snapshot.handle, documentId: item.snapshot.documentId, revision: item.snapshot.revision, hash: item.snapshot.hash, mode: item.mode, pinned: item.pinned }))
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
        target.openAbort.abort();
        target.finishing = (async () => {
          await target.opening;
          const result = await release(target);
          if (slot === target) {
            if (result.status === "finished") {
              clean.add(requestId);
              slot = undefined;
            }
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
        openAbort: new AbortController(),
        claim: prepareClaim?.(),
        opening: Promise.resolve(response(requestId, "rejected")),
      };
      slot = target;
      target.opening = (async () => {
        try {
          const current = () =>
            slot === target &&
            !target.cancelled &&
            target.epoch === epoch &&
            available();
          let result: SingleMainTabRecoveryResult | MainTabGroupRecoveryResult;
          if (input.op === "open-multi") {
            if (!createMultiReader) return response(requestId, "rejected");
            multiReader ??= createMultiReader();
            result = await multiReader.read(input, current, target.openAbort.signal);
          } else {
            reader ??= createReader();
            result = await reader.read(
              input,
              current,
              target.openAbort.signal
            );
            if (
              result.status === "rejected" &&
              result.reason === "unavailable" &&
              current() &&
              createGroupReader
            ) {
              groupReader ??= createGroupReader();
              result = await groupReader.read(input, current, target.openAbort.signal);
            }
          }
          if (result.status !== "ready") {
            target.quarantined = result.status === "unknown";
            return response(
              requestId,
              result.status === "unknown" ? "unknown" : "rejected"
            );
          }
          target.result = result;
          if (
            !current() ||
            !result.current() ||
            (!("tabs" in result) && result.verifyDelivery && !result.verifyDelivery())
          ) {
            const freed = await release(target);
            if (freed.status === "finished") settleClean(target);
            return response(
              requestId,
              freed.status === "finished" ? "rejected" : "unknown"
            );
          }
          if ("tabs" in result)
            return {
              protocolVersion: 1,
              requestId,
              status: "group",
              count: result.tabs.length,
              activeIndex: result.activeIndex,
            };
          return {
            protocolVersion: 1,
            requestId,
            status: "ready",
            snapshot: result.snapshot,
            mode: result.mode,
            pinned: result.pinned,
            ...(result.viewport ? { viewport: result.viewport } : {}),
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
            settleClean(target);
        }
      })();
      return target.opening;
    },
  };
}
