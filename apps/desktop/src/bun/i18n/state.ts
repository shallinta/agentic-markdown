import { join } from "node:path";

import { createSettingsStore } from "@agentic-markdown/shared/server";

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
  // The current product is Chinese-only, including legacy English preferences.
  const store = createSettingsStore(join(settingsDir, "locale.json"), () => ({
    locale: DEFAULT_LOCALE,
  }));
  return {
    getLocale: async () => (await store.load()).locale,
    setLocale: () => store.update(() => ({ locale: DEFAULT_LOCALE })),
  };
}
