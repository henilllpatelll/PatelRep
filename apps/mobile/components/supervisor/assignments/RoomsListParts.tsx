import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import type { QuickView } from "@/lib/housekeeping/assignmentQuery";
import type { ActiveChip, RoomSection } from "@/lib/housekeeping/assignmentRoomsView";
import { NONE_KEY } from "@/lib/housekeeping/roomBoardFilters";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** All / Unassigned / Urgent with verified counts. Unassigned and Urgent combine; All clears both. */
export function QuickChips({
  views,
  counts,
  isActive,
  onPress,
  t,
}: {
  views: readonly QuickView[];
  counts: Record<QuickView, number>;
  isActive: (view: QuickView) => boolean;
  onPress: (view: QuickView) => void;
  t: Translate;
}) {
  const theme = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.flexNone} testID="assignments-quick-chips">
      {views.map((view) => {
        const active = isActive(view);
        const label = t(`assignments.v2.quick.${view}`);
        return (
          <Pressable
            key={view}
            onPress={() => onPress(view)}
            testID={`assignments-quick-${view}`}
            accessibilityRole="button"
            accessibilityLabel={t("assignments.v2.quick.a11y", { label, count: counts[view] })}
            accessibilityState={{ selected: active }}
            style={({ pressed }) => [
              styles.quick,
              active ? { backgroundColor: theme.primaryAction, borderColor: theme.primaryAction } : { backgroundColor: theme.surface, borderColor: theme.border },
              pressed && { opacity: 0.8 },
            ]}
          >
            {active ? <Ionicons name="checkmark" size={14} color={theme.onPrimary} /> : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.quickLabel, { color: active ? theme.onPrimary : theme.textPrimary }]}>
              {label}
            </Text>
            <View style={[styles.count, { backgroundColor: active ? "rgba(255,255,255,0.22)" : theme.surfaceMuted }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.countText, { color: active ? theme.onPrimary : theme.textSecondary }]}>
                {counts[view]}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function chipLabel(chip: ActiveChip, t: Translate): string {
  switch (chip.kind) {
    case "scope":
      return t(`assignments.v2.filters.scope.${chip.scope}`);
    case "priority":
      return t(`assignments.v2.filters.priority.${chip.priority}`);
    case "building":
      return chip.building === NONE_KEY ? t("roomBoard.buildingNone") : t("roomBoard.building", { building: chip.building });
    case "floor": {
      const level = chip.floor === null ? t("roomBoard.floorUnknown") : t("roomBoard.floor", { floor: chip.floor });
      return chip.building ? t("roomBoard.filters.chipFloor", { where: t("roomBoard.building", { building: chip.building }), level }) : level;
    }
    case "cleanType":
      return chip.label ?? t("assignments.v2.filters.cleanTypeNone");
    case "status":
      return t(`roomBoard.card.status.${chip.code}`);
  }
}

/**
 * The result count (a polite live region) plus a removable chip for every applied narrowing the quick chips
 * do not already show. Shown only while something narrows the list.
 */
export function ActiveFilters({
  chips,
  shown,
  total,
  sortLabel,
  onRemove,
  onClearAll,
  onEdit,
  t,
}: {
  chips: ActiveChip[];
  shown: number;
  total: number;
  sortLabel: string | null;
  onRemove: (chip: ActiveChip) => void;
  onClearAll: () => void;
  onEdit: () => void;
  t: Translate;
}) {
  const theme = useTheme();
  return (
    <View style={styles.activeWrap} testID="assignments-active-filters">
      <View style={styles.activeTop}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.activeCount, { color: theme.textSecondary }]} accessibilityLiveRegion="polite" testID="assignments-result-count">
          {t("assignments.v2.results.showing", { shown, total })}
        </Text>
        <View style={styles.activeActions}>
          <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel={t("assignments.v2.filters.edit")} style={styles.action} testID="assignments-edit-filters">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
              {t("assignments.v2.filters.edit")}
            </Text>
          </Pressable>
          <Pressable onPress={onClearAll} accessibilityRole="button" accessibilityLabel={t("assignments.v2.filters.clearAll")} style={styles.action} testID="assignments-clear-filters">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.actionText, { color: theme.primaryAction }]}>
              {t("assignments.v2.filters.clearAll")}
            </Text>
          </Pressable>
        </View>
      </View>
      {chips.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRowTight} keyboardShouldPersistTaps="handled">
          {chips.map((chip) => {
            const label = chipLabel(chip, t);
            return (
              <Pressable
                key={chip.id}
                onPress={() => onRemove(chip)}
                accessibilityRole="button"
                accessibilityLabel={t("assignments.v2.filters.removeChip", { label })}
                testID={`assignments-chip-${chip.id}`}
                style={({ pressed }) => [styles.activeChip, { backgroundColor: theme.surface, borderColor: theme.primaryLine }, pressed && { opacity: 0.8 }]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.activeChipText, { color: theme.textPrimary }]}>
                  {label}
                </Text>
                <Ionicons name="close" size={16} color={theme.textMuted} />
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
      {sortLabel ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sortNote, { color: theme.textMuted }]} testID="assignments-sort-label">
          {t("assignments.v2.results.sortedBy", { sort: sortLabel })}
        </Text>
      ) : null}
    </View>
  );
}

/** "Urgent — assign first (3)" style section title, with the sort caption on the first one. */
export function SectionHeader({ section, count, t }: { section: RoomSection; count: number; t: Translate }) {
  const theme = useTheme();
  return (
    <View style={styles.sectionRow} testID={`assignments-section-${section}`}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textPrimary }]}>
        {t(`assignments.v2.section.${section}`)}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionCount, { color: theme.textMuted }]}>
        {t("assignments.v2.section.count", { count })}
      </Text>
    </View>
  );
}

/** The "Rooms needing attention · Priority first" caption between the filters and the list. */
export function ListCaption({ title, sort }: { title: string; sort: string }) {
  const theme = useTheme();
  return (
    <View style={styles.caption} testID="assignments-list-caption">
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.captionTitle, { color: theme.textPrimary }]}>
        {title}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.captionSort, { color: theme.textMuted }]}>
        {sort}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flexNone: { flexGrow: 0 },
  chipRow: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chipRowTight: { gap: 8, paddingRight: 16 },
  quick: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: MIN_TARGET - 4, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999 },
  quickLabel: { fontSize: 14, fontWeight: "700" },
  count: { minWidth: 24, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, alignItems: "center" },
  countText: { fontSize: 12, fontWeight: "800" },
  activeWrap: { paddingHorizontal: 16, paddingTop: 4, gap: 8 },
  activeTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" },
  activeCount: { flexShrink: 1, fontSize: 13, fontWeight: "700" },
  activeActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  action: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" },
  actionText: { fontSize: 14, fontWeight: "700" },
  activeChip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingLeft: 14, paddingRight: 10, borderWidth: 1, borderRadius: 999 },
  activeChipText: { fontSize: 13.5, fontWeight: "700" },
  sortNote: { fontSize: 12.5, lineHeight: 17 },
  sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginHorizontal: 16, marginTop: 12 },
  sectionTitle: { flexShrink: 1, fontSize: 15, fontWeight: "800", letterSpacing: 0.4 },
  sectionCount: { fontSize: 12.5, fontWeight: "600" },
  caption: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginHorizontal: 16, marginTop: 4 },
  captionTitle: { flexShrink: 1, fontSize: 17, fontWeight: "800" },
  captionSort: { fontSize: 12.5, fontWeight: "600" },
});
