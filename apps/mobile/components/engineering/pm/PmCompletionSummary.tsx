import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import type { PmCompletionResult } from "@/lib/api/pm";

export interface PmRecordedSummary {
  scheduleName: string;
  assetName: string | null;
  passed: number;
  failed: number;
  notApplicable: number;
}

interface Props {
  summary: PmRecordedSummary;
  result: PmCompletionResult;
  onViewRecord: () => void;
  onOpenWorkOrder: (id: string) => void;
  onDone: () => void;
}

/**
 * Shown only after the server has confirmed the completion. The corrective work orders listed are the ones the server
 * says it created; if the confirmation came from a re-read (`reconciled`) the response had no list, so the person is
 * pointed at Work Orders instead of being told something that was not confirmed.
 */
export function PmCompletionSummary({ summary, result, onViewRecord, onOpenWorkOrder, onDone }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const workOrders = result.corrective_work_orders ?? [];
  const total = summary.passed + summary.failed + summary.notApplicable;

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
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: theme.textPrimary }]}>
          {t("pm.recorded.items", { count: total })}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.line, { color: summary.failed > 0 ? theme.status.dirty : theme.status.ready }]} testID="pm-recorded-issues">
          {summary.failed > 0 ? t("pm.recorded.issues", { count: summary.failed }) : t("pm.recorded.noIssues")}
        </Text>
        {result.reconciled ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]} testID="pm-recorded-reconciled">
            {t("pm.recorded.reconciled")}
          </Text>
        ) : null}
      </Card>

      {workOrders.length > 0 ? (
        <Card style={styles.card} testID="pm-recorded-workorders">
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heading, { color: theme.textMuted }]}>
            {t("pm.recorded.workOrders", { count: workOrders.length })}
          </Text>
          {workOrders.map((wo) => (
            <Button key={wo.id} label={wo.title} variant="secondary" onPress={() => onOpenWorkOrder(wo.id)} icon="construct-outline" testID={`pm-recorded-wo-${wo.id}`} />
          ))}
        </Card>
      ) : null}

      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
        {t("pm.recorded.notSafeClaim")}
      </Text>

      <Button label={t("pm.recorded.viewRecord")} onPress={onViewRecord} variant="secondary" size="lg" testID="pm-recorded-view" />
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
});
