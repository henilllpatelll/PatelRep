import { darkTheme, type getThemeTokens } from "@/components/shared/tokens";

/** The colours an assistant surface draws with. */
export type Palette = ReturnType<typeof getThemeTokens>;

/**
 * Assistant content is deliberately always dark, like the rest of the Copilot (protected design decision D-11,
 * see ThemeSourceAudit): a fixed, recognisable surface that does not follow the light/dark switch. Callers may pin
 * a different palette, but none does today.
 */
export function usePalette(override?: Palette): Palette {
  return override ?? darkTheme;
}
