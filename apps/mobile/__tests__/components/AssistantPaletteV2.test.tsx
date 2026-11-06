import { renderHook } from "@testing-library/react-native";
import { AssistantPaletteContext, usePalette } from "@/components/ai/palette";
import { darkTheme, lightTheme } from "@/components/shared/tokens";

describe("assistant palette isolation", () => {
  it("keeps the legacy dark palette outside V2", () => {
    expect(renderHook(() => usePalette()).result.current).toBe(darkTheme);
  });

  it("uses the scoped theme in V2", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <AssistantPaletteContext.Provider value={lightTheme}>{children}</AssistantPaletteContext.Provider>;
    expect(renderHook(() => usePalette(), { wrapper }).result.current).toBe(lightTheme);
  });

  it("honors explicit palette overrides", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => <AssistantPaletteContext.Provider value={lightTheme}>{children}</AssistantPaletteContext.Provider>;
    expect(renderHook(() => usePalette(darkTheme), { wrapper }).result.current).toBe(darkTheme);
  });
});
