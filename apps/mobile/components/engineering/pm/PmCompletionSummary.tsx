import { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { useV2Text } from "@/lib/design/housekeeperV2";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmCompletionResult } from "@/lib/api/pm";

export interface PmRecordedSummary {
  scheduleName: string;
  assetName: string | null;
  assetId: string | null;
  technician: string | null;
  passed: number;
  failed: number;
  notApplicable: number;
  /** Readings that were sent with the completion. */
  readings: number;
  /** Photos that were sent with the completion. */
  photos: number;
}

interface Props {
  summary: PmRecordedSummary;
  result: PmCompletionResult;
  /** When the server recorded it, already formatted for the person's language and the hotel's clock. */
  recordedAtLabel: string | null;
  /** Next due date as the server now holds it, formatted; null when the server did not say. */
  nextDueLabel: string | null;
  onViewRecord: () => void;
  onViewEquipment: (() => void) | null;
  onOpenWorkOrder: (id: string) => void;
  onDone: () => void;
}

/**
 * Shown only after the server has confirmed the completion. The corrective work orders listed are the ones the server
 * says it created (with the numbers it gave them); if the confirmation came from a re-read (`reconciled`) the response
 * had no list, so the person is pointed at Work Orders instead of being told something that was not confirmed. A recorded
 * inspection with failed steps never reads as a clean pass.
 */
export function PmCompletionSummary({ summary, result, recordedAtLabel, nextDueLabel, onViewRecord, onViewEquipment, onOpenWorkOrder, onDone }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const x = useV2Text();
  const workOrders = result.corrective_work_orders ?? [];
  const total = summary.passed + summary.failed + summary.notApplicable;

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(t("pm.recorded.announce"));
  }, [t]);

  return (
    <View style={styles.wrap} testID="pm-recorded">
      <View style={[styles.badge, { backgroundColor: theme.status.readySoft }]}>
        <Ionicons name="checkmark-circle" size={44} color={theme.status.ready} />
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]} accessibilityRole="header" accessibilityLiveRegion="polite">
        {t("pm.recorded.title")}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
        {[summary.assetName, summary.scheduleName].filter(Boolean).join(" · ")}
      </Text>

      <Card style={styles.card}>
        {recordedAtLabel ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="pm-recorded-at">
            {t("pm.recorded.completedAt")}: {recordedAtLabel}
          </Text>
        ) : null}
        {summary.technician ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
            {t("pm.recorded.technician")}: {summary.technician}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textPrimary }]}>
          {t("pm.recorded.items", { count: total })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="pm-recorded-results">
          {t("pm.recorded.resultsLine", { passed: summary.passed, failed: summary.failed, na: summary.notApplicable })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: summary.failed > 0 ? theme.status.dirty : theme.status.ready }]} testID="pm-recorded-issues">
          {summary.failed > 0 ? t("pm.recorded.issues", { count: summary.failed }) : t("pm.recorded.noIssues")}
        </Text>
        {summary.readings > 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
            {t("pm.recorded.readings", { count: summary.readings })}
          </Text>
        ) : null}
        {summary.photos > 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
            {t("pm.recorded.evidence", { count: summary.photos })}
          </Text>
        ) : null}
        {nextDueLabel ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]} testID="pm-recorded-next-due">
            {t("pm.recorded.nextDue")}: {nextDueLabel}
          </Text>
        ) : null}
        {result.reconciled ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="pm-recorded-reconciled">
            {t("pm.recorded.reconciled")}
          </Text>
        ) : null}
      </Card>

      {workOrders.length > 0 ? (
        <Card style={styles.card} testID="pm-recorded-workorders">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heading, x.label, { color: theme.textMuted }]}>
            {t("pm.recorded.workOrders", { count: workOrders.length })}
          </Text>
          {workOrders.map((wo) => (
            <Pressable
              key={wo.id}
              onPress={() => onOpenWorkOrder(wo.id)}
              style={[styles.woRow, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
              accessibilityRole="button"
              accessibilityLabel={[wo.work_order_number != null ? t("pm.recorded.workOrderNumber", { number: wo.work_order_number }) : null, wo.title].filter(Boolean).join(", ")}
              testID={`pm-recorded-wo-${wo.id}`}
            >
              <Ionicons name="construct-outline" size={20} color={theme.primaryAction} />
              <View style={styles.woCopy}>
                {wo.work_order_number != null ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textPrimary }]}>
                    {t("pm.recorded.workOrderNumber", { number: wo.work_order_number })}
                  </Text>
                ) : null}
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textSecondary }]}>
                  {wo.title}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={theme.textDisabled} />
            </Pressable>
          ))}
        </Card>
      ) : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
        {t("pm.recorded.notSafeClaim")}
      </Text>

      <Button label={t("pm.recorded.viewRecord")} onPress={onViewRecord} variant="secondary" size="lg" testID="pm-recorded-view" />
      {onViewEquipment ? <Button label={t("pm.recorded.viewEquipment")} onPress={onViewEquipment} variant="secondary" size="lg" testID="pm-recorded-equipment" /> : null}
      <Button label={t("pm.recorded.back")} onPress={onDone} size="lg" testID="pm-recorded-done" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, alignItems: "stretch", paddingTop: 12 },
  badge: { alignSelf: "center", width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 22, fontWeight: "700", textAlign: "center" },
  sub: { fontSize: 14, textAlign: "center" },
  card: { padding: 14, gap: 8 },
  line: { fontSize: 15, fontWeight: "600" },
  heading: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
  note: { fontSize: 13, lineHeight: 18 },
  woRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, borderWidth: 1, borderRadius: 12, padding: 12 },
  woCopy: { flex: 1, gap: 2 },
});
