import glyphs from "@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json";
import { darkThemeV2, lightThemeV2, touchV2 } from "@/components/shared/tokensV2";
import type { ThemeTokens } from "@/components/shared/tokens";
import { contrastRatio } from "@/__tests__/helpers/contrast";
import { getTabsForRole } from "@/lib/navigation/roleTabs";
import {
  CROWDED_TAB_COUNT,
  NAV_ACTIVE_V2,
  TAB_BAR_CONTENT_HEIGHT,
  buildTabScreenOptionsV2,
  getTabIconV2,
  tabBarMetricsV2,
} from "@/lib/navigation/tabChromeV2";
import type { UserRole } from "@/lib/supabase";

const ROLES: UserRole[] = [
  "housekeeper",
  "inspector",
  "engineer",
  "chief_engineer",
  "housekeeping_supervisor",
  "front_desk",
  "gm",
];

describe("V2 tab icons", () => {
  it("are distinct within every role's bar (Home no longer shares Room Board's glyph)", () => {
    for (const role of ROLES) {
      const icons = getTabsForRole(role).map((tab) => getTabIconV2(tab, false));
      expect(new Set(icons).size).toBe(icons.length);
    }
  });

  it("exist in the Ionicons set in both idle and focused form", () => {
    const names = new Set(Object.keys(glyphs));
    for (const role of ROLES) {
      for (const tab of getTabsForRole(role)) {
        expect(names.has(getTabIconV2(tab, false))).toBe(true);
        expect(names.has(getTabIconV2(tab, true))).toBe(true);
      }
    }
  });

  it("fills the glyph when focused", () => {
    expect(getTabIconV2({ key: "home" }, false)).toBe("home-outline");
    expect(getTabIconV2({ key: "home" }, true)).toBe("home");
  });

  it("does not change which destinations a role has (route redesign is out of scope)", () => {
    expect(getTabsForRole("front_desk")).toHaveLength(6);
    expect(getTabsForRole("housekeeping_supervisor").map((t) => t.key)).toEqual([
      "home",
      "board",
      "assignments",
      "inspect",
      "me",
    ]);
  });
});

describe("V2 tab bar metrics", () => {
  it("adds the device inset on top of a compact bar and never goes below the minimum pad", () => {
    expect(tabBarMetricsV2(0).height).toBe(TAB_BAR_CONTENT_HEIGHT + 8);
    expect(tabBarMetricsV2(34)).toMatchObject({ height: TAB_BAR_CONTENT_HEIGHT + 34, paddingBottom: 34 });
  });

  it("is shorter than the legacy fixed 76 on a phone without a home indicator", () => {
    expect(tabBarMetricsV2(0).height).toBeLessThan(76);
  });

  it("leaves the item area tall enough for a 30dp pill plus a label (no clipped labels)", () => {
    const m = tabBarMetricsV2(0);
    expect(m.height - m.paddingTop - m.paddingBottom).toBeGreaterThanOrEqual(56);
  });

  it("keeps each tab item at the 44pt target", () => {
    const o = buildTabScreenOptionsV2(lightThemeV2 as unknown as ThemeTokens, 0, 5);
    expect(o.tabBarItemStyle.minHeight).toBeGreaterThanOrEqual(touchV2.min);
    expect(TAB_BAR_CONTENT_HEIGHT).toBeGreaterThanOrEqual(touchV2.comfortable);
  });

  it("uses a smaller label only when the bar is crowded", () => {
    const t = lightThemeV2 as unknown as ThemeTokens;
    expect(buildTabScreenOptionsV2(t, 0, 4).tabBarLabelStyle.fontSize).toBe(12);
    expect(buildTabScreenOptionsV2(t, 0, CROWDED_TAB_COUNT).tabBarLabelStyle.fontSize).toBe(11);
    expect(buildTabScreenOptionsV2(t, 0, 6).tabBarLabelStyle.fontSize).toBe(11);
  });
});

describe("V2 tab bar contrast (nav chrome is dark in BOTH modes)", () => {
  for (const [name, theme] of [
    ["light", lightThemeV2],
    ["dark", darkThemeV2],
  ] as const) {
    it(`${name}: active label, inactive label, active pill and badge pass`, () => {
      expect(contrastRatio(NAV_ACTIVE_V2, theme.shell.bg)).toBeGreaterThanOrEqual(4.5);
      // Active label sits on the bar itself; the icon sits on the raised pill.
      expect(contrastRatio(NAV_ACTIVE_V2, theme.shell.raised)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(theme.shell.ink2, theme.shell.bg)).toBeGreaterThanOrEqual(4.5);
      // The pill must be distinguishable from the bar without relying on hue.
      expect(contrastRatio(theme.shell.raised, theme.shell.bg)).toBeGreaterThanOrEqual(1.1);
      const opts = buildTabScreenOptionsV2(theme as unknown as ThemeTokens, 0, 5);
      expect(contrastRatio(opts.tabBarBadgeStyle.color, opts.tabBarBadgeStyle.backgroundColor)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
