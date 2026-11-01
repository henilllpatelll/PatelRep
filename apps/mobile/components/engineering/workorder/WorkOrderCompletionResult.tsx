import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { formatDuration } from "@/lib/engineering/workOrders";
import type { VerificationResult } from "@/lib/engineering/repairWorkspace";

export interface CompletionSummary {
  title: string;
  room: string | null;
  verification: VerificationResult | null;
  laborMinutes: number;
  partsCount: number;
  photoCount: number;
  assetRestored: boolean;
}

interface Props {
  summary: CompletionSummary;
  onViewRecord: () => void;
  onBack: () => void;
}

/** Shown only after the server confirmed the completion. It lists what was recorded, not what was hoped for. */
export function WorkOrderCompletionResult({ summary, onViewRecord, onBack }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const items: string[] = [];
  if (summary.verification) items.push(t(`workOrders.repair.result.verification.${summary.verification}`));
  if (summary.laborMinutes > 0) items.push(t("workOrders.repair.result.labor", { time: formatDuration(Math.round(summary.laborMinutes)) }));
  if (summary.partsCount > 0) items.push(t("workOrders.repair.result.parts", { count: summary.partsCount }));
  if (summary.photoCount > 0) items.push(t("workOrders.repair.result.evidence", { count: summary.photoCount }));
  if (summary.assetRestored) items.push(t("workOrders.repair.result.assetRestored"));

  return (
    <View style={styles.wrap} testID="wo-completion-result" accessibilityLiveRegion="polite">
      <View style={[styles.badge, { backgroundColor: theme.status.readySoft }]}>
        <Ionicons name="checkmark-circle" size={40} color={theme.status.ready} />
      </View>
      <Text style={[styles.kicker, { color: theme.status.ready }]} accessibilityRole="header">{t("workOrders.repair.result.title")}</Text>
      <Text style={[styles.title, { color: theme.textPrimary }]}>{summary.title}</Text>
      {summary.room ? <Text style={{ color: theme.textSecondary, fontSize: 14 }}>{t("workOrders.repair.complete.room", { room: summary.room })}</Text> : null}
      <Text style={{ color: theme.textSecondary, fontSize: 14, marginTop: 6 }}>{t("workOrders.repair.result.recorded")}</Text>
      <View style={[styles.list, { borderColor: theme.border, backgroundColor: theme.surface }]}>
        {items.map((line) => (
          <View key={line} style={styles.line}>
            <Ionicons name="checkmark" size={16} color={theme.status.ready} />
            <Text style={{ color: theme.textPrimary, fontSize: 14, flex: 1 }}>{line}</Text>
          </View>
        ))}
        {summary.verification === "follow_up_required" ? <Text style={{ color: theme.status.pickup, fontSize: 13 }}>{t("workOrders.repair.result.followUp")}</Text> : null}
      </View>
      <View style={styles.buttons}>
        <Button label={t("workOrders.repair.result.viewRecord")} variant="secondary" size="lg" onPress={onViewRecord} testID="wo-view-record" />
        <Button label={t("workOrders.repair.result.backToWork")} size="lg" onPress={onBack} testID="wo-back-to-work" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 4, paddingVertical: 24, paddingHorizontal: 8 },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  kicker: { fontSize: 12, fontWeight: "800", letterSpacing: 1.2, marginTop: 10 },
  title: { fontSize: 21, fontWeight: "700", textAlign: "center" },
  list: { alignSelf: "stretch", borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 8, marginTop: 6 },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttons: { alignSelf: "stretch", gap: 10, marginTop: 14 },
});
