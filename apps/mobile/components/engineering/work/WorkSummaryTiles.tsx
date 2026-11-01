import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { SUMMARY_KEYS, summaryCount, type SummaryKey, type WorkSummary } from "@/lib/engineering/workSummary";

interface Props {
  summary: WorkSummary | null;
  /** The last attempt to count failed; counts shown (if any) are from before it. */
  failed: boolean;
  /** Which tiles' selections are applied to the list right now. */
  active: Record<SummaryKey, boolean>;
  onPress: (key: SummaryKey) => void;
}

/**
 * Urgent · In progress · Waiting, counted by the server across all of the person's own work. A count that is
 * not known is shown as a dash, never as zero. Each tile applies the filter it counted (or opens On hold).
 */
export function WorkSummaryTiles({ summary, failed, active, onPress }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.wrap}>
      <View style={styles.row} accessibilityRole="summary" accessibilityLabel={t("workQueue.summary.groupA11y")} testID="wo-summary">
        {SUMMARY_KEYS.map((key) => {
          const count = summaryCount(summary, key);
          const selected = active[key];
          const alert = key === "urgent" && (count ?? 0) > 0;
          const label = t(`workQueue.summary.${key}`);
          const a11yKey = `${count == null ? "a11yUnknown" : "a11y"}${selected ? "Active" : ""}`;
          return (
            <Pressable
              key={key}
              onPress={() => onPress(key)}
              style={[
                styles.tile,
                {
                  backgroundColor: selected ? theme.primarySoft : alert ? theme.status.dirtySoft : theme.surface,
                  borderColor: selected ? theme.primaryAction : alert ? theme.status.dirtyLine : theme.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={t(`workQueue.summary.${a11yKey}`, { label, count: count ?? 0 })}
              accessibilityState={{ selected }}
              testID={`summary-${key}`}
            >
              <Text style={[styles.count, { color: alert ? theme.status.dirty : theme.textPrimary }]} maxFontSizeMultiplier={1.3} testID={`summary-${key}-count`}>
                {count == null ? t("workQueue.summary.unknown") : String(count)}
              </Text>
              <Text style={[styles.label, { color: selected ? theme.primary : theme.textSecondary }]} maxFontSizeMultiplier={1.3} numberOfLines={1}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {failed && summary == null ? (
        <Text style={[styles.note, { color: theme.textMuted }]} maxFontSizeMultiplier={1.3} testID="wo-summary-unavailable">
          {t("workQueue.summary.unavailable")}
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
