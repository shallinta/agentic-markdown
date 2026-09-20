import { DEFAULT_LOCALE, type SupportedLocale } from "@/shared/i18n";

/** Compatibility hook: the app always uses Simplified Chinese. */
export function useLocale(): {
  locale: SupportedLocale;
  isSaving: boolean;
  change: (locale: SupportedLocale) => Promise<void>;
} {
  return {
    locale: DEFAULT_LOCALE,
    isSaving: false,
    change: () => Promise.resolve(),
  };
}
