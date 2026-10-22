import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { buildChips, type QueueChip, type QueueFilters } from "@/lib/inspections/queueView";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/** What a chip says. A floor in a multi-building hotel names its building. */
export function chipLabel(chip: QueueChip, multiBuilding: boolean, t: Translate): string {
  switch (chip.kind) {
    case "priority":
      return t(`inspect.filter.priority.${chip.key}`);
    case "review":
      return t(`inspect.filter.review.${chip.key}`);
    case "clean":
      return t(`inspect.filter.clean.${chip.key}`);
    case "floor": {
      const level = chip.floor === null ? t("inspect.filter.floorUnknown") : t("inspect.filter.floor", { floor: chip.floor });
      return multiBuilding
        ? t("inspect.filter.buildingFloor", { building: chip.building ?? t("inspect.filter.buildingNone"), floor: chip.floor ?? "—" })
        : level;
    }
  }
}

/** The applied filters as removable chips, plus an honest "Showing X of Y" from the same snapshot as the list. */
export function InspectActiveFilters({
  filters,
  shown,
  total,
  multiBuilding,
  ignored,
  t,
  onRemove,
  onClearAll,
}: {
  filters: QueueFilters;
  shown: number;
  total: number;
  multiBuilding: boolean;
  /** Applied filters that cannot be honoured because their data is gone. */
  ignored: boolean;
  t: Translate;
  onRemove: (chip: QueueChip) => void;
  onClearAll: () => void;
}) {
  const theme = useTheme();
  const chips = buildChips(filters);
  if (chips.length === 0) return null;
  return (
    <View style={styles.wrap} testID="inspect-active-filters">
      <View style={styles.countRow}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textSecondary }]} accessibilityLiveRegion="polite" testID="inspect-result-count">
          {t(total === 1 ? "inspect.chips.showingOne" : "inspect.chips.showing", { shown, total })}
        </Text>
        <Pressable onPress={onClearAll} accessibilityRole="button" accessibilityLabel={t("inspect.chips.clearAll")} style={styles.clearAll} hitSlop={6} testID="inspect-clear-filters">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.clearAllText, { color: theme.primaryAction }]}>
            {t("inspect.chips.clearAll")}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {chips.map((chip) => {
          const label = chipLabel(chip, multiBuilding, t);
          return (
            <Pressable
              key={chip.id}
              onPress={() => onRemove(chip)}
              accessibilityRole="button"
              accessibilityLabel={t("inspect.chips.remove", { label })}
              testID={`inspect-chip-${chip.id}`}
              style={({ pressed }) => [styles.chip, { backgroundColor: theme.surface, borderColor: theme.primaryAction }, pressed && { opacity: 0.8 }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
                {label}
              </Text>
              <Ionicons name="close" size={14} color={theme.textMuted} />
            </Pressable>
          );
        })}
      </ScrollView>
      {ignored ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notice, { color: theme.textMuted }]} testID="inspect-filter-ignored">
          {t("inspect.chips.ignored")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: 8, gap: 6 },
  countRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16 },
  count: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
  clearAll: { minHeight: 44, minWidth: 48, justifyContent: "center", alignItems: "flex-end" },
  clearAllText: { fontSize: 13.5, fontWeight: "800" },
  chips: { paddingHorizontal: 16, gap: 8 },
  chip: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, borderWidth: 1.5, borderRadius: 999 },
  chipText: { fontSize: 13.5, fontWeight: "700" },
  notice: { paddingHorizontal: 16, fontSize: 12 },
});
