import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { useSyncActivity } from "@/lib/offline/sync";
import { dismissReportRecord, useQueuedReports, useReportRecords } from "@/lib/engineering/pendingReports";

/**
 * The truth about reports made without a connection, on the Work tab:
 * still on this phone (not accepted yet), accepted with the real work order number, or refused and dropped.
 */
export function PendingReportsBanner() {
  const { t } = useTranslation();
  const theme = useTheme();
  const records = useReportRecords();
  const syncing = useSyncActivity((s) => s.active);
  const queued = useQueuedReports(`${syncing}:${records.length}`);
  if (queued.length === 0 && records.length === 0) return null;

  return (
    <View style={styles.stack} testID="pending-reports">
      {queued.length > 0 ? (
        <View style={[styles.card, { backgroundColor: theme.status.pickupSoft }]} accessibilityLiveRegion="polite" testID="pending-reports-queued">
          <Ionicons name={syncing ? "sync-outline" : "cloud-upload-outline"} size={18} color={theme.status.pickup} />
          <View style={styles.body}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
              {syncing ? t("report.pending.syncing", { count: queued.length }) : t("report.pending.waiting", { count: queued.length })}
            </Text>
            {queued.slice(0, 3).map((report) => (
              <Text key={report.requestId} maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]} numberOfLines={1}>
                {report.title || t("report.pending.untitled")}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      {records.map((record) => (
        <View
          key={record.requestId}
          style={[styles.card, { backgroundColor: record.kind === "synced" ? theme.status.readySoft : theme.status.dirtySoft }]}
          accessibilityLiveRegion="polite"
          testID={`pending-report-${record.kind}`}
        >
          <Ionicons name={record.kind === "synced" ? "checkmark-circle-outline" : "alert-circle-outline"} size={18} color={record.kind === "synced" ? theme.status.ready : theme.status.dirty} />
          <View style={styles.body}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.title, { color: theme.textPrimary }]}>
              {record.kind === "synced"
                ? t("report.pending.synced", { number: record.workOrderNumber ? `WO-${String(record.workOrderNumber).replace(/^WO-/i, "")}` : t("report.pending.workOrder") })
                : t("report.pending.refused")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textSecondary }]} numberOfLines={2}>
              {record.title || t("report.pending.untitled")}
              {record.kind === "refused" && record.message ? ` — ${record.message}` : ""}
            </Text>
            {record.kind === "synced" && record.workOrderId ? (
              <Pressable
                onPress={() => router.push({ pathname: "/(app)/work-orders/[woId]", params: { woId: record.workOrderId } } as never)}
                accessibilityRole="button"
                style={styles.link}
                testID="pending-report-open"
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.primaryAction, fontWeight: "700", fontSize: 13.5 }}>
                  {t("report.pending.open")}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <Pressable onPress={() => void dismissReportRecord(record.requestId)} accessibilityRole="button" accessibilityLabel={t("report.pending.dismiss")} hitSlop={8} style={styles.dismiss} testID="pending-report-dismiss">
            <Ionicons name="close" size={20} color={theme.textMuted} />
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8, paddingHorizontal: 18, paddingTop: 10 },
  card: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, borderRadius: 12 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "700" },
  small: { fontSize: 13 },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  dismiss: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
});
