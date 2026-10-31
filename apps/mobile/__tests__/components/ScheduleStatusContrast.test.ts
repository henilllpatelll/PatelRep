import { getThemeTokens } from "@/components/shared/tokens";
import { STATUS_PRESENTATION, type StatusTone } from "@/lib/scheduling/teamScheduleText";
import { compositedContrastRatio, contrastRatio } from "../helpers/contrast";

/* Status pills are 12px bold text on a tinted pill, so the WCAG AA text bar (4.5:1) applies in light AND dark mode.
   The same pairs are what ScheduleStatusBadge / useToneColors draws. */

const TONES = Array.from(new Set(Object.values(STATUS_PRESENTATION).map((entry) => entry.tone))) as StatusTone[];

describe.each(["light", "dark"] as const)("status badge colours in %s mode", (mode) => {
  const theme = getThemeTokens(mode);

  it.each(TONES)("%s text is readable on its pill, which sits on a card", (tone) => {
    if (tone === "neutral") {
      expect(contrastRatio(theme.textSecondary, theme.surfaceMuted)).toBeGreaterThanOrEqual(4.5);
      return;
    }
    const fg = theme.status[tone];
    const soft = theme.status[`${tone}Soft` as const];
    expect(compositedContrastRatio(fg, soft, theme.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("body copy used on the screen is readable on the page and on cards", () => {
    for (const color of [theme.textPrimary, theme.textSecondary]) {
      expect(contrastRatio(color, theme.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color, theme.surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the selected day / segment (onPrimary on primaryAction) is readable", () => {
    expect(contrastRatio(theme.onPrimary, theme.primaryAction)).toBeGreaterThanOrEqual(4.5);
  });

  it("the caution banner text (textPrimary on pickupSoft) is readable", () => {
    expect(compositedContrastRatio(theme.textPrimary, theme.status.pickupSoft, theme.surface)).toBeGreaterThanOrEqual(4.5);
  });
});
