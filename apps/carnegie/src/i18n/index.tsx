import { createContext, useContext, type ReactNode } from "react";
import { en, type Translations } from "./en.js";

export type Locale = "en";

// ponytail: only "en" exists today; add a "ko.ts" satisfying `Translations` and register it here when Korean is built.
const locales: Record<Locale, Translations> = { en };

const TranslationsContext = createContext<Translations>(en);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <TranslationsContext.Provider value={locales[locale]}>{children}</TranslationsContext.Provider>;
}

export function useT(): Translations {
  return useContext(TranslationsContext);
}
