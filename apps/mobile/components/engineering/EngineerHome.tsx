import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/stores/appStore";
import { adaptPmSchedules } from "@/lib/engineering/pmSchedules";
import { canActOnWorkOrders } from "@/lib/engineering/roles";
import { buildHomeModel, resolveSyncStatus, type AttentionItem } from "@/lib/engineering/homeModel";
import { pickDraft, type FocusState } from "@/lib/engineering/homeFocus";
import { useEngineeringHome } from "@/lib/engineering/useEngineeringHome";
import { useEngineeringSyncSummary } from "@/lib/engineering/useEngineeringSyncSummary";
import { useWorkOrderRealtime } from "@/lib/engineering/useWorkOrderRealtime";
import { useRefreshOnResume } from "@/lib/engineering/useRefreshOnResume";
import { formatMetric, readMetric } from "@/lib/engineering/homeContract";
import { usePmSyncItems } from "@/lib/engineering/usePmSyncItems";
import { countBlockedPmSync } from "@/lib/engineering/pmSyncItems";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { getGreetingKey } from "@/lib/ai/companion";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import {
  attentionRoute,
  focusRoute,
  myJobsRoute,
  quickActionKeys,
  quickActionRoute,
  showsMyJobs,
  urgentWorkRoute,
  usesChiefHome,
  workViewRoute,
  type TechnicianQuickActionKey,
} from "@/lib/engineering/homeNavigation";
import { PM_LIST_ROUTE } from "@/lib/engineering/routes";
import { useTheme } from "@/lib/theme/useTheme";
import { ChiefEngineerHome } from "./home/chief/ChiefEngineerHome";
import { TechnicianHomeHeader } from "./home/TechnicianHomeHeader";
import { TechnicianSummaryCards, type SummaryCardData } from "./home/TechnicianSummaryCards";
import { TechnicianFocusCard } from "./home/TechnicianFocusCard";
import { TechnicianAttentionSection } from "./home/TechnicianAttentionSection";
import { TechnicianQuickActions } from "./home/TechnicianQuickActions";
import { HomeLoadNotice } from "./home/HomeLoadNotice";

/* ─── Engineering Home ──────────────────────────────────────────────────────
   Technician layout: compact header, three counts, one contextual primary card, Needs Attention, four shortcuts. The
   chief engineer has its own management Home (home/chief/ChiefEngineerHome); the dispatcher below picks by role, and the
   chief branches below stay only as a permission-safe fallback. Everything is live; a failed section reports its own error and is
   never rendered as "nothing to do". Opening this screen never changes a work order: every control only navigates. */

/** One Home per engineering role. The role is read live, so a role change swaps the whole screen (and drops its state). */
export function EngineerHome({ name }: { name: string }) {
  const user = useAppStore((s) => s.user);
  const role = user?.effective_role ?? user?.role;
  return usesChiefHome(role) ? <ChiefEngineerHome name={name} /> : <TechnicianHome name={name} />;
}

function TechnicianHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const role = user?.effective_role ?? user?.role;
  const canAct = canActOnWorkOrders(role);
  const hasMyJobs = showsMyJobs(role);
  const locale = user?.language_pref === "es" ? "es" : "en";
  const { hotelName } = useSettingsIdentity();
  useHotelTimezone();

  // The role is part of the scope: a role change starts from a clean slate and never reuses another role's queue.
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}:${role ?? "none"}` : null;
  const data = useEngineeringHome(scope, role);
  const syncItems = usePmSyncItems();
  const sync = useEngineeringSyncSummary(syncItems);
  const [now, setNow] = useState(() => new Date());

  // Minute tick keeps "synced 3 min ago" and overdue labels honest while the tab stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Tabs stay mounted: re-read when this one regains focus, but not on the very first focus (already loading).
  // Every refresh trigger goes through the data hook's gate: a read already running is joined, never doubled.
  const focusedOnce = useRef(false);
  const { request } = data;
  const { refresh: refreshSync } = sync;
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) {
        void request("focus");
        void refreshSync();
      }
      focusedOnce.current = true;
    }, [request, refreshSync]),
  );

  // One hotel-scoped subscription; a burst of events becomes one trailing read.
  useWorkOrderRealtime(user?.tenant_id, () => void request("realtime"));
  // Back from the background, or the connection returned: read again (through the same gate).
  useRefreshOnResume(isOnline, (reason) => {
    void request(reason);
    void refreshSync();
  });

  const pmViews = useMemo(() => adaptPmSchedules(data.pmRows, hotelTimezone, now), [data.pmRows, hotelTimezone, now]);
  const blockedSync = useMemo(() => countBlockedPmSync(syncItems.rows, syncItems.active), [syncItems.rows, syncItems.active]);
  const model = useMemo(
    () =>
      buildHomeModel(data.orders, pmViews, user?.id, now, {
        canAct,
        drafts: syncItems.drafts,
        blockedSync: syncItems.loaded ? blockedSync : 0,
        loaded: { queue: data.hasQueue, pm: data.hasPm, drafts: syncItems.loaded },
      }),
    [data.orders, data.hasQueue, data.hasPm, pmViews, user?.id, now, canAct, syncItems.drafts, syncItems.loaded, blockedSync],
  );
  const status = resolveSyncStatus({
    online: isOnline,
    pending: sync.waiting,
    attention: sync.attention,
    verified: sync.verified,
    sending: sync.sending,
    failed: data.queueFailure != null,
    refreshing: data.refreshing,
    syncedAt: data.syncedAt,
    now,
  });

  const queueState = resolveLoadState({
    loading: data.loading,
    failure: data.queueFailure,
    count: data.hasQueue ? 1 : 0,
    offline: !isOnline && !data.hasQueue,
  });
  const queueReady = queueState.status === "ready";
  // Counting rules live in homeContract.ts: an exact server count wins; otherwise the queue's count, which is only a
  // lower bound ("N+") when the read was cut off; with no answer at all the value is unknown, never zero.
  const queueStale = data.queueFailure != null;
  const exactMine = data.summary?.total != null ? data.summary.total - data.summary.waiting : null;
  const myJobsValue = formatMetric(
    readMetric({ exact: exactMine != null && exactMine >= 0 ? exactMine : null, observed: model.myJobs, complete: !data.truncated, available: queueReady, stale: queueStale }),
  );
  const urgentReading = readMetric({ observed: model.urgent, complete: !data.truncated, available: queueReady, stale: queueStale });
  const urgentValue = formatMetric(urgentReading);
  const pmValue = formatMetric(readMetric({ observed: model.pmDue, complete: true, available: data.hasPm, stale: data.pmFailure != null }));

  // A fresh token per tap: Work stays mounted, so identical params would otherwise be ignored the second time.
  const stamp = () => String(Date.now());
  const go = useCallback((route: unknown) => {
    if (route) router.push(route as never);
  }, []);

  const cards: SummaryCardData[] = [];
  if (hasMyJobs) {
    cards.push({ key: "myJobs", label: t("home.engineer.cardMyJobs"), value: myJobsValue, onPress: () => go(myJobsRoute(role, stamp())), testID: "summary-my-jobs" });
  }
  cards.push({
    key: "urgent",
    label: t("home.engineer.cardUrgent"),
    value: urgentValue,
    alert: queueReady && model.urgent > 0,
    onPress: () => go(urgentWorkRoute(stamp())),
    testID: "summary-urgent",
  });
  cards.push({ key: "pmDue", label: t("home.engineer.cardPmDue"), value: pmValue, onPress: () => go(PM_LIST_ROUTE), testID: "summary-pm-due" });

  const retry = () => {
    void data.request("manual");
    void sync.refresh();
  };

  // Offline (or failed) with no queue: a real saved PM draft can still be resumed; nothing else is invented.
  const offlineDraft: FocusState | null = useMemo(() => {
    if (queueReady || !canAct || !syncItems.loaded) return null;
    const pm = pickDraft(syncItems.drafts, pmViews, data.hasPm);
    return pm ? { kind: "resume_pm", pm } : null;
  }, [queueReady, canAct, syncItems.loaded, syncItems.drafts, pmViews, data.hasPm]);

  const onOpenAttention = (item: AttentionItem) => go(attentionRoute(item));
  const onQuick = (key: TechnicianQuickActionKey) => go(quickActionRoute(key, stamp()));
  const showAttention = queueReady || data.hasPm || model.attention.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: theme.shell.bg }]}>
      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => void Promise.all([data.refresh(), sync.refresh()])} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <TechnicianHomeHeader
          name={name}
          greetingKey={getGreetingKey(now)}
          hotelName={hotelName ?? null}
          roleLabel={t(canAct ? "home.engineer.roleTechnician" : "home.engineer.roleChief")}
          unreadCount={unreadCount}
          connection={{ status, hasQueue: data.hasQueue }}
        />

        <View style={styles.body}>
          <TechnicianSummaryCards cards={cards} />

          {data.queueFailure && queueReady ? <StaleBanner onRetry={retry} /> : null}

          {queueReady ? (
            <TechnicianFocusCard
              focus={model.focus}
              locale={locale}
              now={now}
              onPrimary={() => go(focusRoute(model.focus, stamp()))}
              onMoreActive={() => go(workViewRoute("mine", stamp()))}
            />
          ) : (
            <View style={styles.stack}>
              <View testID={data.queueFailure ? "engineer-load-error" : "engineer-queue-state"}>
                <EngineeringState status={queueState.status} onRetry={retry} emptyTitle={t("home.engineer.noActiveTitle")} style={styles.stateCard} />
              </View>
              {offlineDraft ? (
                <TechnicianFocusCard
                  focus={offlineDraft}
                  locale={locale}
                  now={now}
                  onPrimary={() => go(focusRoute(offlineDraft))}
                  onMoreActive={() => undefined}
                />
              ) : null}
            </View>
          )}

          {showAttention ? (
            <TechnicianAttentionSection
              items={model.attention}
              viewerId={user?.id}
              trusted={queueReady && data.hasPm && !data.truncated && sync.verified && sync.waiting === 0 && sync.attention === 0}
              onOpen={onOpenAttention}
            />
          ) : null}
          {data.pmFailure ? <HomeLoadNotice message={t("home.engineer.pmUnavailable")} actionLabel={t("common.retry")} onPress={retry} testID="pm-error" /> : null}

          <TechnicianQuickActions keys={quickActionKeys(role)} onOpen={onQuick} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32, gap: 14 },
  stack: { gap: 12 },
  stateCard: { paddingVertical: 22, paddingHorizontal: 16, alignItems: "center", gap: 6 },
});
