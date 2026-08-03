/* =============================================================================
 *  OWNED BY:  InsightMetrics (JQ)
 *  PART OF:   MusterGo base — shared app-wide light/dark theme
 * ============================================================================= */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

/**
 * App-wide light/dark theme. Applies data-theme="dark" to <html>, which
 * tokens.css uses to override the neutral/surface CSS variables everything
 * (.card, .btn, .input, the sidebar, etc.) is already built on — so toggling
 * here re-themes every page with no per-page changes needed. Independent of
 * TripsListPage's own scoped .tf-dark theme (that one only affects the Trips
 * feature's own .tf-* tokens and is left untouched).
 */
const THEME_KEY = "mg_theme";

const ThemeContext = createContext({ theme: "light", toggleTheme: () => {} });

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || "light"; } catch { return "light"; }
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = cur === "light" ? "dark" : "light";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}
