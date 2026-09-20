import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  type SupportedLocale,
} from "../../shared/i18n";

import type { LocaleStateStore } from "./state";

export interface LocaleControllerDependencies {
  store: LocaleStateStore;
  activateLocale: (locale: SupportedLocale) => Promise<void>;
  onLocaleChanged: (locale: SupportedLocale) => void;
}
export interface LocaleController {
  initialize(): Promise<void>;
  getLocale(): SupportedLocale;
  setLocale(locale: SupportedLocale): Promise<void>;
}
export function createLocaleController(
  dependencies: LocaleControllerDependencies
): LocaleController {
  return {
    async initialize() {
      // Migrate inherited preferences without letting them choose the UI language.
      await dependencies.store.getLocale();
      await dependencies.activateLocale(DEFAULT_LOCALE);
    },
    getLocale: () => DEFAULT_LOCALE,
    setLocale(locale) {
      if (!isSupportedLocale(locale))
        return Promise.reject(new Error("不支持的界面语言"));
      // Compatibility RPC only; language switching is not a product capability.
      return Promise.resolve();
    },
  };
}
