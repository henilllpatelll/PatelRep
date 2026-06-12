import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
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
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { Avatar, CopilotHero, HeroButton } from "@/components/shared/mobileHandoff";
import { CATEGORY_META } from "@/components/engineering/WorkOrderCard";

/* ─── Engineer Home — the duty board ────────────────────────────────────────
   Everything here is live: the workload mosaic and signal chips come from the
   real open + active queues, the focus card is the engineer's actual bench
   (or the top of the queue), the AI card is a real unacknowledged failure
   prediction, and the PM strip (chief only) reads the real schedule. */

type PMScheduleLite = { id: string; status: "due" | "upcoming" | "overdue" | "completed" };

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
            : { bg: shellTokens.raised, line: shellTokens.line, fg: shellTokens.ink2 };
        const room = wo.rooms?.room_number ?? null;
        const categoryKey = wo.category && CATEGORY_META[wo.category] ? wo.category : "general";
        return (
          <TouchableOpacity
            key={wo.id}
            style={[mosaicStyles.tile, { backgroundColor: tone.bg, borderColor: tone.line }]}
            onPress={() => onPress(wo)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={wo.title}
          >
            {room ? (
              <Text style={[mosaicStyles.tileText, { color: tone.fg }]}>{room}</Text>
            ) : (
              <Ionicons name={CATEGORY_META[categoryKey].icon} size={14} color={tone.fg} />
            )}
          </TouchableOpacity>
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
  const { user, isOnline } = useAppStore();
  const role = user?.effective_role ?? user?.role;
  const isChief = role === "chief_engineer";

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
    ];
    if (isChief) {
      requests.push(api.get<{ data: PMScheduleLite[] }>("/engineering/pm-schedules"));
    }
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
  }, [isChief]);

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
    signals.urgent > 0 && { key: "urgent", label: t("workOrders.signalUrgent", { count: signals.urgent }), fg: "#E7A9B0" },
    signals.pastSla > 0 && { key: "sla", label: t("workOrders.signalPastSla", { count: signals.pastSla }), fg: "#E7A9B0" },
    signals.guest > 0 && { key: "guest", label: t("workOrders.signalGuest", { count: signals.guest }), fg: "#ACC9DB" },
    signals.onHold > 0 && { key: "hold", label: t("workOrders.signalOnHold", { count: signals.onHold }), fg: "#E4C174" },
  ].filter(Boolean) as { key: string; label: string; fg: string }[];

  const focusReason = (wo: WorkOrder): string => {
    if (wo.priority === "urgent") return t("home.engineer.reasonUrgent");
    if (wo.due_at && new Date(wo.due_at).getTime() < now.getTime()) return t("home.engineer.reasonOverdue");
    if (wo.guest_reported) return t("home.engineer.reasonGuest");
    return t("home.engineer.reasonDefault");
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={shellTokens.ink2} />}
      >
        <View style={styles.topBleed} />

        <View style={[styles.hero, { paddingTop: insets.top + 10 }]}>
          <View style={styles.heroTop}>
            <Avatar name={name} size={34} />
            <TouchableOpacity
              style={styles.bellBtn}
              onPress={() => router.push("/(app)/notifications" as never)}
              accessibilityRole="button"
              accessibilityLabel={t("tabs.notifications", { defaultValue: "Notifications" })}
            >
              <Ionicons name="notifications-outline" size={17} color={shellTokens.ink2} />
            </TouchableOpacity>
          </View>
          <Text style={styles.heroMeta}>
            {dynamicShiftMeta(user?.language_pref ?? "en", t("home.engineer.shiftMeta"))}
          </Text>
          <Text style={styles.heroTitle}>{t(getGreetingKey(), { name: firstName(name) })}</Text>
          <Text style={styles.heroSummary}>
            {t("home.engineer.summary", { open: queue.length, bench: bench.length })}
            {doneToday > 0 ? ` · ${t("home.engineer.closedToday", { count: doneToday })}` : ""}
          </Text>

          <WorkloadMosaic orders={watching} viewerId={user?.id} onPress={openOrder} />

          {signalChips.length > 0 ? (
            <View style={styles.signalRow}>
              {signalChips.map((chip) => (
                <View key={chip.key} style={styles.signalChip}>
                  <Text style={[styles.signalText, { color: chip.fg }]}>{chip.label}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          {focusOrder ? (
            <View style={styles.focusCard} testID="engineer-focus">
              <View style={styles.focusHead}>
                <Text style={styles.focusKicker}>
                  {focusIsBench ? t("home.engineer.benchKicker") : t("home.engineer.startKicker")}
                </Text>
                {elapsed != null ? (
                  <View style={styles.clockChip}>
                    <Ionicons name="stopwatch-outline" size={11} color={C.caution} />
                    <Text style={styles.clockText}>{formatDuration(elapsed)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.focusTitle} numberOfLines={2}>
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
                      <Text style={styles.focusMetaText}>{t(`workOrders.category.${categoryKey}`)}</Text>
                      {room ? (
                        <>
                          <View style={styles.metaDot} />
                          <Text style={styles.focusRoom}>{room}</Text>
                        </>
                      ) : text ? (
                        <>
                          <View style={styles.metaDot} />
                          <Text style={styles.focusMetaText} numberOfLines={1}>
                            {text}
                          </Text>
                        </>
                      ) : null}
                    </>
                  );
                })()}
              </View>
              {!focusIsBench ? <Text style={styles.focusReason}>{focusReason(focusOrder)}</Text> : null}
              {focusIsBench ? (
                <TouchableOpacity
                  style={styles.focusBtn}
                  onPress={() => openOrder(focusOrder)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  <Ionicons name="construct-outline" size={15} color="#fff" />
                  <Text style={styles.focusBtnText}>{t("home.engineer.openOrder")}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.focusBtn}
                  onPress={claimFocus}
                  disabled={busy === "claim"}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                >
                  {busy === "claim" ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="hand-right-outline" size={15} color="#fff" />
                      <Text style={styles.focusBtnText}>{t("workOrders.claimStart")}</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View style={styles.clearCard} testID="engineer-clear">
              <Ionicons name="checkmark-done-outline" size={26} color={C.ready} />
              <Text style={styles.clearTitle}>{t("home.engineer.benchClear")}</Text>
              <Text style={styles.clearHint}>{t("home.engineer.benchClearHint")}</Text>
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
              <Text style={styles.predictionText}>
                <Text style={styles.predictionStrong}>
                  {prediction.assets?.name ?? t("assets.fallbackAsset")}
                </Text>
                : {prediction.recommendation}
              </Text>
            </CopilotHero>
          ) : null}

          {isChief && (pm.overdue > 0 || pm.due > 0) ? (
            <TouchableOpacity
              style={styles.pmStrip}
              onPress={() => router.push("/(app)/pm-schedules" as never)}
              activeOpacity={0.85}
              accessibilityRole="button"
              testID="engineer-pm-strip"
            >
              <View style={styles.pmTile}>
                <Ionicons name="calendar-outline" size={16} color={C.caution} />
              </View>
              <View style={styles.pmBody}>
                <Text style={styles.pmTitle}>{t("home.engineer.pmTitle")}</Text>
                <Text style={styles.pmText}>
                  {t("home.engineer.pmAttention", { overdue: pm.overdue, due: pm.due })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={15} color={C.caution} />
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.ordersBtn}
            onPress={() => router.push("/(app)/work-orders" as never)}
            activeOpacity={0.85}
            accessibilityRole="button"
          >
            <Text style={styles.ordersBtnText}>{t("home.engineer.openOrders")}</Text>
            <Ionicons name="arrow-forward" size={15} color={C.accent} />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: shellTokens.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  scroll: { flex: 1, backgroundColor: C.paper },
  scrollContent: { flexGrow: 1 },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },

  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: R.md,
    backgroundColor: shellTokens.raised,
    borderWidth: 1,
    borderColor: shellTokens.line,
    alignItems: "center",
    justifyContent: "center",
  },
  heroMeta: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: shellTokens.ink3,
    marginBottom: 4,
  },
  heroTitle: { fontSize: 30, fontWeight: "600", lineHeight: 34, color: shellTokens.ink },
  heroSummary: { marginTop: 7, fontSize: 13.5, lineHeight: 19, color: shellTokens.ink2 },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  signalChip: {
    backgroundColor: shellTokens.surface,
    borderWidth: 1,
    borderColor: shellTokens.line,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  signalText: { fontSize: 11, fontWeight: "800" },

  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 13 },

  focusCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 16,
    gap: 9,
    shadowColor: C.ink,
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  focusHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  focusKicker: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: C.primary,
  },
  clockChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  clockText: { color: C.caution, fontSize: 12.5, fontWeight: "800", fontFamily: monoFont },
  focusTitle: { color: C.ink, fontSize: 18, fontWeight: "700", lineHeight: 24 },
  focusMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  focusCategoryTile: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  focusMetaText: { color: C.ink2, fontSize: 12.5, fontWeight: "700", maxWidth: 170 },
  metaDot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: C.ink4, marginHorizontal: 2 },
  focusRoom: { color: C.ink2, fontSize: 12.5, fontWeight: "700", fontFamily: monoFont },
  focusReason: { color: C.ink3, fontSize: 12.5, lineHeight: 17 },
  focusBtn: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: C.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    marginTop: 3,
  },
  focusBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  clearCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingVertical: 26,
    paddingHorizontal: 16,
    alignItems: "center",
    gap: 6,
  },
  clearTitle: { color: C.ink, fontSize: 15.5, fontWeight: "700" },
  clearHint: { color: C.ink3, fontSize: 12.5, textAlign: "center", lineHeight: 18 },

  predictionText: { color: "rgba(241,237,228,0.9)", fontSize: 14, lineHeight: 20 },
  predictionStrong: { fontWeight: "700", color: C.paper },

  pmStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.cautionSoft,
    borderWidth: 1,
    borderColor: C.cautionLine,
    borderRadius: R.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pmTile: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: C.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  pmBody: { flex: 1 },
  pmTitle: { color: C.ink, fontSize: 13.5, fontWeight: "700" },
  pmText: { color: C.caution, fontSize: 11.5, marginTop: 2, fontWeight: "600" },

  ordersBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    minHeight: 48,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.accentLine,
    backgroundColor: C.surface,
  },
  ordersBtnText: { color: C.accent, fontSize: 13.5, fontWeight: "800" },
});
