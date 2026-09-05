import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export type ThemePreference = "system" | "light" | "dark";
export type LocalePreference = "en" | "ko";

interface Preferences {
  theme: ThemePreference;
  locale: LocalePreference;
}

const defaults: Preferences = { theme: "system", locale: "en" };

function preferencesPath(): string {
  return join(app.getPath("userData"), "preferences.json");
}

export function loadPreferences(): Preferences {
  const path = preferencesPath();
  if (!existsSync(path)) return defaults;
  return { ...defaults, ...(JSON.parse(readFileSync(path, "utf8")) as Partial<Preferences>) };
}

export function savePreferences(preferences: Preferences): void {
  writeFileSync(preferencesPath(), JSON.stringify(preferences));
}
