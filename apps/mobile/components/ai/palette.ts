import { darkTheme, type getThemeTokens } from "@/components/shared/tokens";
import { createContext, useContext } from "react";

/** The colours an assistant surface draws with. */
export type Palette = ReturnType<typeof getThemeTokens>;

/**
 * The legacy assistant stays dark (design decision D-11). The compact sheet supplies its scoped
 * palette to nested controls; explicit overrides win.
 */
export const AssistantPaletteContext = createContext<Palette | undefined>(undefined);

export function usePalette(override?: Palette): Palette {
  const scoped = useContext(AssistantPaletteContext);
  return override ?? scoped ?? darkTheme;
}
