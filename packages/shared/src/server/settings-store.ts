import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const queues = new Map<string, Promise<unknown>>();

export type PersistedSettings<T> =
  | { status: "valid"; data: T; format: "legacy" | "version1" }
  | { status: "missing" | "corrupt" | "future" | "too-large" | "io" };

/** Called only after JSON.parse validated syntax. Detect duplicates before projection. */
function duplicateObjectKey(source: string): boolean {
  const objects: Set<string>[] = [];
  const tokens = /"(?:[^"\\]|\\.)*"|[{}]/g;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    if (token === "{") objects.push(new Set());
    else if (token === "}") objects.pop();
    else {
      let next = match.index + token.length;
      while (/\s/.test(source[next] ?? "") && next < source.length) next++;
      if (source[next] !== ":") continue;
      const keys = objects[objects.length - 1];
      const key: unknown = JSON.parse(token);
      if (typeof key !== "string" || !keys) return true;
      if (keys.has(key)) return true;
      keys.add(key);
    }
  }
  return false;
}

export function isSettingsObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One process owns settings. Readers and writers serialize by absolute path. */
export function createSettingsStore<T>(
  path: string,
  normalize: (value: unknown) => T,
  options?: { maxBytes: number; validateData: (value: unknown) => boolean }
) {
  if (
    options &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)
  )
    throw Error("SETTINGS_INVALID_LIMIT");
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
      if (options) {
        const file = await open(
          statePath,
          constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW
        );
        try {
          if (!(await file.stat()).isFile()) throw Error("SETTINGS_CORRUPT");
          const buffer = Buffer.alloc(options.maxBytes + 1);
          let length = 0;
          while (length < buffer.length) {
            const next = await file.read(
              buffer,
              length,
              buffer.length - length,
              null
            );
            if (!next.bytesRead) break;
            length += next.bytesRead;
          }
          if (length > options.maxBytes) throw Error("SETTINGS_TOO_LARGE");
          try {
            original = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(buffer.subarray(0, length));
          } catch {
            throw Error("SETTINGS_CORRUPT");
          }
        } finally {
          await file.close();
        }
      } else original = await readFile(statePath, "utf8");
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
    let valid = versioned
      ? !unsupported && isSettingsObject(object.data)
      : object !== undefined;
    if (options && original !== undefined && parsed !== undefined && duplicateObjectKey(original)) valid = false;
    if (
      valid &&
      options &&
      (!options.validateData(versioned ? object?.data : object) ||
        (versioned && Object.keys(object).sort().join() !== "data,version"))
    )
      valid = false;
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
    if (options && !options.validateData(data)) throw Error("SETTINGS_CORRUPT");
    const contents = `${JSON.stringify({ version: 1, data }, null, 2)}\n`;
    if (
      options &&
      (!options.validateData(data) ||
        Buffer.byteLength(contents) > options.maxBytes)
    )
      throw Error("SETTINGS_CORRUPT");
    if (contents === original) return;
    await mkdir(dirname(statePath), { recursive: true });
    // A failed backup never replaces the authoritative file. Keep exact old bytes.
    if (original !== undefined) await atomicWrite(`${statePath}.bak`, original);
    await atomicWrite(statePath, contents);
  };

  const readPersisted = async (): Promise<PersistedSettings<T>> => {
    try {
      const value = await inspect();
      if (value.original === undefined) return { status: "missing" };
      if (value.unsupported) return { status: "future" };
      if (!value.valid) return { status: "corrupt" };
      return { status: "valid", data: value.data, format: value.legacy ? "legacy" : "version1" };
    } catch (error) {
      return { status: error instanceof Error && error.message === "SETTINGS_TOO_LARGE" ? "too-large" : error instanceof Error && error.message === "SETTINGS_CORRUPT" ? "corrupt" : "io" };
    }
  };

  return {
    /** No migration, backup or write. Same-path ordering is retained. */
    readPersisted: () => enqueue(readPersisted),
    /** One bounded write and observation, including a write that threw after rename. */
    updateObserved: (update: (state: T, format: "missing" | "legacy" | "version1") => T) => enqueue(async () => {
      let before: T, expected: T;
      let beforeFormat: "missing" | "legacy" | "version1";
      let confirmed = false;
      try {
        const state = await inspect();
        if (state.unsupported || (state.original !== undefined && !state.valid))
          return { attempted: false as const };
        before = state.data;
        beforeFormat = state.original === undefined ? "missing" : state.legacy ? "legacy" : "version1";
        expected = update(before, beforeFormat);
        if (options && !options.validateData(expected)) return { attempted: false as const };
        // No nested public enqueue: the complete operation owns this queue turn.
        try { await commit(expected, state.original); confirmed = true; }
        catch { /* The post-write observation decides; rejection alone is not proof. */ }
      } catch { return { attempted: false as const }; }
      return { attempted: true as const, before, beforeFormat, expected, confirmed, persisted: confirmed ? { status: "valid" as const, data: expected, format: "version1" as const } : await readPersisted() };
    }),
    inspectState: () =>
      enqueue(
        async (): Promise<
          | { available: true; data: T }
          | {
              available: false;
              reason: "future" | "corrupt" | "too-large" | "io";
            }
        > => {
          try {
            const state = await inspect();
            if (state.unsupported)
              return { available: false, reason: "future" };
            if (state.original !== undefined && !state.valid)
              return { available: false, reason: "corrupt" };
            if (state.legacy || state.original === undefined)
              await commit(state.data, state.original);
            return { available: true, data: state.data };
          } catch (error) {
            return {
              available: false,
              reason:
                error instanceof Error && error.message === "SETTINGS_TOO_LARGE"
                  ? "too-large"
                  : error instanceof Error &&
                      error.message === "SETTINGS_CORRUPT"
                    ? "corrupt"
                    : "io",
            };
          }
        }
      ),
    load: () =>
      enqueue(async () => {
        const state = await inspect();
        if (options && state.unsupported)
          throw Error("SETTINGS_VERSION_UNSUPPORTED");
        if (options && state.original !== undefined && !state.valid)
          throw Error("SETTINGS_CORRUPT");
        if (state.legacy || state.original === undefined) {
          // Migration is opportunistic: readable preferences remain usable on
          // a read-only disk. Explicit updates still report persistence failure.
          if (options) await commit(state.data, state.original);
          else await commit(state.data, state.original).catch(() => undefined);
        }
        return state.data;
      }),
    update: (update: (state: T) => T) =>
      enqueue(async () => {
        const state = await inspect();
        if (state.unsupported) throw new Error("SETTINGS_VERSION_UNSUPPORTED");
        if (state.original !== undefined && !state.valid)
          throw new Error("SETTINGS_CORRUPT");
        const next = update(state.data);
        if (options && !options.validateData(next))
          throw Error("SETTINGS_CORRUPT");
        await commit(normalize(next), state.original);
      }),
  };
}
