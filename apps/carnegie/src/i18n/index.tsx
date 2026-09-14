import React from "react";
import { createContext, useContext, type ReactNode } from "react";
import { en, type Translations } from "./en.js";
import { ko } from "./ko.js";

export type Locale = "en" | "ko";

const locales: Record<Locale, Translations> = { en, ko };

const TranslationsContext = createContext<Translations>(en);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <TranslationsContext.Provider value={locales[locale]}>{children}</TranslationsContext.Provider>;
}

export function useT(): Translations {
  return useContext(TranslationsContext);
}
