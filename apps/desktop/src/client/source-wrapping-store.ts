import { isSourceWrappingResponse } from "../shared/source-wrapping";

export function createSourceWrappingPreference(transport: {
  load(): Promise<unknown>;
  save(enabled: boolean): Promise<unknown>;
}) {
  let snapshot = {
    enabled: true,
    isSaving: false,
    error: null as string | null,
  };
  let revision = 0;
  let loading: Promise<void> | undefined;
  const listeners = new Set<() => void>();
  const publish = (next: typeof snapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  const read = (response: unknown) => {
    if (!isSourceWrappingResponse(response) || !response.ok)
      throw Error("SETTINGS_UNAVAILABLE");
    return response.enabled;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(this: void, listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load(this: void) {
      if (snapshot.isSaving) return Promise.resolve();
      if (loading) return loading;
      const generation = revision;
      loading = (async () => {
        try {
          const enabled = read(await transport.load());
          if (generation === revision)
            publish({ ...snapshot, enabled, error: null });
        } catch {
          if (generation === revision)
            publish({ ...snapshot, error: "无法读取源码换行设置，请重试。" });
        } finally {
          loading = undefined;
        }
      })();
      return loading;
    },
    async change(this: void, enabled: boolean) {
      if (typeof enabled !== "boolean" || snapshot.isSaving) return false;
      revision++;
      publish({ ...snapshot, isSaving: true, error: null });
      try {
        if (read(await transport.save(enabled)) !== enabled)
          throw Error("MISMATCH");
        publish({ enabled, isSaving: false, error: null });
        return true;
      } catch {
        publish({
          ...snapshot,
          isSaving: false,
          error: "源码换行设置保存未确认，请重试。",
        });
        return false;
      }
    },
  };
}
