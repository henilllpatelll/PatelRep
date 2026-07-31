import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";
import { api } from "@/lib/api/client";
import { claimWorkOrder, listWorkOrders } from "@/lib/api/workOrders";
import {
  acknowledgePrediction,
  createWorkOrderFromPrediction,
  getFailurePredictions,
  type FailurePrediction,
} from "@/lib/api/assets";
import {
  countQueueSignals,
  formatDuration,
  minutesSince,
  splitWorkbench,
  workOrderLocation,
  type WorkOrder,
} from "@/lib/engineering/workOrders";
import { getGreetingKey } from "@/lib/ai/companion";
import { dynamicShiftMeta } from "@/lib/utils/date";
import { R, monoFont } from "@/components/shared/tokens";
import { Avatar, CopilotHero, HeroButton } from "@/components/shared/mobileHandoff";
import { CATEGORY_META } from "@/components/engineering/WorkOrderCard";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge } from "@/components/ui/StatusBadge";

/* ─── Engineer Home — the duty board ────────────────────────────────────────
   Everything here is live: the workload mosaic and signal chips come from the
   real open + active queues, the focus card is the engineer's actual bench
   (or the top of the queue), the AI card is a real unacknowledged failure
   prediction, and the PM strip (chief only) reads the real schedule. */

type PMScheduleLite = { id: string; status: "due" | "upcoming" | "overdue" | "completed" };

const QUICK_LINKS = [
  { key: "orders", labelKey: "home.engineer.quickOrders", href: "/(app)/work-orders", icon: "construct-outline" },
  { key: "rooms", labelKey: "home.engineer.quickRooms", href: "/(app)/room-status", icon: "bed-outline" },
  { key: "assets", labelKey: "home.engineer.quickAssets", href: "/(app)/assets", icon: "cube-outline" },
  { key: "pm", labelKey: "home.engineer.quickPm", href: "/(app)/pm-schedules", icon: "calendar-outline" },
] as const;

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function isToday(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/** One tile per live work order — the engineer's version of the shift mosaic. */
function WorkloadMosaic({
  orders,
  viewerId,
  onPress,
}: {
  orders: WorkOrder[];
  viewerId: string | null | undefined;
  onPress: (wo: WorkOrder) => void;
}) {
  const theme = useTheme();
  const now = Date.now();
  if (orders.length === 0) return null;
  return (
    <View style={mosaicStyles.wrap}>
      {orders.map((wo) => {
        const overdue = wo.due_at != null && new Date(wo.due_at).getTime() < now;
        const hot = wo.priority === "urgent" || overdue;
        const mine = viewerId != null && wo.assigned_to === viewerId;
        const tone = hot
          ? { bg: "rgba(169, 54, 63, 0.22)", line: "rgba(231, 169, 176, 0.45)", fg: "#E7A9B0" }
          : mine
            ? { bg: "rgba(183, 121, 31, 0.24)", line: "rgba(228, 193, 116, 0.45)", fg: "#E4C174" }
            : { bg: theme.shell.raised, line: theme.shell.line, fg: theme.shell.ink2 };
        const room = wo.rooms?.room_number ?? null;
        const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
        return (
          <Pressable
            key={wo.id}
            style={[mosaicStyles.tile, { backgroundColor: tone.bg, borderColor: tone.line }]}
            onPress={() => onPress(wo)}
            accessibilityRole="button"
            accessibilityLabel={wo.title}
          >
            {room ? (
              <Text style={[mosaicStyles.tileText, { color: tone.fg }]}>{room}</Text>
            ) : (
              <Ionicons name={CATEGORY_META[categoryKey].icon} size={14} color={tone.fg} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const mosaicStyles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
  tile: {
    minWidth: 46,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  tileText: { fontSize: 12.5, fontWeight: "700", fontFamily: monoFont },
});

export function EngineerHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { user, isOnline } = useAppStore();

  const [open, setOpen] = useState<WorkOrder[]>([]);
  const [active, setActive] = useState<WorkOrder[]>([]);
  const [doneToday, setDoneToday] = useState(0);
  const [prediction, setPrediction] = useState<FailurePrediction | null>(null);
  const [pm, setPm] = useState<{ overdue: number; due: number }>({ overdue: 0, due: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<"claim" | "preempt" | "dismiss" | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    const requests: Promise<unknown>[] = [
      listWorkOrders("open"),
      listWorkOrders("in_progress"),
      listWorkOrders("on_hold"),
      listWorkOrders("completed"),
      getFailurePredictions(),
      api.get<{ data: PMScheduleLite[] }>("/assets/pm-schedules"),
    ];
    const [openRes, progressRes, holdRes, doneRes, predRes, pmRes] = await Promise.allSettled(requests);
    if (openRes.status === "fulfilled") setOpen(openRes.value as WorkOrder[]);
    const progress = progressRes.status === "fulfilled" ? (progressRes.value as WorkOrder[]) : [];
    const held = holdRes.status === "fulfilled" ? (holdRes.value as WorkOrder[]) : [];
    setActive([...progress, ...held]);
    if (doneRes.status === "fulfilled") {
      setDoneToday((doneRes.value as WorkOrder[]).filter((wo) => isToday(wo.completed_at)).length);
    }
    if (predRes.status === "fulfilled") {
      const preds = (predRes.value as { data: FailurePrediction[] }).data ?? [];
      setPrediction(preds.find((p) => !p.is_acknowledged) ?? null);
    }
    if (pmRes?.status === "fulfilled") {
      const schedules = (pmRes.value as { data: PMScheduleLite[] }).data ?? [];
      setPm({
        overdue: schedules.filter((s) => s.status === "overdue").length,
        due: schedules.filter((s) => s.status === "due").length,
      });
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Minute tick keeps the bench clock honest while the tab is open.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("engineer-home-wo")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${user.tenant_id}` },
        () => {
          load();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.tenant_id, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const watching = useMemo(() => [...active, ...open], [active, open]);
  const signals = useMemo(() => countQueueSignals(watching, now), [watching, now]);
  const { bench, queue } = useMemo(
    () => splitWorkbench(open, active, user?.id, now),
    [open, active, user?.id, now]
  );

  const benchOrder = bench.find((wo) => wo.status === "in_progress") ?? bench[0] ?? null;
  const focusOrder = benchOrder ?? queue[0] ?? null;
  const focusIsBench = benchOrder != null;
  const elapsed = benchOrder?.status === "in_progress" ? minutesSince(benchOrder.started_at, now) : null;

  const openOrder = useCallback((wo: WorkOrder) => {
    router.push(`/(app)/work-orders/${wo.id}`);
  }, []);

  const claimFocus = useCallback(async () => {
    if (!focusOrder || focusIsBench || busy) return;
    setBusy("claim");
    try {
      if (isOnline) {
        await claimWorkOrder(focusOrder.id);
        await load();
      } else {
        await enqueueAction("work_order", "claim", {}, focusOrder.id);
        setOpen((prev) => prev.filter((o) => o.id !== focusOrder.id));
        setActive((prev) => [
          { ...focusOrder, status: "in_progress", assigned_to: user?.id ?? null, started_at: new Date().toISOString() },
          ...prev,
        ]);
      }
      router.push(`/(app)/work-orders/${focusOrder.id}`);
    } catch (err) {
      console.warn("Claim failed:", err);
      await load();
    } finally {
      setBusy(null);
    }
  }, [focusOrder, focusIsBench, busy, isOnline, load, user?.id]);

  const handlePreempt = useCallback(async () => {
    if (!prediction || busy) return;
    setBusy("preempt");
    try {
      await createWorkOrderFromPrediction(prediction.id);
      setPrediction(null);
      await load();
    } catch {
      // Surfaceless failure is fine here — the card stays for retry.
    } finally {
      setBusy(null);
    }
  }, [prediction, busy, load]);

  const handleDismiss = useCallback(async () => {
    if (!prediction || busy) return;
    setBusy("dismiss");
    try {
      await acknowledgePrediction(prediction.id);
      setPrediction(null);
    } catch {
      // Keep the card on failure.
    } finally {
      setBusy(null);
    }
  }, [prediction, busy]);

  const signalChips = [
    signals.urgent > 0 && {
      key: "urgent",
      statusKey: "urgent" as const,
      label: t("workOrders.signalUrgent", { count: signals.urgent }),
    },
    signals.pastSla > 0 && {
      key: "sla",
      statusKey: "overdue" as const,
      label: t("workOrders.signalPastSla", { count: signals.pastSla }),
    },
    signals.guest > 0 && { key: "guest", label: t("workOrders.signalGuest", { count: signals.guest }) },
    signals.onHold > 0 && {
      key: "hold",
      statusKey: "onHold" as const,
      label: t("workOrders.signalOnHold", { count: signals.onHold }),
    },
  ].filter(Boolean) as { key: string; label: string; statusKey?: "urgent" | "overdue" | "onHold" }[];

  const focusReason = (wo: WorkOrder): string => {
    if (wo.priority === "urgent") return t("home.engineer.reasonUrgent");
    if (wo.due_at && new Date(wo.due_at).getTime() < now.getTime()) return t("home.engineer.reasonOverdue");
    if (wo.guest_reported) return t("home.engineer.reasonGuest");
    return t("home.engineer.reasonDefault");
  };

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.shell.bg }]}>
      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />

        <View style={[styles.hero, { paddingTop: insets.top + 10, backgroundColor: theme.shell.bg }]}>
          <View style={styles.heroTop}>
            <Avatar name={name} size={34} />
            <Pressable
              style={[styles.bellBtn, { backgroundColor: theme.shell.raised, borderColor: theme.shell.line }]}
              onPress={() => router.push("/(app)/notifications" as never)}
              accessibilityRole="button"
              accessibilityLabel={t("tabs.notifications", { defaultValue: "Notifications" })}
            >
              <Ionicons name="notifications-outline" size={17} color={theme.shell.ink2} />
            </Pressable>
          </View>
          <Text style={[styles.heroMeta, { color: theme.shell.ink3 }]}>
            {dynamicShiftMeta(user?.language_pref ?? "en", t("home.engineer.shiftMeta"))}
          </Text>
          <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t(getGreetingKey(), { name: firstName(name) })}</Text>
          <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>
            {t("home.engineer.summary", { open: queue.length, bench: bench.length })}
            {doneToday > 0 ? ` · ${t("home.engineer.closedToday", { count: doneToday })}` : ""}
          </Text>

          <WorkloadMosaic orders={watching} viewerId={user?.id} onPress={openOrder} />

          {signalChips.length > 0 ? (
            <View style={styles.signalRow}>
              {signalChips.map((chip) => (
                chip.statusKey ? (
                  <StatusBadge key={chip.key} statusKey={chip.statusKey} label={chip.label} />
                ) : (
                  <View
                    key={chip.key}
                    style={[styles.signalChip, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
                  >
                    <Text style={[styles.signalText, { color: theme.status.clean }]}>{chip.label}</Text>
                  </View>
                )
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          {focusOrder ? (
            <View testID="engineer-focus">
              <Card style={styles.focusCard}>
                <View style={styles.focusHead}>
                  <Text style={[styles.focusKicker, { color: theme.primary }]}>
                    {focusIsBench ? t("home.engineer.benchKicker") : t("home.engineer.startKicker")}
                  </Text>
                  {elapsed != null ? (
                    <View style={styles.clockChip}>
                      <Ionicons name="stopwatch-outline" size={11} color={theme.status.pickup} />
                      <Text style={[styles.clockText, { color: theme.status.pickup }]}>{formatDuration(elapsed)}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.focusTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                  {focusOrder.title}
                </Text>
                <View style={styles.focusMeta}>
                  {(() => {
                    const categoryKey =
                      focusOrder.category && CATEGORY_META[focusOrder.category] ? focusOrder.category : "general";
                    const category = CATEGORY_META[categoryKey];
                    const { room, text } = workOrderLocation(focusOrder);
                    return (
                      <>
                        <View style={[styles.focusCategoryTile, { backgroundColor: category.bg }]}>
                          <Ionicons name={category.icon} size={12} color={category.fg} />
                        </View>
                        <Text style={[styles.focusMetaText, { color: theme.textSecondary }]}>
                          {t(`workOrders.category.${categoryKey}`)}
                        </Text>
                        {room ? (
                          <>
                            <View style={[styles.metaDot, { backgroundColor: theme.textDisabled }]} />
                            <Text style={[styles.focusRoom, { color: theme.textSecondary }]}>{room}</Text>
                          </>
                        ) : text ? (
                          <>
                            <View style={[styles.metaDot, { backgroundColor: theme.textDisabled }]} />
                            <Text style={[styles.focusMetaText, { color: theme.textSecondary }]} numberOfLines={1}>
                              {text}
                            </Text>
                          </>
                        ) : null}
                      </>
                    );
                  })()}
                </View>
                {!focusIsBench ? (
                  <Text style={[styles.focusReason, { color: theme.textMuted }]}>{focusReason(focusOrder)}</Text>
                ) : null}
                {focusIsBench ? (
                  <Button
                    label={t("home.engineer.openOrder")}
                    icon="construct-outline"
                    onPress={() => openOrder(focusOrder)}
                    style={styles.focusBtn}
                  />
                ) : (
                  <Button
                    label={t("workOrders.claimStart")}
                    icon="hand-right-outline"
                    onPress={claimFocus}
                    loading={busy === "claim"}
                    style={styles.focusBtn}
                  />
                )}
              </Card>
            </View>
          ) : (
            <View testID="engineer-clear">
              <StateBlock
                status="empty"
                emptyIcon="checkmark-done-outline"
                emptyTitle={t("home.engineer.benchClear")}
                emptyBody={t("home.engineer.benchClearHint")}
                style={styles.clearCard}
              />
            </View>
          )}

          {prediction ? (
            <CopilotHero
              kicker={t("assets.predictionKicker")}
              confidence={prediction.risk_score}
              actions={
                <>
                  <HeroButton primary icon="construct-outline" onPress={handlePreempt}>
                    {busy === "preempt" ? t("assets.working") : t("assets.preempt")}
                  </HeroButton>
                  <HeroButton onPress={handleDismiss}>
                    {busy === "dismiss" ? t("assets.working") : t("assets.dismiss")}
                  </HeroButton>
                </>
              }
            >
              <Text style={[styles.predictionText, { color: theme.shell.ink2 }]}>
                <Text style={[styles.predictionStrong, { color: theme.shell.ink }]}>
                  {prediction.assets?.name ?? t("assets.fallbackAsset")}
                </Text>
                : {prediction.recommendation}
              </Text>
            </CopilotHero>
          ) : null}

          {pm.overdue > 0 || pm.due > 0 ? (
            <Pressable
              onPress={() => router.push("/(app)/pm-schedules" as never)}
              accessibilityRole="button"
              testID="engineer-pm-strip"
            >
              <Card
                style={[
                  styles.pmStrip,
                  {
                    backgroundColor: theme.status.pickupSoft,
                    borderColor: theme.status.pickupLine,
                    borderRadius: R.md,
                  },
                ]}
              >
                <View style={[styles.pmTile, { backgroundColor: theme.surface }]}>
                  <Ionicons name="calendar-outline" size={16} color={theme.status.pickup} />
                </View>
                <View style={styles.pmBody}>
                  <Text style={[styles.pmTitle, { color: theme.textPrimary }]}>{t("home.engineer.pmTitle")}</Text>
                  <Text style={[styles.pmText, { color: theme.status.pickup }]}>
                    {t("home.engineer.pmAttention", { overdue: pm.overdue, due: pm.due })}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={15} color={theme.status.pickup} />
              </Card>
            </Pressable>
          ) : null}

          <View style={styles.quickGrid}>
            {QUICK_LINKS.map((link) => (
              <Pressable
                key={link.key}
                onPress={() => router.push(link.href as never)}
                accessibilityRole="button"
              >
                <Card style={[styles.quickLink, { borderColor: theme.primaryLine }]}>
                  <Ionicons name={link.icon} size={16} color={theme.primaryAction} />
                  <Text style={[styles.quickLinkText, { color: theme.primaryAction }]}>{t(link.labelKey)}</Text>
                </Card>
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
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },

  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: R.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroMeta: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  heroTitle: { fontSize: 30, fontWeight: "600", lineHeight: 34 },
  heroSummary: { marginTop: 7, fontSize: 13.5, lineHeight: 19 },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  signalChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  signalText: { fontSize: 11, fontWeight: "800" },

  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 13 },

  focusCard: {
    gap: 9,
  },
  focusHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  focusKicker: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  clockChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  clockText: { fontSize: 12.5, fontWeight: "800", fontFamily: monoFont },
  focusTitle: { fontSize: 18, fontWeight: "700", lineHeight: 24 },
  focusMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  focusCategoryTile: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  focusMetaText: { fontSize: 12.5, fontWeight: "700", maxWidth: 170 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, marginHorizontal: 2 },
  focusRoom: { fontSize: 12.5, fontWeight: "700", fontFamily: monoFont },
  focusReason: { fontSize: 12.5, lineHeight: 17 },
  focusBtn: {
    marginTop: 3,
  },

  clearCard: {
    paddingVertical: 26,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 6,
  },

  predictionText: { fontSize: 14, lineHeight: 20 },
  predictionStrong: { fontWeight: "700" },

  pmStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pmTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  pmBody: { flex: 1 },
  pmTitle: { fontSize: 13.5, fontWeight: "700" },
  pmText: { fontSize: 11.5, marginTop: 2, fontWeight: "600" },

  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 9,
  },
  quickLink: {
    width: "48%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 48,
  },
  quickLinkText: { fontSize: 13.5, fontWeight: "800" },
});
