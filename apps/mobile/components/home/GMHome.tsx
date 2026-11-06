import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { UnloadedCard } from "@/components/home/FrontDeskHome";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { ActionTile, AttentionRow, SectionHead, ShareRow } from "@/components/management/HomeParts";
import { useManagementHeader } from "@/components/management/ManagementHeader";
import { spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StateBlock } from "@/components/ui/StateBlock";
import { formatCount, summarizeGuestRequests } from "@/lib/frontDesk/guestRequests";
import { readyPercent, summarizeRoomReadiness } from "@/lib/frontDesk/roomReadiness";
import { countByTier } from "@/lib/gm/riskAlerts";
import { activeWorkOrders, useBoardSource, useGuestRequestsSource, useRiskAlertsSource, useWorkOrderStatsSource } from "@/lib/management/homeData";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── General Manager Home (Design System V2) ─────────────────────────────────
   One screen for "what is happening, what needs me, where do I go". Every figure names its source and is exact or
   marked as a lower bound:
     - work orders: GET /work-orders/stats (exact tenant counts, not a page of rows)
     - rooms:       GET /housekeeping/board (the whole property, one row per room)
     - guest requests: newest 100 only, so counts show "N+" when the page is full
     - alerts:      GET /ai/risk-alerts (deterministic, no AI credit)
   Staff coverage is intentionally absent: the staff directory is not verified attendance. Read-only; no AI on mount. */

export function GMHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const board = useBoardSource();
  const stats = useWorkOrderStatsSource();
  const requests = useGuestRequestsSource();
  const alerts = useRiskAlertsSource();
  const [pulling, setPulling] = useState(false);
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await Promise.all([board.refresh(), stats.refresh(), requests.refresh(), alerts.refresh()]);
    } finally {
      setPulling(false);
    }
  }, [board, stats, requests, alerts]);

  const { header, notice, hotelTimezone } = useManagementHeader("gm", name, [board, stats, requests, alerts], () => void onRefresh());
  const go = (href: string) => router.push(href as never);

  const rooms = board.data ? summarizeRoomReadiness(board.data) : null;
  const wo = stats.data;
  const guest = requests.data ? summarizeGuestRequests(requests.data, { timeZone: hotelTimezone }) : null;
  const alertItems = alerts.data?.items ?? null;
  const tiers = alertItems ? countByTier(alertItems) : null;
  const pct = rooms ? readyPercent(rooms) : null;
  const woActive = wo ? activeWorkOrders(wo) : null;

  const attention: Array<{ key: string; icon: React.ComponentProps<typeof AttentionRow>["icon"]; tone: React.ComponentProps<typeof AttentionRow>["tone"]; title: string; subtitle: string; href: string }> = [];
  if (wo && wo.overdue > 0) attention.push({ key: "overdue", icon: "time-outline", tone: "alert", title: t("gmHome.attention.overdue", { count: wo.overdue }), subtitle: t("gmHome.attention.overdueSub"), href: "/(app)/work-orders" });
  if (wo && wo.urgent > 0) attention.push({ key: "urgentWo", icon: "flame-outline", tone: "alert", title: t("gmHome.attention.urgentWo", { count: wo.urgent }), subtitle: t("gmHome.attention.urgentWoSub"), href: "/(app)/work-orders" });
  if (guest && guest.urgentActive > 0) attention.push({ key: "urgentGuest", icon: "flag-outline", tone: "alert", title: t("gmHome.attention.urgentGuest", { count: guest.urgentActive, shown: formatCount(guest.urgentActive, guest.partial) }), subtitle: t("gmHome.attention.urgentGuestSub"), href: "/(app)/guest-requests" });
  if (rooms && rooms.outOfOrder > 0) attention.push({ key: "ooo", icon: "construct-outline", tone: "attention", title: t("gmHome.attention.ooo", { count: rooms.outOfOrder }), subtitle: t("gmHome.attention.oooSub"), href: "/(app)/room-status?filter=OOO" });
  if (tiers && tiers.attention > 0) attention.push({ key: "alerts", icon: "warning-outline", tone: "attention", title: t("gmHome.attention.alerts", { count: tiers.attention }), subtitle: t("gmHome.attention.alertsSub"), href: "/(app)/alerts" });

  const allLoaded = Boolean(rooms && wo && guest && alertItems);

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="gm-home">
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}>
        {header}
        <View style={styles.body}>
          {notice}

          <View style={styles.section}>
            <SectionHead title={t("gmHome.overview.title")} testID="gm-overview-head" />
            <View style={styles.grid} testID="gm-overview">
              <MetricCard
                testID="gm-metric-rooms"
                label={t("gmHome.overview.rooms")}
                value={pct === null ? "—" : `${pct}%`}
                caption={rooms ? t("gmHome.overview.roomsCaption", { ready: rooms.inspected, total: rooms.total }) : t(board.status === "error" ? "gmHome.overview.unavailable" : "gmHome.overview.notLoaded")}
                icon="bed-outline"
                tone={pct !== null && pct >= 80 ? "ready" : "neutral"}
                onPress={() => go("/(app)/room-status")}
                style={styles.metric}
              />
              <MetricCard
                testID="gm-metric-wo"
                label={t("gmHome.overview.workOrders")}
                value={woActive === null ? "—" : String(woActive)}
                caption={wo ? t("gmHome.overview.woCaption", { count: wo.overdue }) : t(stats.status === "error" ? "gmHome.overview.unavailable" : "gmHome.overview.notLoaded")}
                icon="construct-outline"
                tone={wo && wo.overdue > 0 ? "dirty" : "neutral"}
                onPress={() => go("/(app)/work-orders")}
                style={styles.metric}
              />
              <MetricCard
                testID="gm-metric-guest"
                label={t("gmHome.overview.guest")}
                value={guest ? formatCount(guest.open + guest.inProgress, guest.partial) : "—"}
                caption={guest ? (guest.partial ? t("gmHome.overview.guestPartial") : t("gmHome.overview.guestCaption", { count: guest.urgentActive })) : t(requests.status === "error" ? "gmHome.overview.unavailable" : "gmHome.overview.notLoaded")}
                icon="chatbubble-ellipses-outline"
                tone={guest && guest.urgentActive > 0 ? "pickup" : "neutral"}
                onPress={() => go("/(app)/guest-requests")}
                style={styles.metric}
              />
              <MetricCard
                testID="gm-metric-alerts"
                label={t("gmHome.overview.alerts")}
                value={alertItems ? String(alertItems.length) : "—"}
                caption={tiers ? t("gmHome.overview.alertsCaption", { count: tiers.attention }) : t(alerts.status === "error" ? "gmHome.overview.unavailable" : "gmHome.overview.notLoaded")}
                icon="warning-outline"
                tone={tiers && tiers.attention > 0 ? "pickup" : "neutral"}
                onPress={() => go("/(app)/alerts")}
                style={styles.metric}
              />
            </View>
          </View>

          <View style={styles.section}>
            <SectionHead title={t("gmHome.attention.title")} actionLabel={t("gmHome.attention.viewAlerts")} onAction={() => go("/(app)/alerts")} testID="gm-attention-head" />
            <Card style={styles.listFlush} testID="gm-attention">
              {attention.map((item, index) => (
                <AttentionRow key={item.key} first={index === 0} testID={`gm-attention-${item.key}`} icon={item.icon} tone={item.tone} title={item.title} subtitle={item.subtitle} onPress={() => go(item.href)} />
              ))}
              {attention.length === 0 && allLoaded ? (
                <View style={styles.padded} testID="gm-attention-none">
                  <AppText variant="bodyStrong">{t("gmHome.attention.none")}</AppText>
                  <AppText variant="caption" tone="secondary">
                    {t("gmHome.attention.noneBody")}
                  </AppText>
                </View>
              ) : null}
              {!allLoaded ? (
                <AttentionRow
                  first={attention.length === 0}
                  testID="gm-attention-unavailable"
                  icon="notifications-outline"
                  tone="info"
                  title={t("gmHome.attention.incomplete")}
                  subtitle={t("gmHome.attention.incompleteBody")}
                  onPress={() => go("/(app)/alerts")}
                />
              ) : null}
            </Card>
          </View>

          <View style={styles.section}>
            <SectionHead title={t("gmHome.progress.title")} testID="gm-progress-head" />
            {rooms && rooms.total > 0 ? (
              <Card style={styles.list} testID="gm-progress">
                <ShareRow label={t("gmHome.progress.ready")} count={rooms.inspected} total={rooms.total} tone="ready" a11yLabel={t("frontDeskHome.rooms.a11y", { label: t("gmHome.progress.ready"), count: rooms.inspected, total: rooms.total })} testID="gm-progress-ready" />
                <ShareRow label={t("gmHome.progress.clean")} count={rooms.clean} total={rooms.total} tone="primary" a11yLabel={t("frontDeskHome.rooms.a11y", { label: t("gmHome.progress.clean"), count: rooms.clean, total: rooms.total })} testID="gm-progress-clean" />
                <ShareRow
                  label={t("gmHome.progress.toClean")}
                  count={rooms.dirty + rooms.inProgress + rooms.pickup}
                  total={rooms.total}
                  tone="pickup"
                  a11yLabel={t("frontDeskHome.rooms.a11y", { label: t("gmHome.progress.toClean"), count: rooms.dirty + rooms.inProgress + rooms.pickup, total: rooms.total })}
                  testID="gm-progress-todo"
                />
                {wo ? (
                  <AppText variant="caption" tone="secondary" testID="gm-progress-completed" maxFontSizeMultiplier={MAX_FONT_SCALE}>
                    {t("gmHome.progress.completedToday", { count: wo.completed_today })}
                  </AppText>
                ) : null}
              </Card>
            ) : board.status === "error" ? (
              <StateBlock status="error" errorMessage={t("frontDeskHome.rooms.failed")} onRetry={() => void board.refresh()} retryLabel={t("common.retry")} />
            ) : (
              <UnloadedCard testID="gm-progress-unloaded" loading={board.status === "loading"} />
            )}
          </View>

          <View style={styles.section}>
            <SectionHead title={t("gmHome.quick.title")} testID="gm-quick-head" />
            <View style={styles.tiles} testID="gm-quick">
              <ActionTile testID="gm-quick-alerts" icon="warning-outline" label={t("tabs.alerts")} onPress={() => go("/(app)/alerts")} />
              <ActionTile testID="gm-quick-staff" icon="people-circle-outline" label={t("tabs.staff")} onPress={() => go("/(app)/staff")} />
              <ActionTile testID="gm-quick-rooms" icon="bed-outline" label={t("tabs.roomStatus")} onPress={() => go("/(app)/room-status")} />
              <ActionTile testID="gm-quick-wo" icon="construct-outline" label={t("tabs.workOrders")} onPress={() => go("/(app)/work-orders")} />
              <ActionTile testID="gm-quick-requests" icon="chatbubble-ellipses-outline" label={t("tabs.guestRequests")} onPress={() => go("/(app)/guest-requests")} />
              <ActionTile testID="gm-quick-logbook" icon="book-outline" label={t("tabs.logbook")} onPress={() => go("/(app)/logbook")} />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 32 },
  body: { paddingHorizontal: spaceV2.page, gap: spaceV2.xl, paddingTop: spaceV2.md },
  section: { gap: spaceV2.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spaceV2.sm },
  metric: { flexBasis: "47%", flexGrow: 1 },
  list: { padding: spaceV2.lg, gap: spaceV2.md },
  listFlush: { paddingVertical: 0 },
  padded: { padding: spaceV2.lg, gap: 4 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spaceV2.sm },
});
