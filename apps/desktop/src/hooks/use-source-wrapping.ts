import { useEffect, useSyncExternalStore } from "react";

import { createSourceWrappingPreference } from "@/client/source-wrapping-store";
import { electrobun } from "@/lib/electrobun";

const unavailable = () => Promise.reject(Error("RPC_UNAVAILABLE"));
const preference = createSourceWrappingPreference({
  load: () =>
    electrobun.rpc?.request.getSourceWrapping({}, { maxRequestTime: 4000 }) ??
    unavailable(),
  save: (enabled) =>
    electrobun.rpc?.request.setSourceWrapping(
      { enabled },
      { maxRequestTime: 4000 }
    ) ?? unavailable(),
});
let loaded = false;
export function useSourceWrapping() {
  const state = useSyncExternalStore(
    preference.subscribe,
    preference.getSnapshot
  );
  useEffect(() => {
    if (!loaded) {
      loaded = true;
      void preference.load();
    }
  }, []);
  return { ...state, change: preference.change, retry: preference.load };
}
