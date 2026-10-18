import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { FilterChip } from "@/lib/housekeeping/roomBoardFilters";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function chipLabel(chip: FilterChip, t: Translate): string {
  switch (chip.kind) {
    case "status":
      return t(`roomBoard.filters.status.${chip.key}`);
    case "flag":
      return t(`roomBoard.filters.flag.${chip.key}`);
    case "building":
      return chip.building === "~" ? t("roomBoard.buildingNone") : t("roomBoard.building", { building: chip.building });
    case "floor": {
      const level = chip.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: chip.floor });
      return chip.building ? t("roomBoard.filters.chipFloor", { where: t("roomBoard.building", { building: chip.building }), level }) : level;
    }
  }
}

/**
 * The verified result count plus removable chips for every applied filter. The count line is a polite live
 * region, so a screen reader hears "Showing 3 of 95 rooms" as the search or filters change.
 */
export function BoardActiveFilters({
  chips,
  shown,
  total,
  notice,
  sortLabel,
  onRemove,
  onClearAll,
  onEdit,
  t,
}: {
  chips: FilterChip[];
  shown: number;
  total: number;
  /** Plain-language caveat (e.g. a filter the board has no data for). */
  notice: string | null;
  /** The non-default sort in plain words, or null for the default order. */
  sortLabel: string | null;
  onRemove: (chip: FilterChip) => void;
  onClearAll: () => void;
  onEdit: () => void;
  t: Translate;
}) {
  const theme = useTheme();
  return (
    <View style={styles.wrap} testID="room-board-active-filters">
      <View style={styles.topRow}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.count, { color: theme.textSecondary }]}
          accessibilityLiveRegion="polite"
          testID="room-board-result-count"
        >
          {t("roomBoard.results.showing", { shown, total })}
        </Text>
        {chips.length > 0 ? (
          <View style={styles.actions}>
            <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={t("roomBoard.filters.edit")} style={styles.action} testID="room-board-edit-filters">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
                {t("roomBoard.filters.edit")}
              </Text>
            </Pressable>
            <Pressable onPress={onClearAll} accessibilityRole="button" accessibilityLabel={t("roomBoard.filters.clearAll")} style={styles.action} testID="room-board-clear-filters">
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
                {t("roomBoard.filters.clearAll")}
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {chips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {chips.map((chip) => {
            const label = chipLabel(chip, t);
            return (
              <Pressable
                key={chip.id}
                onPress={() => onRemove(chip)}
                accessibilityRole="button"
                accessibilityLabel={t("roomBoard.filters.removeChip", { label })}
                testID={`room-board-chip-${chip.id}`}
                style={({ pressed }) => [styles.chip, { backgroundColor: theme.surface, borderColor: theme.primaryLine }, pressed && { opacity: 0.8 }]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]}>
                  {label}
                </Text>
                <Ionicons name="close" size={16} color={theme.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {sortLabel ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notice, { color: theme.textMuted }]} testID="room-board-sort-label">
          {t("roomBoard.results.sortedBy", { sort: sortLabel })}
        </Text>
      ) : null}

      {notice ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notice, { color: theme.textMuted }]} testID="room-board-filter-notice">
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  count: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  actionText: { fontSize: 14, fontWeight: "700" },
  chips: { gap: 8, paddingRight: 16 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingLeft: 14, paddingRight: 10, borderWidth: 1, borderRadius: 999 },
  chipText: { fontSize: 13.5, fontWeight: "700" },
  notice: { fontSize: 12.5, lineHeight: 17 },
});
