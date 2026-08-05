import {
  DefaultTheme,
  type Theme as ReactNavigationTheme,
} from "expo-router/react-navigation";
import {
  getThemeTokens,
  type ThemeMode,
} from "@/components/shared/tokens";

export function getNavigationTheme(
  mode: ThemeMode,
): ReactNavigationTheme {
  const tokens = getThemeTokens(mode);

  return {
    dark: mode === "dark",
    colors: {
      primary: tokens.primary,
      background: tokens.background,
      card: tokens.shell.surface,
      text: tokens.shell.ink,
      border: tokens.shell.line,
      notification: tokens.status.dirty,
    },
    fonts: DefaultTheme.fonts,
  };
}
