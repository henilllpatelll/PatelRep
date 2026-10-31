import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { adaptPmSchedules } from "@/lib/engineering/pmSchedules";
import { canActOnWorkOrders } from "@/lib/engineering/roles";
import { buildHomeModel, resolveSyncStatus, type AttentionItem } from "@/lib/engineering/homeModel";
import { useEngineeringHome } from "@/lib/engineering/useEngineeringHome";
import { resolveLoadState } from "@/lib/engineering/loadState";
import { dueState, formatClock, formatDuration, workOrderLocation, type WorkOrder } from "@/lib/engineering/workOrders";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { useSettingsIdentity } from "@/lib/settings/useSettingsIdentity";
import { getGreetingKey } from "@/lib/ai/companion";
import { EngineeringState, StaleBanner } from "@/components/engineering/EngineeringState";
import { CATEGORY_META } from "@/components/engineering/WorkOrderCard";
import { Avatar } from "@/components/shared/mobileHandoff";
import { R, monoFont } from "@/components/shared/tokens";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { useTheme } from "@/lib/theme/useTheme";

/* ─── Engineer Home — the technician's start of shift ───────────────────────
   Header (hotel + honest sync state), three counts, the job to continue,
   what needs attention, four quick actions. Everything is live and comes from
   one deduplicated queue (see lib/engineering/homeModel.ts). A failed section
   shows its own error with Retry; it never reads as "nothing to do". */

const MAX_FONT = 1.4;
const MIN_TOUCH = 48;
const ATTENTION_LIMIT = 5;

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const QUICK_ACTIONS: { key: string; labelKey: string; icon: IconName; go: () => void }[] = [
  {
    key: "report",
    labelKey: "home.engineer.quickReport",
    icon: "alert-circle-outline",
    // The Work tab opens its existing create-work-order sheet when it receives a fresh `new` value.
    go: () => router.push({ pathname: "/(app)/work-orders", params: { new: String(Date.now()) } } as never),
  },
  { key: "room", labelKey: "home.engineer.quickRoom", icon: "bed-outline", go: () => router.push("/(app)/room-status" as never) },
  // There is no scanner in the app yet, so this opens the asset list and search instead of pretending to scan.
  { key: "asset", labelKey: "home.engineer.quickAsset", icon: "search-outline", go: () => router.push("/(app)/assets" as never) },
  { key: "pm", labelKey: "home.engineer.quickPm", icon: "calendar-outline", go: () => router.push("/(app)/pm-schedules" as never) },
];

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function SummaryCard({
  label,
  value,
  tone,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  tone?: "alert";
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const color = tone === "alert" ? theme.status.dirty : theme.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value === "—" ? t("home.engineer.unavailable") : value}`}
      testID={testID}
      style={[styles.summary, { backgroundColor: theme.surface, borderColor: theme.border }]}
    >
      <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.summaryValue, { color }]}>
        {value}
      </Text>
      <Text maxFontSizeMultiplier={MAX_FONT} numberOfLines={1} style={[styles.summaryLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function SectionTitle({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT} accessibilityRole="header" style={[styles.sectionTitle, { color: theme.textMuted }]}>
      {children}
    </Text>
  );
}

export function EngineerHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const hotelTimezone = useAppStore((s) => s.hotelTimezone);
  const unreadCount = useAppStore((s) => s.unreadCount);
  const pendingCount = useAppStore((s) => s.pendingActions.length);
  const role = user?.effective_role ?? user?.role;
  const canAct = canActOnWorkOrders(role);
  const locale = user?.language_pref === "es" ? "es" : "en";
  const { hotelName } = useSettingsIdentity();
  useHotelTimezone();

  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const data = useEngineeringHome(scope);
  const [now, setNow] = useState(() => new Date());

  // Minute tick keeps "synced 3 min ago" and overdue labels honest while the tab stays open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Tabs stay mounted: re-read when this one regains focus, but not on the very first focus (already loading).
  const focusedOnce = useRef(false);
  const { reload } = data;
  useFocusEffect(
    useCallback(() => {
      if (focusedOnce.current) void reload();
      focusedOnce.current = true;
    }, [reload]),
  );

  useEffect(() => {
    if (!user?.tenant_id) return undefined;
    const channel = supabase
      .channel("engineer-home-wo")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${user.tenant_id}` }, () => {
        void reload();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.tenant_id, reload]);

  const pmViews = useMemo(() => adaptPmSchedules(data.pmRows, hotelTimezone, now), [data.pmRows, hotelTimezone, now]);
  const model = useMemo(() => buildHomeModel(data.orders, pmViews, user?.id, now), [data.orders, pmViews, user?.id, now]);
  const sync = resolveSyncStatus({
    online: isOnline,
    pending: pendingCount,
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
  const plus = data.truncated ? "+" : "";
  const queueValue = (n: number) => (queueReady ? `${n}${plus}` : "—");
  const pmValue = data.hasPm ? String(model.pmDue) : "—";

  const syncText = (() => {
    const minutes = sync.minutes ?? 0;
    const ago = minutes < 1 ? t("home.engineer.syncJustNow") : t("home.engineer.syncMinutes", { minutes });
    switch (sync.kind) {
      case "offline":
        return sync.minutes != null ? t("home.engineer.syncOfflineSince", { ago }) : t("home.engineer.syncOffline");
      case "syncing":
        return t("home.engineer.syncSyncing");
      case "failed":
        return data.hasQueue ? t("home.engineer.syncFailed") : t("home.engineer.syncFailedEmpty");
      case "pending":
        return t("home.engineer.syncPending", { count: sync.pending });
      case "unsynced":
        return t("home.engineer.syncNone");
      default:
        return t("home.engineer.syncDone", { ago });
    }
  })();
  const syncIcon: IconName =
    sync.kind === "synced" ? "checkmark-circle-outline" : sync.kind === "offline" ? "cloud-offline-outline" : sync.kind === "syncing" ? "sync-outline" : "alert-circle-outline";

  const openOrder = useCallback((id: string) => router.push(`/(app)/work-orders/${id}` as never), []);
  const openWork = useCallback(() => router.push("/(app)/work-orders" as never), []);
  const openPm = useCallback(() => router.push("/(app)/pm-schedules" as never), []);

  const attention = model.attention.slice(0, ATTENTION_LIMIT);
  const attentionHidden = model.attention.length - attention.length;

  function activeCard(wo: WorkOrder) {
    const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
    const { room, text } = workOrderLocation(wo);
    const where = room ? t("home.engineer.roomLabel", { room }) : text;
    const due = dueState(wo, locale, now);
    const started = formatClock(wo.started_at, locale);
    const heading = [wo.work_order_number, where].filter(Boolean).join(" · ");
    return (
      <Card style={styles.continueCard} testID="engineer-focus">
        <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.kicker, { color: theme.primary }]}>
          {t("home.engineer.continueKicker")}
        </Text>
        {heading ? (
          <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.heading, { color: theme.textSecondary }]} numberOfLines={1}>
            {heading}
          </Text>
        ) : null}
        <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.focusTitle, { color: theme.textPrimary }]} numberOfLines={3}>
          {wo.title}
        </Text>
        <View style={styles.badgeRow}>
          {wo.priority === "emergency" || wo.priority === "urgent" ? (
            <StatusBadge statusKey="urgent" label={t(`home.engineer.priority.${wo.priority}`)} />
          ) : null}
          <StatusBadge statusKey="pickup" label={t("workOrders.status.in_progress")} />
          <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.meta, { color: theme.textSecondary }]}>
            {t(`workOrders.category.${categoryKey}`)}
            {wo.guest_reported ? ` · ${t("workOrders.chipGuest")}` : ""}
          </Text>
        </View>
        <View style={styles.badgeRow}>
          {started ? (
            <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.meta, { color: theme.textSecondary }]}>
              {t("home.engineer.startedAt", { time: started })}
            </Text>
          ) : null}
          {due?.kind === "overdue" ? (
            <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.meta, { color: theme.status.dirty, fontWeight: "700" }]}>
              {t("home.engineer.overdueBy", { duration: formatDuration(due.minutes) })}
            </Text>
          ) : due?.kind === "due" ? (
            <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.meta, { color: theme.textSecondary }]}>
              {t("home.engineer.dueAt", { time: due.clock })}
            </Text>
          ) : null}
        </View>
        <Button
          label={canAct ? t("home.engineer.continueRepair") : t("home.engineer.viewOrder")}
          icon="construct-outline"
          onPress={() => openOrder(wo.id)}
          accessibilityLabel={`${canAct ? t("home.engineer.continueRepair") : t("home.engineer.viewOrder")}: ${wo.title}`}
          testID="engineer-continue"
        />
        {model.moreActive > 0 ? (
          <Pressable onPress={openWork} accessibilityRole="button" style={styles.linkRow} testID="engineer-more-active">
            <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.link, { color: theme.primaryAction }]}>
              {t("home.engineer.moreActive", { count: model.moreActive })}
            </Text>
          </Pressable>
        ) : null}
      </Card>
    );
  }

  function attentionRow(item: AttentionItem) {
    const isWo = item.kind === "wo";
    const reasonKey = item.reason === "urgent_unassigned" ? "urgentUnassigned" : item.reason === "past_due" ? "pastDue" : item.reason === "pm_overdue" ? "pmOverdue" : item.reason === "on_hold" ? "onHold" : "emergency";
    let where: string | null = null;
    let title = "";
    let detail: string | null = null;
    if (isWo) {
      const loc = workOrderLocation(item.wo);
      where = loc.room ? t("home.engineer.roomLabel", { room: loc.room }) : loc.text;
      title = item.wo.title;
      detail = !item.wo.assigned_to ? t("home.engineer.notAssigned") : item.wo.assigned_to === user?.id ? t("home.engineer.assignedToYou") : null;
    } else {
      where = item.pm.assetName;
      title = item.pm.name;
      detail = t("home.engineer.pmDaysOverdue", { days: Math.abs(item.pm.daysUntilDue ?? 0) });
    }
    const hot = item.reason === "emergency" || item.reason === "urgent_unassigned" || item.reason === "pm_overdue";
    const heading = [t(`home.engineer.reason.${reasonKey}`), where].filter(Boolean).join(" · ");
    return (
      <Pressable
        key={item.key}
        onPress={() => (isWo ? openOrder(item.wo.id) : openPm())}
        accessibilityRole="button"
        accessibilityLabel={[heading, title, detail].filter(Boolean).join(". ")}
        testID={`attention-${item.key}`}
        style={[styles.attentionRow, { backgroundColor: theme.surface, borderColor: theme.border }]}
      >
        <View style={[styles.attentionBar, { backgroundColor: hot ? theme.status.dirty : theme.status.pickup }]} />
        <View style={styles.attentionBody}>
          <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.attentionHeading, { color: hot ? theme.status.dirty : theme.status.pickup }]} numberOfLines={1}>
            {heading}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.attentionTitle, { color: theme.textPrimary }]} numberOfLines={2}>
            {title}
          </Text>
          {detail ? (
            <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.meta, { color: theme.textMuted }]}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={16} color={theme.textMuted} />
      </Pressable>
    );
  }

  const retry = () => void data.reload();

  return (
    <View style={[styles.container, { backgroundColor: theme.shell.bg }]}>
      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={data.refreshing} onRefresh={() => void data.refresh()} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <View style={[styles.hero, { paddingTop: insets.top + 10, backgroundColor: theme.shell.bg }]}>
          <View style={styles.heroTop}>
            <Pressable onPress={() => router.push("/(app)/profile" as never)} accessibilityRole="button" accessibilityLabel={t("tabs.profile")} hitSlop={6}>
              <Avatar name={name} size={34} />
            </Pressable>
            <Pressable
              style={[styles.bellBtn, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}
              onPress={() => router.push("/(app)/notifications" as never)}
              accessibilityRole="button"
              accessibilityLabel={unreadCount > 0 ? t("home.engineer.notificationsUnread", { count: unreadCount }) : t("tabs.notifications", { defaultValue: "Notifications" })}
              testID="engineer-bell"
            >
              <Ionicons name="notifications-outline" size={18} color={theme.shell.ink2} />
              {unreadCount > 0 ? (
                <View style={[styles.bellDot, { backgroundColor: theme.status.dirty }]}>
                  <Text maxFontSizeMultiplier={1} style={styles.bellDotText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
                </View>
              ) : null}
            </Pressable>
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.heroMeta, { color: theme.shell.ink3 }]}>
            {t("home.engineer.headerLabel")}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.heroTitle, { color: theme.shell.ink }]}>
            {t(getGreetingKey(now), { name: firstName(name) })}
          </Text>
          {hotelName ? (
            <Text maxFontSizeMultiplier={MAX_FONT} numberOfLines={1} style={[styles.heroHotel, { color: theme.shell.ink2 }]} testID="engineer-hotel">
              {hotelName}
            </Text>
          ) : null}
          <View style={styles.syncRow} accessibilityLiveRegion="polite" testID="engineer-sync">
            <Ionicons name={syncIcon} size={13} color={theme.shell.ink3} />
            <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.syncText, { color: theme.shell.ink3 }]}>
              {syncText}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.summaryRow}>
            <SummaryCard label={t("home.engineer.cardMyJobs")} value={queueValue(model.myJobs)} onPress={openWork} testID="summary-my-jobs" />
            <SummaryCard label={t("home.engineer.cardUrgent")} value={queueValue(model.urgent)} tone={queueReady && model.urgent > 0 ? "alert" : undefined} onPress={openWork} testID="summary-urgent" />
            <SummaryCard label={t("home.engineer.cardPmDue")} value={pmValue} onPress={openPm} testID="summary-pm-due" />
          </View>

          {data.queueFailure && queueReady ? <StaleBanner onRetry={retry} /> : null}

          {queueReady ? (
            model.activeJob ? (
              activeCard(model.activeJob)
            ) : (
              <Card style={styles.continueCard} testID="engineer-no-active">
                <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.focusTitle, { color: theme.textPrimary }]}>
                  {t("home.engineer.noActiveTitle")}
                </Text>
                <Button label={t("home.engineer.viewWork")} icon="list-outline" variant="secondary" onPress={openWork} testID="engineer-view-work" />
              </Card>
            )
          ) : (
            <View testID={data.queueFailure ? "engineer-load-error" : "engineer-queue-state"}>
              <EngineeringState
                status={queueState.status}
                onRetry={retry}
                emptyTitle={t("home.engineer.noActiveTitle")}
                style={styles.stateCard}
              />
            </View>
          )}

          {queueReady || data.hasPm ? <SectionTitle>{t("home.engineer.attentionTitle")}</SectionTitle> : null}
          {queueReady || data.hasPm ? (
            <View style={styles.list}>
              {attention.length > 0 ? (
                attention.map(attentionRow)
              ) : queueReady && data.hasPm ? (
                <Card style={styles.emptyRow} testID="attention-empty">
                  <Ionicons name="checkmark-done-outline" size={18} color={theme.status.ready} />
                  <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.meta, { color: theme.textSecondary }]}>
                    {t("home.engineer.attentionEmpty")}
                  </Text>
                </Card>
              ) : null}
              {attentionHidden > 0 ? (
                <Pressable onPress={openWork} accessibilityRole="button" style={styles.linkRow} testID="attention-more">
                  <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.link, { color: theme.primaryAction }]}>
                    {t("home.engineer.attentionMore", { count: attentionHidden })}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {data.pmFailure ? (
            <Pressable onPress={retry} accessibilityRole="button" style={[styles.emptyRow, styles.pmError, { borderColor: theme.status.pickupLine, backgroundColor: theme.status.pickupSoft }]} testID="pm-error">
              <Ionicons name="alert-circle-outline" size={16} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.meta, { color: theme.status.pickup, flex: 1 }]}>
                {t("home.engineer.pmUnavailable")}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT} style={[styles.link, { color: theme.status.pickup }]}>{t("common.retry")}</Text>
            </Pressable>
          ) : null}

          <SectionTitle>{t("home.engineer.quickTitle")}</SectionTitle>
          <View style={styles.quickGrid}>
            {QUICK_ACTIONS.map((action) => (
              <Pressable
                key={action.key}
                onPress={action.go}
                accessibilityRole="button"
                accessibilityLabel={t(action.labelKey)}
                testID={`quick-${action.key}`}
                style={[styles.quick, { backgroundColor: theme.surface, borderColor: theme.primaryLine }]}
              >
                <Ionicons name={action.icon} size={20} color={theme.primaryAction} />
                <Text maxFontSizeMultiplier={MAX_FONT} numberOfLines={2} style={[styles.quickText, { color: theme.primaryAction }]}>
                  {t(action.labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>
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
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26 },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  bellBtn: { width: MIN_TOUCH - 4, height: MIN_TOUCH - 4, borderRadius: R.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  bellDot: { position: "absolute", top: -4, right: -4, minWidth: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 3 },
  bellDotText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  heroMeta: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 },
  heroTitle: { fontSize: 28, fontWeight: "600", lineHeight: 34 },
  heroHotel: { marginTop: 4, fontSize: 14, fontWeight: "600" },
  syncRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, minHeight: 20 },
  syncText: { fontSize: 12.5 },
  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 32, gap: 12 },
  summaryRow: { flexDirection: "row", gap: 10 },
  summary: { flex: 1, minHeight: 72, borderWidth: 1, borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center", justifyContent: "center", gap: 2 },
  summaryValue: { fontSize: 26, fontWeight: "700", fontFamily: monoFont },
  summaryLabel: { fontSize: 12, fontWeight: "700" },
  sectionTitle: { fontSize: 11.5, fontWeight: "800", letterSpacing: 0.9, textTransform: "uppercase", marginTop: 6 },
  continueCard: { gap: 10 },
  kicker: { fontSize: 10.5, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  heading: { fontSize: 12.5, fontWeight: "700", fontFamily: monoFont },
  focusTitle: { fontSize: 19, fontWeight: "700", lineHeight: 25 },
  badgeRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  meta: { fontSize: 12.5, lineHeight: 17 },
  linkRow: { minHeight: MIN_TOUCH - 8, justifyContent: "center" },
  link: { fontSize: 13, fontWeight: "800" },
  stateCard: { paddingVertical: 22, paddingHorizontal: 16, alignItems: "center", gap: 6 },
  list: { gap: 8 },
  attentionRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: R.md, paddingRight: 12, minHeight: 64, overflow: "hidden" },
  attentionBar: { width: 4, alignSelf: "stretch" },
  attentionBody: { flex: 1, paddingVertical: 10, gap: 2 },
  attentionHeading: { fontSize: 11.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  attentionTitle: { fontSize: 15, fontWeight: "600", lineHeight: 20 },
  emptyRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: MIN_TOUCH },
  pmError: { borderWidth: 1, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 8 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  quick: { flexBasis: "47%", flexGrow: 1, minHeight: 60, borderWidth: 1, borderRadius: R.md, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  quickText: { flex: 1, fontSize: 14, fontWeight: "800" },
});
