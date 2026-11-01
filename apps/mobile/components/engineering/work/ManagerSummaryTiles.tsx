import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MANAGER_SUMMARY_KEYS, type ManagerSummaryKey } from "@/lib/engineering/managerSummary";

interface Props {
  /** Count per tile; null = the server did not give one. */
  counts: Record<ManagerSummaryKey, number | null>;
  /** The server read more active orders than it counted, so each figure is a floor. */
  truncated: boolean;
  /** No answer yet, or the last attempt failed with nothing to show. */
  unavailable: boolean;
  /** Shown figures are from before the latest attempt (offline or a failed refresh). */
  stale: boolean;
  active: Record<ManagerSummaryKey, boolean>;
  onPress: (key: ManagerSummaryKey) => void;
}

/** Needs owner · In progress · Waiting, counted by the server across the whole hotel. Each tile opens the queue it counted. */
export function ManagerSummaryTiles({ counts, truncated, unavailable, stale, active, onPress }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityRole="summary" accessibilityLabel={t("workQueue.managerSummary.groupA11y")} testID="wo-manager-summary">
        {MANAGER_SUMMARY_KEYS.map((key) => {
          const count = counts[key];
          const selected = active[key];
          const label = t(`workQueue.managerSummary.${key}`);
          const a11yKey = count == null ? `a11yUnknown${selected ? "Active" : ""}` : selected ? "a11yActive" : truncated ? "a11yMore" : "a11y";
          return (
            <Pressable
              key={key}
              onPress={() => onPress(key)}
              style={[
                styles.tile,
                { backgroundColor: selected ? theme.primarySoft : theme.surface, borderColor: selected ? theme.primaryAction : theme.border },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t(`workQueue.managerSummary.${a11yKey}`, { label, count: count ?? 0 })}
              accessibilityState={{ selected }}
              testID={`manager-summary-${key}`}
            >
              <Text style={[styles.count, { color: theme.textPrimary }]} maxFontSizeMultiplier={1.3} testID={`manager-summary-${key}-count`}>
                {count == null ? t("workQueue.managerSummary.unknown") : `${count}${truncated ? "+" : ""}`}
              </Text>
              <Text style={[styles.label, { color: selected ? theme.primary : theme.textSecondary }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {unavailable ? (
        <Text style={[styles.note, { color: theme.textMuted }]} maxFontSizeMultiplier={1.3} testID="wo-manager-summary-unavailable">
          {t("workQueue.managerSummary.unavailable")}
        </Text>
      ) : stale ? (
        <Text style={[styles.note, { color: theme.textMuted }]} maxFontSizeMultiplier={1.3} testID="wo-manager-summary-stale">
          {t("workQueue.managerSummary.stale")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12 },
  row: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, minHeight: 64, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingVertical: 8, paddingHorizontal: 6 },
  count: { fontSize: 24, lineHeight: 28, fontWeight: "800" },
  label: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  note: { fontSize: 12.5, marginTop: 6, paddingHorizontal: 4 },
});
