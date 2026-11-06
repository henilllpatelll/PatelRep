import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/components/home/homeUi";
import { ActionTile, AttentionRow, SectionHead, ShareRow } from "@/components/management/HomeParts";
import { useManagementHeader } from "@/components/management/ManagementHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { spaceV2 } from "@/components/shared/tokensV2";
import { AppText } from "@/components/ui/AppText";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { MetricCard } from "@/components/ui/MetricCard";
import { StateBlock } from "@/components/ui/StateBlock";
import { formatCount, summarizeGuestRequests, GUEST_REQUEST_PAGE_SIZE } from "@/lib/frontDesk/guestRequests";
import { summarizeRoomReadiness } from "@/lib/frontDesk/roomReadiness";
import { useBoardSource, useGuestRequestsSource } from "@/lib/management/homeData";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Front Desk Home (Design System V2) ──────────────────────────────────────
   The desk's day: guest requests first (the work the desk owns), then how the rooms stand, what needs a look, and
   one-tap routes into the screens it already has. Read-only: opening this screen makes two GETs and nothing else
   (no writes, no AI). Counts come from real rows only; where a figure could be a lower bound it says so. */

export function FrontDeskHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const requests = useGuestRequestsSource();
  const board = useBoardSource();
  const refreshAll = useCallback(async () => {
    await Promise.all([requests.refresh(), board.refresh()]);
  }, [requests, board]);
  const [pulling, setPulling] = useState(false);
  const onRefresh = useCallback(async () => {
    setPulling(true);
    try {
      await refreshAll();
    } finally {
      setPulling(false);
    }
  }, [refreshAll]);

  const { header, notice, hotelTimezone } = useManagementHeader("frontdesk", name, [requests, board], () => void onRefresh());

  const rows = requests.data;
  const summary = rows ? summarizeGuestRequests(rows, { timeZone: hotelTimezone }) : null;
  const rooms = board.data ? summarizeRoomReadiness(board.data) : null;
  const go = (href: string) => router.push(href as never);

  const next = summary?.next ?? null;
  const loadedHint = summary?.partial ? t("frontDeskHome.requests.partial", { count: GUEST_REQUEST_PAGE_SIZE }) : t("frontDeskHome.requests.loadedHint", { count: summary?.loaded ?? 0 });

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="frontdesk-home">
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        {header}
        <View style={styles.body}>
          {notice}

          {/* Guest requests: the primary section */}
          <View style={styles.section}>
            <SectionHead title={t("frontDeskHome.requests.title")} actionLabel={t("frontDeskHome.requests.openAll")} onAction={() => go("/(app)/guest-requests")} testID="frontdesk-requests-head" />
            {summary ? (
              <>
                <View style={styles.grid} testID="frontdesk-request-metrics">
                  <MetricCard
                    testID="frontdesk-metric-open"
                    label={t("frontDeskHome.requests.open")}
                    value={formatCount(summary.open, summary.partial)}
                    icon="chatbubble-ellipses-outline"
                    tone={summary.open > 0 ? "pickup" : "neutral"}
                    onPress={() => go("/(app)/guest-requests")}
                    style={styles.metric}
                  />
                  <MetricCard
                    testID="frontdesk-metric-progress"
                    label={t("frontDeskHome.requests.inProgress")}
                    value={formatCount(summary.inProgress, summary.partial)}
                    icon="time-outline"
                    tone={summary.inProgress > 0 ? "inProgress" : "neutral"}
                    onPress={() => go("/(app)/guest-requests")}
                    style={styles.metric}
                  />
                  <MetricCard
                    testID="frontdesk-metric-urgent"
                    label={t("frontDeskHome.requests.urgent")}
                    value={formatCount(summary.urgentActive, summary.partial)}
                    icon="flag-outline"
                    tone={summary.urgentActive > 0 ? "dirty" : "neutral"}
                    onPress={() => go("/(app)/guest-requests")}
                    style={styles.metric}
                  />
                  <MetricCard
                    testID="frontdesk-metric-resolved"
                    label={t("frontDeskHome.requests.resolvedToday")}
                    value={formatCount(summary.resolvedToday, summary.partial)}
                    icon="checkmark-done-outline"
                    tone={summary.resolvedToday > 0 ? "ready" : "neutral"}
                    onPress={() => go("/(app)/guest-requests")}
                    style={styles.metric}
                  />
                </View>
                <AppText variant="caption" tone="muted" testID="frontdesk-requests-provenance" maxFontSizeMultiplier={MAX_FONT_SCALE}>
                  {loadedHint}
                </AppText>

                {next ? (
                  <Card testID="frontdesk-next-request" style={styles.next}>
                    <AppText variant="caption" tone="secondary">
                      {t("frontDeskHome.requests.next")}
                    </AppText>
                    <View style={styles.nextTop}>
                      <AppText variant="headline" style={styles.grow} numberOfLines={2} maxFontSizeMultiplier={MAX_FONT_SCALE}>
                        {next.title || t("guestRequestsV2.untitled")}
                      </AppText>
                      {next.urgent ? <StatusBadge statusKey="urgent" label={t("workOrders.chipUrgent")} /> : null}
                    </View>
                    {next.roomNumber ? (
                      <AppText variant="caption" tone="secondary">
                        {t("guestRequests.roomLabel", { room: next.roomNumber })}
                      </AppText>
                    ) : null}
                    <Button
                      testID="frontdesk-next-open"
                      label={t("frontDeskHome.requests.openNext")}
                      onPress={() => go(`/(app)/guest-requests/${next.id}`)}
                      size="md"
                    />
                  </Card>
                ) : (
                  <Card testID="frontdesk-no-active" style={styles.next}>
                    <AppText variant="bodyStrong">{t("frontDeskHome.requests.noneActive")}</AppText>
                    <AppText variant="caption" tone="secondary">
                      {summary.partial ? t("frontDeskHome.requests.noneActivePartial", { count: GUEST_REQUEST_PAGE_SIZE }) : t("frontDeskHome.requests.noneActiveBody")}
                    </AppText>
                  </Card>
                )}
              </>
            ) : requests.status === "error" ? (
              <StateBlock status="error" errorMessage={t("frontDeskHome.requests.failed")} onRetry={() => void requests.refresh()} retryLabel={t("common.retry")} />
            ) : (
              <UnloadedCard testID="frontdesk-requests-unloaded" loading={requests.status === "loading"} />
            )}
          </View>

          {/* Room readiness: housekeeping, occupancy and availability are separate */}
          <View style={styles.section}>
            <SectionHead title={t("frontDeskHome.rooms.title")} actionLabel={t("frontDeskHome.rooms.openAll")} onAction={() => go("/(app)/room-status")} testID="frontdesk-rooms-head" />
            {rooms ? (
              rooms.total === 0 ? (
                <Card style={styles.next} testID="frontdesk-rooms-empty">
                  <AppText variant="bodyStrong">{t("frontDeskHome.rooms.empty")}</AppText>
                </Card>
              ) : (
                <Card style={styles.list} testID="frontdesk-rooms">
                  <AppText variant="caption" tone="secondary">
                    {t("frontDeskHome.rooms.condition")}
                  </AppText>
                  <ShareRow label={t("frontDeskHome.rooms.ready")} count={rooms.inspected} total={rooms.total} tone="ready" a11yLabel={t("frontDeskHome.rooms.a11y", { label: t("frontDeskHome.rooms.ready"), count: rooms.inspected, total: rooms.total })} testID="frontdesk-rooms-ready" />
                  <ShareRow label={t("frontDeskHome.rooms.clean")} count={rooms.clean} total={rooms.total} tone="primary" a11yLabel={t("frontDeskHome.rooms.a11y", { label: t("frontDeskHome.rooms.clean"), count: rooms.clean, total: rooms.total })} testID="frontdesk-rooms-clean" />
                  <ShareRow label={t("frontDeskHome.rooms.dirty")} count={rooms.dirty} total={rooms.total} tone="pickup" a11yLabel={t("frontDeskHome.rooms.a11y", { label: t("frontDeskHome.rooms.dirty"), count: rooms.dirty, total: rooms.total })} testID="frontdesk-rooms-dirty" />
                  <View style={[styles.rule, { backgroundColor: theme.borderSubtle }]} />
                  <AppText variant="caption" tone="secondary">
                    {t("frontDeskHome.rooms.stay")}
                  </AppText>
                  <View style={styles.inline}>
                    <StatPair label={t("frontDeskHome.rooms.occupied")} value={rooms.occupied} testID="frontdesk-rooms-occupied" />
                    <StatPair label={t("frontDeskHome.rooms.vacant")} value={rooms.vacant} testID="frontdesk-rooms-vacant" />
                    <StatPair label={t("frontDeskHome.rooms.outOfOrder")} value={rooms.outOfOrder} testID="frontdesk-rooms-ooo" />
                  </View>
                  <AppText variant="micro" tone="muted">
                    {t("frontDeskHome.rooms.separate", { total: rooms.total })}
                  </AppText>
                </Card>
              )
            ) : board.status === "error" ? (
              <StateBlock status="error" errorMessage={t("frontDeskHome.rooms.failed")} onRetry={() => void board.refresh()} retryLabel={t("common.retry")} />
            ) : (
              <UnloadedCard testID="frontdesk-rooms-unloaded" loading={board.status === "loading"} />
            )}
          </View>

          {/* Priority attention: only exceptions the loaded data actually shows; otherwise a plain link, never an "all clear" */}
          <View style={styles.section}>
            <SectionHead title={t("frontDeskHome.attention.title")} testID="frontdesk-attention-head" />
            <Card style={styles.listFlush} testID="frontdesk-attention">
              {summary && summary.urgentActive > 0 ? (
                <AttentionRow
                  first
                  testID="frontdesk-attention-urgent"
                  icon="flag-outline"
                  tone="alert"
                  title={t("frontDeskHome.attention.urgent", { count: summary.urgentActive, shown: formatCount(summary.urgentActive, summary.partial) })}
                  subtitle={t("frontDeskHome.attention.urgentSub")}
                  onPress={() => go("/(app)/guest-requests")}
                />
              ) : null}
              {rooms && rooms.outOfOrder > 0 ? (
                <AttentionRow
                  first={!(summary && summary.urgentActive > 0)}
                  testID="frontdesk-attention-ooo"
                  icon="construct-outline"
                  tone="attention"
                  title={t("frontDeskHome.attention.ooo", { count: rooms.outOfOrder })}
                  subtitle={t("frontDeskHome.attention.oooSub")}
                  onPress={() => go("/(app)/room-status?filter=OOO")}
                />
              ) : null}
              {summary && rooms && summary.urgentActive === 0 && rooms.outOfOrder === 0 ? (
                <View style={styles.padded} testID="frontdesk-attention-none">
                  <AppText variant="bodyStrong">{t("frontDeskHome.attention.none")}</AppText>
                  <AppText variant="caption" tone="secondary">
                    {t("frontDeskHome.attention.noneBody")}
                  </AppText>
                </View>
              ) : null}
              {!summary || !rooms ? (
                <AttentionRow
                  first={!(summary && summary.urgentActive > 0) && !(rooms && rooms.outOfOrder > 0)}
                  testID="frontdesk-attention-review"
                  icon="chatbubble-ellipses-outline"
                  tone="info"
                  title={t("frontDeskHome.attention.reviewRequests")}
                  subtitle={t("frontDeskHome.attention.unavailable")}
                  onPress={() => go("/(app)/guest-requests")}
                />
              ) : null}
            </Card>
          </View>

          <View style={styles.section}>
            <SectionHead title={t("frontDeskHome.quick.title")} testID="frontdesk-quick-head" />
            <View style={styles.tiles} testID="frontdesk-quick">
              <ActionTile testID="frontdesk-quick-requests" icon="chatbubble-ellipses-outline" label={t("tabs.guestRequests")} onPress={() => go("/(app)/guest-requests")} />
              <ActionTile testID="frontdesk-quick-rooms" icon="bed-outline" label={t("tabs.roomStatus")} onPress={() => go("/(app)/room-status")} />
              <ActionTile testID="frontdesk-quick-logbook" icon="book-outline" label={t("tabs.logbook")} onPress={() => go("/(app)/logbook")} />
              <ActionTile testID="frontdesk-quick-lost" icon="search-outline" label={t("tabs.lostFound")} onPress={() => go("/(app)/lost-found")} />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function StatPair({ label, value, testID }: { label: string; value: number; testID: string }) {
  return (
    <View style={styles.pair} testID={testID} accessible accessibilityLabel={`${label}, ${value}`}>
      <AppText variant="title" numeric maxFontSizeMultiplier={1.3}>
        {value}
      </AppText>
      <AppText variant="caption" tone="secondary" maxFontSizeMultiplier={MAX_FONT_SCALE}>
        {label}
      </AppText>
    </View>
  );
}

/** A section that has not answered yet. Says "not loaded"; never a zero and never an empty-looking "all clear". */
function UnloadedCard({ loading, testID }: { loading: boolean; testID: string }) {
  const { t } = useTranslation();
  return (
    <Card style={styles.next} testID={testID}>
      <AppText variant="bodyStrong">{loading ? t("managementHome.unloaded.loading") : t("managementHome.unloaded.waiting")}</AppText>
      {!loading ? (
        <AppText variant="caption" tone="secondary">
          {t("managementHome.unloaded.body")}
        </AppText>
      ) : null}
    </Card>
  );
}

export { UnloadedCard };

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingBottom: 32 },
  body: { paddingHorizontal: spaceV2.page, gap: spaceV2.xl, paddingTop: spaceV2.md },
  section: { gap: spaceV2.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spaceV2.sm },
  metric: { flexBasis: "47%", flexGrow: 1 },
  next: { padding: spaceV2.lg, gap: spaceV2.sm },
  nextTop: { flexDirection: "row", alignItems: "flex-start", gap: spaceV2.sm },
  grow: { flex: 1, minWidth: 0 },
  list: { padding: spaceV2.lg, gap: spaceV2.md },
  listFlush: { paddingVertical: 0 },
  padded: { padding: spaceV2.lg, gap: 4 },
  rule: { height: StyleSheet.hairlineWidth },
  inline: { flexDirection: "row", gap: spaceV2.lg },
  pair: { flex: 1, gap: 2 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spaceV2.sm },
});
