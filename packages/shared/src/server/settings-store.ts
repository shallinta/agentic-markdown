import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const queues = new Map<string, Promise<unknown>>();

export function isSettingsObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One process owns settings. Readers and writers serialize by absolute path. */
export function createSettingsStore<T>(
  path: string,
  normalize: (value: unknown) => T
) {
  const statePath = resolve(path);
  const enqueue = <R>(operation: () => Promise<R>): Promise<R> => {
    const pending = (queues.get(statePath) ?? Promise.resolve())
      .catch(() => undefined)
      .then(operation);
    queues.set(statePath, pending);
    void pending
      .finally(() => {
        if (queues.get(statePath) === pending) queues.delete(statePath);
      })
      .catch(() => undefined);
    return pending;
  };

  const inspect = async () => {
    let original: string | undefined;
    try {
      original = await readFile(statePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    let parsed: unknown;
    try {
      parsed = original === undefined ? undefined : JSON.parse(original);
    } catch {
      /* Preserve malformed source. */
    }
    const object = isSettingsObject(parsed) ? parsed : undefined;
    const versioned =
      object !== undefined &&
      Object.prototype.hasOwnProperty.call(object, "version");
    const unsupported = versioned && object.version !== 1;
    const valid = versioned
      ? !unsupported && isSettingsObject(object.data)
      : object !== undefined;
    return {
      original,
      unsupported,
      legacy: !versioned && valid,
      valid,
      data: normalize(valid ? (versioned ? object?.data : object) : undefined),
    };
  };

  const atomicWrite = async (destination: string, contents: string) => {
    const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(contents, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true });
    }
  };

  const commit = async (data: T, original: string | undefined) => {
    const contents = `${JSON.stringify({ version: 1, data }, null, 2)}\n`;
    if (contents === original) return;
    await mkdir(dirname(statePath), { recursive: true });
    // A failed backup never replaces the authoritative file. Keep exact old bytes.
    if (original !== undefined) await atomicWrite(`${statePath}.bak`, original);
    await atomicWrite(statePath, contents);
  };

  return {
    load: () =>
      enqueue(async () => {
        const state = await inspect();
        if (state.legacy || state.original === undefined) {
          // Migration is opportunistic: readable preferences remain usable on
          // a read-only disk. Explicit updates still report persistence failure.
          await commit(state.data, state.original).catch(() => undefined);
        }
        return state.data;
      }),
    update: (update: (state: T) => T) =>
      enqueue(async () => {
        const state = await inspect();
        if (state.unsupported) throw new Error("SETTINGS_VERSION_UNSUPPORTED");
        if (state.original !== undefined && !state.valid)
          throw new Error("SETTINGS_CORRUPT");
        await commit(normalize(update(state.data)), state.original);
      }),
  };
}
