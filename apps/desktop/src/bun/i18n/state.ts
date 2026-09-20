import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { SupportedLocale } from "../../shared/i18n";
import { DEFAULT_LOCALE } from "../../shared/i18n";

export interface LocaleStateStore {
  getLocale(): Promise<SupportedLocale>;
  setLocale(locale: SupportedLocale): Promise<void>;
}

export function createLocaleStateStore(
  settingsDir: string,
  _getSystemLocale: () => string | undefined
): LocaleStateStore {
  void _getSystemLocale;
  const statePath = join(settingsDir, "locale.json");
  let mutationQueue: Promise<void> = Promise.resolve();

  const write = async (_locale: SupportedLocale): Promise<void> => {
    void _locale;
    const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(settingsDir, { recursive: true });
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ locale: DEFAULT_LOCALE }, null, 2)}\n`,
        "utf8"
      );
      await rename(temporaryPath, statePath);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  };

  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const queued = mutationQueue.then(operation);
    mutationQueue = queued.then(
      () => undefined,
      () => undefined
    );
    return queued;
  };

  const load = (): Promise<SupportedLocale> =>
    enqueue(async () => {
      let locale: unknown;
      try {
        const state = JSON.parse(await readFile(statePath, "utf8")) as unknown;
        locale =
          typeof state === "object" && state !== null && !Array.isArray(state)
            ? (state as { locale?: unknown }).locale
            : undefined;
      } catch (error) {
        if (
          !(error instanceof SyntaxError) &&
          (error as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          throw error;
        }
      }
      if (locale === DEFAULT_LOCALE) return DEFAULT_LOCALE;
      const initialLocale = DEFAULT_LOCALE;
      await write(initialLocale);
      return initialLocale;
    });

  return {
    getLocale: load,
    setLocale: (locale) => enqueue(() => write(locale)),
  };
}
