import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

export type InspectTab = "queue" | "corrections" | "done";
export const INSPECT_TABS: readonly InspectTab[] = ["queue", "corrections", "done"];

/** Segmented control. A count is shown only when it is known; selection is a filled style AND the selected state. */
export function InspectTabs({
  selected,
  counts,
  t,
  onSelect,
}: {
  selected: InspectTab;
  /** null = unknown (loading / failed): nothing is shown instead of a false 0. */
  counts: Record<InspectTab, number | null>;
  t: Translate;
  onSelect: (tab: InspectTab) => void;
}) {
  const theme = useTheme();
  return (
    <View style={[styles.track, { backgroundColor: theme.surfaceMuted }]} accessibilityRole="tablist" accessibilityLabel={t("inspect.tabs.label")} testID="inspect-tabs">
      {INSPECT_TABS.map((tab) => {
        const active = tab === selected;
        const label = t(`inspect.tabs.${tab}`);
        const count = counts[tab];
        return (
          <Pressable
            key={tab}
            onPress={() => onSelect(tab)}
            accessibilityRole="tab"
            accessibilityLabel={count === null ? t("inspect.tabs.a11yUnknown", { label }) : t("inspect.tabs.a11y", { label, count })}
            accessibilityState={{ selected: active }}
            testID={`inspect-tab-${tab}`}
            style={({ pressed }) => [
              styles.tab,
              active && { backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.label, { color: active ? theme.textPrimary : theme.textMuted }]}>
              {label}
            </Text>
            {count !== null ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: active ? theme.primaryAction : theme.textMuted }]}>
                {count}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", marginHorizontal: 16, marginTop: 4, borderRadius: R.md, padding: 3, gap: 3 },
  tab: {
    flex: 1,
    minHeight: MIN_TARGET,
    borderRadius: R.md - 3,
    paddingHorizontal: 4,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "transparent",
  },
  // Labels wrap rather than truncate: "Correcciones" and large text must stay readable in full.
  label: { fontSize: 13, fontWeight: "700", flexShrink: 1, textAlign: "center" },
  count: { fontSize: 13, fontWeight: "800" },
});
