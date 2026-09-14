import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ThemePreference } from "../electron/preferences.js";

interface ThemeContextValue {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ theme: "system", setTheme: () => {} });

function applyThemeAttribute(theme: ThemePreference): void {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");

  useEffect(() => {
    void window.maestro.preferences.get().then((preferences) => {
      setThemeState(preferences.theme);
      applyThemeAttribute(preferences.theme);
    });
  }, []);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    applyThemeAttribute(next);
    void window.maestro.preferences.get().then((preferences) => window.maestro.preferences.save({ ...preferences, theme: next }));
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
