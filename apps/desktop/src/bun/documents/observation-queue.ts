/** Bounded set of subscriptions and one probe at a time; hints never add jobs. */
export function createObservationQueue(run: (key: string) => Promise<void>, canRun: () => boolean) {
  const watched = new Set<string>();
  const dirty = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false, disposed = false;
  const schedule = () => {
    if (disposed || running || timer || !dirty.size) return;
    timer = setTimeout(() => { timer = undefined; void drain(); }, 60);
  };
  async function drain() {
    if (disposed || running) return;
    if (!canRun()) { schedule(); return; }
    const key = dirty.values().next().value;
    if (!key) return;
    dirty.delete(key); running = true;
    try { if (watched.has(key)) await run(key); } finally { running = false; schedule(); }
  }
  return {
    add(key: string) { watched.add(key); dirty.add(key); schedule(); },
    hint(key: string) { if (watched.has(key)) { dirty.add(key); schedule(); } },
    remove(key: string) { watched.delete(key); dirty.delete(key); },
    dispose() { disposed = true; clearTimeout(timer); dirty.clear(); watched.clear(); },
    size: () => ({ subscriptions: watched.size, pending: dirty.size, running }),
  };
}
