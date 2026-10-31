import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { R } from "@/components/shared/tokens";
import { SectionHeader } from "@/components/shared/evening";
import { formatDuration, type WorkOrder } from "@/lib/engineering/workOrders";
import type { ConsumedPartRow, LaborSummary } from "@/lib/engineering/repairWorkspace";

interface Props {
  wo: WorkOrder;
  labor: LaborSummary;
  consumed: readonly ConsumedPartRow[];
}

function Row({ k, v }: { k: string; v: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: 1 }}>
      <Text style={{ color: theme.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" }}>{k}</Text>
      <Text style={{ color: theme.textPrimary, fontSize: 14.5, lineHeight: 20 }}>{v}</Text>
    </View>
  );
}

/** What a closed order recorded, read-only. Absent fields are left out rather than shown as blanks. */
export function WorkOrderRecordCard({ wo, labor, consumed }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const problem = wo.problem_code?.label ?? wo.problem_other_text;
  const cause = wo.cause_code?.label ?? wo.cause_other_text;
  const resolution = wo.resolution_code?.label ?? wo.resolution_other_text;
  const hasAnything = problem || cause || resolution || wo.verification_result || wo.notes || wo.parts_used || labor.totalMinutes > 0 || consumed.length > 0;
  if (!hasAnything) return null;

  return (
    <View testID="wo-record">
      <SectionHeader title={t("workOrders.repair.record.title")} />
      <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {problem ? <Row k={t("workOrders.repair.complete.problem")} v={problem} /> : null}
        {cause ? <Row k={t("workOrders.repair.complete.cause")} v={cause} /> : null}
        {resolution ? <Row k={t("workOrders.repair.complete.resolution")} v={resolution} /> : null}
        {wo.verification_result ? <Row k={t("workOrders.repair.complete.verification")} v={t(`workOrders.repair.complete.verify.${wo.verification_result}`)} /> : null}
        {wo.verification_notes ? <Row k={t("workOrders.repair.complete.verificationNotes")} v={wo.verification_notes} /> : null}
        {labor.totalMinutes > 0 ? <Row k={t("workOrders.repair.complete.labor")} v={formatDuration(Math.round(labor.totalMinutes))} /> : null}
        {consumed.length > 0 ? (
          <Row k={t("workOrders.repair.complete.parts")} v={consumed.map((row) => `${row.engineering_parts?.name ?? "—"} × ${Math.abs(Number(row.quantity_delta))}`).join(", ")} />
        ) : null}
        {wo.parts_used ? <Row k={t("workOrders.repair.record.otherParts")} v={wo.parts_used} /> : null}
        {wo.notes ? <Row k={t("workOrders.notesLabel")} v={wo.notes} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: R.lg, padding: 14, gap: 10 },
});
