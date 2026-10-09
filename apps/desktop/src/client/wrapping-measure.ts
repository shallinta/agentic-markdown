/** CM measure.write still runs in its Updating phase. Dispatch only afterwards. */
export function deferWrappingUpdate<T>(
  measuredState: T,
  callbacks: {
    current(): boolean;
    state(): T;
    remeasure(): void;
    apply(): void;
  }
) {
  queueMicrotask(() => {
    if (!callbacks.current()) return;
    if (callbacks.state() !== measuredState) {
      callbacks.remeasure();
      return;
    }
    callbacks.apply();
  });
}
