import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/components/ui/Card";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { EngineeringSegmented } from "@/components/engineering/EngineeringSegmented";
import { ManagementHeader } from "@/components/engineering/pm/management/ManagementChrome";
import { DeferralReviewSheet } from "@/components/engineering/pm/management/DeferralReviewSheet";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { listPmDeferralRequests, type PmDeferralRequest } from "@/lib/api/pmManagement";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { useManagementResource } from "@/lib/engineering/useManagementResource";
import { canManagePmSchedules } from "@/lib/engineering/roles";
import { formatDayYear } from "@/lib/engineering/assetFormat";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

export default function PmApprovalsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const timezone = useAppStore((s) => s.hotelTimezone);
  const role = user?.effective_role ?? user?.role;
  const allowed = canManagePmSchedules(role);
  const [mode, setMode] = useState<"pending" | "decided">("pending");
  const [open, setOpen] = useState<PmDeferralRequest | null>(null);
  const list = useManagementResource(() => listPmDeferralRequests(mode), [mode], allowed);

  const rows = list.data ?? [];
  const state = resolveLoadState({ loading: list.loading && !list.data, failure: allowed ? list.failure : "forbidden", count: rows.length, offline: !isOnline && !list.data });
  const day = (iso: string | null | undefined) => (iso ? formatDayYear(iso, timezone, i18n.language) : null);
  const reload = useCallback(() => void list.reload(), [list]);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ManagementHeader title={t("pmMgmt.approvals.title")} subtitle={t("pmMgmt.approvals.subtitle")} testID="pm-approvals" />
      <View style={styles.tools}>
        <EngineeringSegmented
          options={[
            { key: "pending", label: t("pmMgmt.approvals.pending"), testID: "pm-approvals-pending" },
            { key: "decided", label: t("pmMgmt.approvals.decided"), testID: "pm-approvals-decided" },
          ]}
          value={mode}
          onChange={setMode}
          accessibilityLabel={t("pmMgmt.approvals.title")}
        />
      </View>
      {state.status !== "ready" ? (
        <EngineeringState status={state.status} onRetry={reload} emptyIcon="checkmark-done-outline" emptyTitle={t(mode === "pending" ? "pmMgmt.approvals.emptyPending" : "pmMgmt.approvals.emptyDecided")} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 40 }]}
          renderItem={({ item: r }) => (
            <Pressable onPress={() => setOpen(r)} accessibilityRole="button" testID={`pm-approval-${r.id}`}>
              <Card style={styles.card}>
                <View style={styles.top}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.name, { color: theme.textPrimary }]} numberOfLines={2}>
                    {r.schedule_name}
                  </Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.pill, { color: r.status === "rejected" ? theme.status.dirty : r.status === "approved" ? theme.status.ready : theme.status.pickup }]} testID={`pm-approval-status-${r.id}`}>
                    {t(`pmMgmt.approvals.status.${r.status}`)}
                  </Text>
                </View>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]} numberOfLines={2}>
                  {[r.asset_name, r.location_text].filter(Boolean).join(" · ")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textSecondary }]}>
                  {t("pmMgmt.approvals.move", { from: day(r.current_due_at) ?? "-", to: day(r.requested_due_at) ?? "-" })}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.textMuted }]}>
                  {t("pmMgmt.approvals.by", { name: r.requested_by_name ?? t("pmMgmt.assign.unknownPerson"), date: day(r.requested_at) ?? "" })}
                </Text>
                {r.stale ? (
                  <View style={styles.stale}>
                    <Ionicons name="alert-circle-outline" size={16} color={theme.status.pickup} />
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sub, { color: theme.status.pickup, flex: 1 }]}>{t("pmMgmt.review.stale")}</Text>
                  </View>
                ) : null}
              </Card>
            </Pressable>
          )}
        />
      )}
      <DeferralReviewSheet
        visible={open != null}
        request={open}
        role={role}
        userId={user?.id}
        timezone={timezone}
        language={i18n.language}
        isOnline={isOnline}
        onClose={() => setOpen(null)}
        onDecided={(decision) => {
          toast.success(t(decision === "approved" ? "pmMgmt.review.approvedToast" : "pmMgmt.review.rejectedToast"));
          reload();
        }}
        onNeedsRefresh={reload}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tools: { paddingHorizontal: 16, paddingTop: 12 },
  list: { padding: 16, gap: 10 },
  card: { padding: 14, gap: 4 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: "700" },
  pill: { fontSize: 12, fontWeight: "700" },
  sub: { fontSize: 13, lineHeight: 18 },
  stale: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
});
