import { createContext, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import type { ThemeMode } from "@/components/shared/tokens";

type ThemeModeContextValue = { mode: ThemeMode };

const ThemeModeContext = createContext<ThemeModeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read the OS scheme now so Phase 10 can switch to it with no structural change.
  const _systemScheme = useColorScheme();
  // Phase 7 is light-only-active (THEME-01); Phase 10 will switch to the OS scheme.
  const mode: ThemeMode = "light";

  const value = useMemo(() => ({ mode }), [mode]);

  return (
    <ThemeModeContext.Provider value={value}>
      {children}
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeMode {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) {
    throw new Error("useThemeMode must be used within a ThemeProvider");
  }
  return ctx.mode;
}
