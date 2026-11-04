import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { resolveSyncStatus } from "@/lib/engineering/homeModel";
import { canManageTeam, teamScope } from "@/lib/engineering/teamModel";
import { useTeamOverview } from "@/lib/engineering/useTeamOverview";
import { usePmSyncItems } from "@/lib/engineering/usePmSyncItems";
import { useEngineeringSyncSummary } from "@/lib/engineering/useEngineeringSyncSummary";
import { useWorkOrderRealtime } from "@/lib/engineering/useWorkOrderRealtime";
import { useRefreshOnResume } from "@/lib/engineering/useRefreshOnResume";
import { formatMetric, readMetric } from "@/lib/engineering/homeContract";
import { countBlockedPmSync } from "@/lib/engineering/pmSyncItems";
import { assignTargetFor, buildPriorities, chiefSummary, priorityRoute, technicianRoute, PRIORITIES_VIEW_ALL_ROUTE, type PriorityItem } from "@/lib/engineering/chiefHomeModel";
import {
  TEAM_OVERVIEW_ROUTE,
  chiefQuickActionKeys,
  chiefQuickActionRoute,
  chiefSummaryRoute,
  ROOM_STATUS_ROUTE,
  ENGINEERING_SYNC_ROUTE,
  type ChiefQuickActionKey,
  type ChiefSummaryKey,
} from "@/lib/engineering/homeNavigation";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { AssignTechnicianSheet, type AssignTarget } from "@/components/engineering/team/AssignTechnicianSheet";
import { TechnicianHomeHeader } from "../TechnicianHomeHeader";
import { TechnicianSummaryCards, type SummaryCardData } from "../TechnicianSummaryCards";
import { TechnicianQuickActions } from "../TechnicianQuickActions";
import { HOME_MAX_FONT, homeStyles } from "../homeStyles";
import { HomeLoadNotice } from "../HomeLoadNotice";
import { PropertyPriorities } from "./PropertyPriorities";
import { TeamWorkloadPreview } from "./TeamWorkloadPreview";
import { ChiefOversight } from "./ChiefOversight";

/* ─── Chief Engineer Home ───────────────────────────────────────────────────
   The management view of the property's maintenance: three exact counts, Property Priorities, team workload, room/PM
   oversight and four shortcuts. One server read (GET /engineering/team/overview) feeds all of it, so the numbers, the
   priority list and the workload can never disagree. Nothing here claims, starts or completes a work order (the API gives
   those to engineers only); the one action is Assign, which reuses the Team Overview sheet and its server checks. A part
   the server could not read shows as unavailable, never as zero or all-clear. */

const SUMMARY_LABEL: Record<ChiefSummaryKey, string> = {
  needsOwner: "home.chief.cardNeedsOwner",
  inProgress: "home.chief.cardInProgress",
  waiting: "home.chief.cardOnHold",
};
const SUMMARY_TEST_ID: Record<ChiefSummaryKey, string> = {
  needsOwner: "summary-needs-owner",
  inProgress: "summary-in-progress",
  waiting: "summary-on-hold",
};

export function ChiefEngineerHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const role = user?.effective_role ?? user?.role;
  const canAssign = canManageTeam(role);
  const { hotelName } = useSettingsIdentity();
  const scope = teamScope(user);

  const overview = useTeamOverview(scope, canAssign);
  const data = overview.data;
  const { request } = overview;
  const [now, setNow] = useState(() => new Date());
  const [pulling, setPulling] = useState(false);
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const syncItems = usePmSyncItems();
  const sync = useEngineeringSyncSummary(syncItems);
  const { refresh: refreshSync } = sync;
  const blockedSync = useMemo(() => countBlockedPmSync(syncItems.rows, syncItems.active), [syncItems.rows, syncItems.active]);

  // Minute tick keeps "synced 3 min ago" honest while the tab stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Tabs stay mounted: re-read when this one regains focus, but not on the first focus (the read is already in flight).
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) {
        void request("focus");
        void refreshSync();
      }
      focusedOnce.current = true;
    }, [request, refreshSync]),
  );

  // One hotel-scoped subscription; a burst of events becomes one trailing read of the overview (the only thing re-read).
  useWorkOrderRealtime(user?.tenant_id, () => void request("realtime"));
  // Back from the background, or the connection returned: read again (through the same gate).
  useRefreshOnResume(isOnline, (reason) => {
    void request(reason);
    void refreshSync();
  });

  const state = resolveLoadState({ loading: overview.loading, failure: overview.failure, count: data ? 1 : 0, offline: !isOnline });
  const ready = state.status === "ready" && data != null;
  const basePriorities = useMemo(() => buildPriorities(data), [data]);
  // Saved work that is blocked, or still waiting to reach the server, means this is not a true all-clear.
  const unresolvedSync = blockedSync > 0 || sync.waiting > 0 || sync.attention > 0 || !sync.verified;
  const priorities = useMemo(() => (unresolvedSync ? { ...basePriorities, allClear: false } : basePriorities), [basePriorities, unresolvedSync]);
  const summary = useMemo(() => chiefSummary(data?.counts), [data]);
  const status = resolveSyncStatus({
    online: isOnline,
    pending: sync.waiting,
    attention: sync.attention,
    verified: sync.verified,
    sending: sync.sending,
    failed: overview.failure != null,
    refreshing: overview.refreshing,
    syncedAt: overview.syncedAt,
    now,
  });

  // A fresh token per tap: Work stays mounted, so identical params would otherwise be ignored the second time.
  const stamp = () => String(Date.now());
  const go = useCallback((route: unknown) => {
    if (route) router.push(route as never);
  }, []);

  // Server counts are exact for what the overview read; a cut-off read makes them lower bounds ("N+"); no answer is unknown.
  const cards: SummaryCardData[] = summary.map(({ key, value }) => ({
    key,
    label: t(SUMMARY_LABEL[key]),
    value: formatMetric(readMetric({ observed: value, complete: data?.truncated !== true, available: ready, stale: state.stale })),
    onPress: () => go(chiefSummaryRoute(key, stamp())),
    testID: SUMMARY_TEST_ID[key],
  }));
  const needsOwner = summary.find((s) => s.key === "needsOwner")?.value;
  const everyoneOwned = ready && needsOwner === 0 && !data?.truncated;

  const onOpenPriority = (item: PriorityItem) => go(priorityRoute(item));
  const onQuick = (key: ChiefQuickActionKey) => go(chiefQuickActionRoute(key, stamp()));
  const onPull = async () => {
    setPulling(true);
    try {
      await request("manual");
    } finally {
      setPulling(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.shell.bg }]}>
      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void onPull()} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <TechnicianHomeHeader
          name={name}
          greetingKey="home.chief.heading"
          heading={t("home.chief.heading")}
          hotelName={hotelName ?? null}
          roleLabel={t("home.chief.roleLine", { name: name.trim().split(/\s+/)[0] || name })}
          unreadCount={unreadCount}
          connection={{ status, hasQueue: data != null }}
        />

        <View style={styles.body}>
          <TechnicianSummaryCards cards={cards} />
          {everyoneOwned ? (
            <Text maxFontSizeMultiplier={HOME_MAX_FONT} style={[homeStyles.meta, { color: theme.textSecondary }]} testID="chief-all-owned">
              {t("home.chief.allOwned")}
            </Text>
          ) : null}

          {ready && data ? (
            <>
              {state.stale ? <StaleBanner onRetry={() => void request("manual")} /> : null}
              {blockedSync > 0 ? (
                <HomeLoadNotice message={t("home.engineer.syncBlockedTitle", { count: blockedSync })} actionLabel={t("home.chief.syncReview")} onPress={() => go(ENGINEERING_SYNC_ROUTE)} testID="chief-sync-blocked" />
              ) : null}
              <PropertyPriorities
                priorities={priorities}
                canAssign={canAssign}
                online={isOnline}
                truncated={data.truncated}
                onOpen={onOpenPriority}
                onAssign={(item) => setTarget(assignTargetFor(item.wo))}
                onViewAll={() => go(PRIORITIES_VIEW_ALL_ROUTE)}
                onRetry={() => void request("manual")}
              />
              <TeamWorkloadPreview technicians={data.technicians} onOpenTechnician={(id) => go(technicianRoute(id))} onViewTeam={() => go(TEAM_OVERVIEW_ROUTE)} />
              <ChiefOversight overview={data} onOpenRooms={() => go(ROOM_STATUS_ROUTE)} onOpenPmPlan={() => go(chiefQuickActionRoute("pm"))} />
            </>
          ) : (
            <View testID={overview.failure ? "chief-load-error" : "chief-load-state"}>
              <EngineeringState status={state.status} onRetry={() => void request("manual")} emptyTitle={t("engineeringTeam.empty")} style={styles.stateCard} />
            </View>
          )}

          <TechnicianQuickActions keys={chiefQuickActionKeys()} onOpen={onQuick} labelOverrides={{ pm: "home.chief.quickPm" }} />
        </View>
      </ScrollView>

      <AssignTechnicianSheet
        visible={target != null}
        target={target}
        scope={scope}
        online={isOnline}
        onClose={() => setTarget(null)}
        onNeedsRefresh={() => void request("manual")}
        onAssigned={(tech, changed) => toast.success(changed ? t("engineeringTeam.assign.done", { name: tech.name ?? t("engineeringTeam.technician") }) : t("engineeringTeam.assign.alreadyDone"))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32, gap: 14 },
  stateCard: { paddingVertical: 22, paddingHorizontal: 16, alignItems: "center", gap: 6 },
});
