import { Pressable, StyleSheet, Text, View } from "react-native";
import { MAX_FONT_SCALE, MIN_TARGET } from "@/components/home/homeUi";
import { Body } from "@/components/supervisor/assignments/BulkParts";
import { Button } from "@/components/ui/Button";
import { minutesLine } from "@/lib/housekeeping/assignmentBulkView";
import type { BulkAssignmentController } from "@/lib/housekeeping/useBulkAssignment";
import { useTheme } from "@/lib/theme/useTheme";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/* ─── The selection footer ──────────────────────────────────────────────────
   Always visible while selecting (it sits OUTSIDE the scrolling list, above the safe area), and the only place a
   selection turns into anything: "Assign selected" and "Add to draft" both open the allocation drawer — neither
   writes — and "Clear" empties the selection. Everything is off while changes are paused. */

export function BulkActionFooter({ bulk, bottomInset, t }: { bulk: BulkAssignmentController; bottomInset: number; t: Translate }) {
  const theme = useTheme();
  const { summary } = bulk.selection;
  const valid = summary.valid.length;
  const off = valid === 0 || bulk.paused !== null;
  return (
    <View style={[styles.footer, { paddingBottom: Math.max(12, bottomInset + 6), backgroundColor: theme.surface, borderTopColor: theme.border }]} testID="bulk-footer">
      {valid === 0 ? (
        <Body tone="secondary" testID="bulk-footer-empty">
          {t("assignments.v2.bulk.footer.empty")}
        </Body>
      ) : (
        <View accessible accessibilityLiveRegion="polite" accessibilityLabel={`${t("assignments.v2.bulk.footer.summary", { count: valid })}. ${minutesLine(summary.minutes, t)}`} testID="bulk-footer-summary">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.summary, { color: theme.textPrimary }]}>
            {t("assignments.v2.bulk.footer.summary", { count: valid })}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.minutes, { color: theme.textSecondary }]}>
            {minutesLine(summary.minutes, t)}
          </Text>
        </View>
      )}
      {bulk.paused ? (
        <Body tone="muted" testID="bulk-footer-paused">
          {t(bulk.paused === "offline" ? "assignments.v2.bulk.review.paused.offline" : "assignments.v2.bulk.review.paused.not_live")}
        </Body>
      ) : null}
      <Button label={t("assignments.v2.bulk.footer.assign")} icon="people-outline" onPress={() => bulk.openAllocate("review")} disabled={off} testID="bulk-assign" />
      <View style={styles.secondary}>
        <Pressable onPress={() => bulk.openAllocate("stage")} disabled={off} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.footer.addToDraft")} accessibilityState={{ disabled: off }} style={[styles.link, off && { opacity: 0.45 }]} testID="bulk-add-to-draft">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.primaryAction }]}>
            {t("assignments.v2.bulk.footer.addToDraft")}
          </Text>
        </Pressable>
        <Pressable onPress={bulk.selection.clear} disabled={summary.selectedCount === 0} accessibilityRole="button" accessibilityLabel={t("assignments.v2.bulk.footer.clear")} accessibilityState={{ disabled: summary.selectedCount === 0 }} style={[styles.link, summary.selectedCount === 0 && { opacity: 0.45 }]} testID="bulk-clear">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.linkText, { color: theme.textSecondary }]}>
            {t("assignments.v2.bulk.footer.clear")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { paddingHorizontal: 16, paddingTop: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  summary: { fontSize: 16, fontWeight: "800" },
  minutes: { fontSize: 14, fontWeight: "600" },
  secondary: { flexDirection: "row", justifyContent: "space-between" },
  link: { minHeight: MIN_TARGET, justifyContent: "center", paddingHorizontal: 8 },
  linkText: { fontSize: 15, fontWeight: "700" },
});
