import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";

export type DetailTab = "overview" | "checklist" | "work" | "history";

export const DETAIL_TABS: readonly DetailTab[] = ["overview", "checklist", "work", "history"];

interface Props {
  value: DetailTab;
  onChange: (tab: DetailTab) => void;
}

/** Segmented navigation inside the detail screen. The selected tab is announced by state, not only by colour. */
export function WorkOrderTabs({ value, onChange }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]} testID="wo-tabs">
      {DETAIL_TABS.map((tab) => {
        const selected = tab === value;
        return (
          <Pressable
            key={tab}
            onPress={() => onChange(tab)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`workOrders.repair.tabs.${tab}`)}
            testID={`wo-tab-${tab}`}
            style={[styles.tab, selected && { backgroundColor: theme.primaryAction }]}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              numberOfLines={1}
              adjustsFontSizeToFit
              style={{ color: selected ? theme.onPrimary : theme.textSecondary, fontSize: 13.5, fontWeight: selected ? "800" : "600" }}
            >
              {t(`workOrders.repair.tabs.${tab}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", borderWidth: 1, borderRadius: R.lg, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: 44, borderRadius: R.md, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
});
