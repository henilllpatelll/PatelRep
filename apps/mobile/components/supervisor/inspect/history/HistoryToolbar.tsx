import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { R } from "@/components/shared/tokens";
import type { InspectorOption } from "@/lib/api/inspectionHistory";
import { filterChips, type FilterChip, type HistoryFilters } from "@/lib/inspections/history/filters";
import { chipText } from "@/lib/inspections/history/labels";
import type { Insights } from "@/lib/api/inspectionHistory";
import type { Translate } from "@/lib/inspections/viewText";
import { useTheme } from "@/lib/theme/useTheme";

/**
 * COMPLETED INSPECTIONS: the selected period, the Filter button, the active filters as removable chips, and either the
 * period's verified counts (no filters) or the number of matches (filters). A count that is not known is not shown -
 * never a 0 standing in for "still loading".
 */
export function HistoryToolbar({
  periodText,
  filters,
  inspectors,
  activeCount,
  counts,
  countsAtLeast,
  matchCount,
  matchAtLeast,
  t,
  onOpenFilters,
  onRemoveChip,
  onClearAll,
}: {
  periodText: string;
  filters: HistoryFilters;
  inspectors: readonly InspectorOption[];
  activeCount: number;
  /** The period's counts from the insights, or null while unknown. */
  counts: Insights["counts"] | null;
  /** The period was cut off server-side: the counts are a floor. */
  countsAtLeast: boolean;
  /** Matches for the current filters, when the server could count them. */
  matchCount: number | null;
  /** More matches exist than were counted. */
  matchAtLeast: boolean;
  t: Translate;
  onOpenFilters: () => void;
  onRemoveChip: (chip: FilterChip) => void;
  onClearAll: () => void;
}) {
  const theme = useTheme();
  const chips = filterChips(filters);
  const filtered = activeCount > 0;
  return (
    <View style={styles.wrap} testID="history-toolbar">
      <View style={styles.titleRow}>
        <View style={styles.titleText}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.kicker, { color: theme.textMuted }]}>
            {t("inspect.history.title").toUpperCase()}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.period, { color: theme.textPrimary }]} testID="history-period">
            {periodText}
          </Text>
        </View>
        <Pressable
          onPress={onOpenFilters}
          accessibilityRole="button"
          accessibilityLabel={activeCount > 0 ? t("inspect.history.toolbar.filterActive", { count: activeCount }) : t("inspect.history.toolbar.filter")}
          testID="history-filter-button"
          style={({ pressed }) => [styles.filter, { backgroundColor: theme.surface, borderColor: filtered ? theme.primaryAction : theme.border, opacity: pressed ? 0.85 : 1 }]}
        >
          <Ionicons name="funnel-outline" size={16} color={theme.textPrimary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.filterText, { color: theme.textPrimary }]}>
            {t("inspect.history.toolbar.filter")}
          </Text>
          {activeCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: theme.primaryAction }]}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: theme.onPrimary }]}>
                {activeCount}
              </Text>
            </View>
          ) : null}
        </Pressable>
      </View>

      {chips.length > 0 ? (
        <View style={styles.chips} testID="history-chips">
          {chips.map((chip) => {
            const label = chipText(chip, inspectors, t);
            return (
              <Pressable
                key={`${chip.kind}`}
                onPress={() => onRemoveChip(chip)}
                accessibilityRole="button"
                accessibilityLabel={t("inspect.history.toolbar.removeFilter", { label })}
                testID={`history-chip-${chip.kind}`}
                style={[styles.chip, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chipText, { color: theme.textPrimary }]} numberOfLines={1}>
                  {label}
                </Text>
                <Ionicons name="close" size={14} color={theme.textMuted} />
              </Pressable>
            );
          })}
          <Pressable onPress={onClearAll} accessibilityRole="button" style={styles.clear} testID="history-clear-all">
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.clearText, { color: theme.primaryAction }]}>
              {t("inspect.history.toolbar.clearAll")}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {filtered ? (
        matchCount !== null ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summaryText, { color: theme.textSecondary }]} testID="history-match-count">
            {t(matchAtLeast ? "inspect.history.summary.matchesAtLeast" : "inspect.history.summary.matches", { count: matchCount })}
          </Text>
        ) : null
      ) : counts ? (
        <>
          <View style={styles.summary} testID="history-summary">
            <Stat label={t("inspect.history.summary.passed")} value={counts.passed} atLeast={countsAtLeast} t={t} testID="history-stat-passed" />
            <Stat label={t("inspect.history.summary.failed")} value={counts.failed} atLeast={countsAtLeast} t={t} testID="history-stat-failed" />
            <Stat label={t("inspect.history.summary.reinspections")} value={counts.reinspections} atLeast={countsAtLeast} t={t} testID="history-stat-reinspections" />
          </View>
          {counts.conditional > 0 ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summaryText, { color: theme.textMuted }]} testID="history-stat-conditional">
              {t("inspect.history.summary.conditionalLine", { count: counts.conditional })}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function Stat({ label, value, atLeast, t, testID }: { label: string; value: number; atLeast: boolean; t: Translate; testID: string }) {
  const theme = useTheme();
  const shown = atLeast ? t("inspect.history.insights.atLeast", { count: value }) : String(value);
  return (
    <View style={[styles.stat, { backgroundColor: theme.surface, borderColor: theme.border }]} accessible accessibilityLabel={`${label}: ${shown}`} testID={testID}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statValue, { color: theme.textPrimary }]}>
        {shown}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.statLabel, { color: theme.textMuted }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  titleText: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.8 },
  period: { fontSize: 17, fontWeight: "800" },
  filter: { minHeight: MIN_TARGET, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12 },
  filterText: { fontSize: 14, fontWeight: "700" },
  badge: { minWidth: 20, height: 20, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  badgeText: { fontSize: 11.5, fontWeight: "800" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  chip: { minHeight: 36, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12 },
  chipText: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
  clear: { minHeight: 36, justifyContent: "center", paddingHorizontal: 6 },
  clearText: { fontSize: 13, fontWeight: "800" },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  summaryText: { fontSize: 13, fontWeight: "600" },
  stat: { flexGrow: 1, flexBasis: 96, minWidth: 96, borderWidth: 1, borderRadius: R.md, paddingHorizontal: 10, paddingVertical: 7, gap: 0 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 11.5, fontWeight: "600" },
});
