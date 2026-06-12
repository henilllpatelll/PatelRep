import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
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
import { claimWorkOrder, listWorkOrders } from "@/lib/api/workOrders";
import { countQueueSignals, splitWorkbench, type WorkOrder } from "@/lib/engineering/workOrders";
import { C, R, shellTokens } from "@/components/shared/tokens";
import { WorkOrderCard } from "@/components/engineering/WorkOrderCard";

/* ─── Orders tab — one bench, one scroll ────────────────────────────────────
   No tabs to hop between: the engineer's own active work sits on top ("On
   your bench"), the open queue follows with inline Claim, other engineers'
   active orders give context, and finished work folds away at the bottom. */

type Row =
  | { type: "section"; key: string; title: string; hint?: string }
  | { type: "wo"; key: string; wo: WorkOrder; claimable: boolean }
  | { type: "doneToggle"; key: string }
  | { type: "queueEmpty"; key: string }
  | { type: "allEmpty"; key: string }
  | { type: "doneEmpty"; key: string };

export default function WorkOrdersScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isOnline, user } = useAppStore();
  const locale = user?.language_pref === "es" ? "es" : "en";

  const [open, setOpen] = useState<WorkOrder[]>([]);
  const [active, setActive] = useState<WorkOrder[]>([]);
  const [done, setDone] = useState<WorkOrder[]>([]);
  const [doneLoaded, setDoneLoaded] = useState(false);
  const [doneExpanded, setDoneExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const loadQueues = useCallback(async () => {
    const [openRes, progressRes, holdRes] = await Promise.allSettled([
      listWorkOrders("open"),
      listWorkOrders("in_progress"),
      listWorkOrders("on_hold"),
    ]);
    if (openRes.status === "fulfilled") setOpen(openRes.value);
    const progress = progressRes.status === "fulfilled" ? progressRes.value : [];
    const held = holdRes.status === "fulfilled" ? holdRes.value : [];
    setActive([...progress, ...held]);
  }, []);

  const loadDone = useCallback(async () => {
    try {
      setDone(await listWorkOrders("completed"));
      setDoneLoaded(true);
    } catch {
      setDone([]);
    }
  }, []);

  useEffect(() => {
    loadQueues().finally(() => setLoading(false));
  }, [loadQueues]);

  useEffect(() => {
    if (doneExpanded && !doneLoaded) loadDone();
  }, [doneExpanded, doneLoaded, loadDone]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("work-orders-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "work_orders", filter: `tenant_id=eq.${user.tenant_id}` },
        () => {
          loadQueues();
          if (doneLoaded) loadDone();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.tenant_id, loadQueues, loadDone, doneLoaded]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadQueues();
    if (doneLoaded) await loadDone();
    setRefreshing(false);
  }, [loadQueues, loadDone, doneLoaded]);

  const claim = useCallback(
    async (wo: WorkOrder) => {
      setClaimingId(wo.id);
      try {
        if (isOnline) {
          await claimWorkOrder(wo.id);
          await loadQueues();
        } else {
          await enqueueAction("work_order", "claim", {}, wo.id);
          setOpen((prev) => prev.filter((o) => o.id !== wo.id));
          setActive((prev) => [
            { ...wo, status: "in_progress", assigned_to: user?.id ?? null, started_at: new Date().toISOString() },
            ...prev,
          ]);
        }
      } catch (err) {
        console.warn("Claim failed:", err);
        await loadQueues();
      } finally {
        setClaimingId(null);
      }
    },
    [isOnline, loadQueues, user?.id]
  );

  const { bench, queue, team } = useMemo(
    () => splitWorkbench(open, active, user?.id),
    [open, active, user?.id]
  );

  // Hero signals — built from live open + active queues, nonzero only.
  const signals = useMemo(() => {
    const counts = countQueueSignals([...open, ...active]);
    return [
      counts.urgent > 0 && { key: "urgent", label: t("workOrders.signalUrgent", { count: counts.urgent }), fg: C.alert, bg: C.alertSoft, line: C.alertLine },
      counts.pastSla > 0 && { key: "sla", label: t("workOrders.signalPastSla", { count: counts.pastSla }), fg: C.alert, bg: C.alertSoft, line: C.alertLine },
      counts.guest > 0 && { key: "guest", label: t("workOrders.signalGuest", { count: counts.guest }), fg: C.info, bg: C.infoSoft, line: C.infoLine },
      counts.onHold > 0 && { key: "hold", label: t("workOrders.signalOnHold", { count: counts.onHold }), fg: C.caution, bg: C.cautionSoft, line: C.cautionLine },
    ].filter(Boolean) as { key: string; label: string; fg: string; bg: string; line: string }[];
  }, [open, active, t]);

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    if (bench.length === 0 && queue.length === 0 && team.length === 0) {
      list.push({ type: "allEmpty", key: "all-empty" });
    } else {
      if (bench.length > 0) {
        list.push({ type: "section", key: "s-bench", title: t("workOrders.sectionBench"), hint: String(bench.length) });
        for (const wo of bench) list.push({ type: "wo", key: wo.id, wo, claimable: false });
      }
      list.push({ type: "section", key: "s-queue", title: t("workOrders.sectionQueue"), hint: String(queue.length) });
      if (queue.length === 0) {
        list.push({ type: "queueEmpty", key: "queue-empty" });
      } else {
        for (const wo of queue) {
          list.push({ type: "wo", key: wo.id, wo, claimable: wo.status === "open" && !wo.assigned_to });
        }
      }
      if (team.length > 0) {
        list.push({ type: "section", key: "s-team", title: t("workOrders.sectionTeam"), hint: String(team.length) });
        for (const wo of team) list.push({ type: "wo", key: wo.id, wo, claimable: false });
      }
    }
    list.push({ type: "doneToggle", key: "done-toggle" });
    if (doneExpanded) {
      if (doneLoaded && done.length === 0) {
        list.push({ type: "doneEmpty", key: "done-empty" });
      } else {
        for (const wo of done) list.push({ type: "wo", key: wo.id, wo, claimable: false });
      }
    }
    return list;
  }, [bench, queue, team, done, doneExpanded, doneLoaded, t]);

  const header = (
    <View>
      <View style={styles.topBleed} />
      <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
        <View style={styles.heroTopRow}>
          <Text style={styles.heroKicker}>{t("workOrders.kicker")}</Text>
          <TouchableOpacity
            style={styles.heroRoomsBtn}
            onPress={() => router.push("/(app)/room-status" as never)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel={t("workOrders.allRooms")}
            testID="wo-all-rooms"
          >
            <Ionicons name="bed-outline" size={14} color={shellTokens.ink} />
            <Text style={styles.heroRoomsText}>{t("workOrders.allRooms")}</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.heroTitle}>{t("workOrders.title")}</Text>
        <Text style={styles.heroSummary}>
          {t("workOrders.summary", { open: open.length, active: active.length })}
        </Text>
        {signals.length > 0 ? (
          <View style={styles.signalRow}>
            {signals.map((signal) => (
              <View key={signal.key} style={[styles.signalChip, { backgroundColor: signal.bg, borderColor: signal.line }]}>
                <Text style={[styles.signalText, { color: signal.fg }]}>{signal.label}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.type) {
      case "section":
        return (
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>{item.title}</Text>
            {item.hint ? <Text style={styles.sectionHint}>{item.hint}</Text> : null}
          </View>
        );
      case "wo":
        return (
          <View style={styles.cardWrap}>
            <WorkOrderCard
              wo={item.wo}
              locale={locale}
              onPress={() => router.push(`/(app)/work-orders/${item.wo.id}`)}
              onClaim={item.claimable ? () => claim(item.wo) : undefined}
              claiming={claimingId === item.wo.id}
            />
          </View>
        );
      case "doneToggle":
        return (
          <TouchableOpacity
            style={styles.doneToggle}
            onPress={() => setDoneExpanded((prev) => !prev)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ expanded: doneExpanded }}
            testID="wo-done-toggle"
          >
            <Ionicons name="checkmark-done-outline" size={15} color={C.ink2} />
            <Text style={styles.doneToggleText}>{t("workOrders.sectionDone")}</Text>
            {doneLoaded && done.length > 0 ? (
              <Text style={styles.doneToggleHint}>{done.length}</Text>
            ) : null}
            <Ionicons
              name={doneExpanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={C.ink4}
              style={styles.doneChevron}
            />
          </TouchableOpacity>
        );
      case "queueEmpty":
        return (
          <View style={styles.inlineEmpty}>
            <Text style={styles.inlineEmptyTitle}>{t("workOrders.emptyOpen")}</Text>
            <Text style={styles.inlineEmptyHint}>{t("workOrders.emptyOpenHint")}</Text>
          </View>
        );
      case "doneEmpty":
        return (
          <View style={styles.inlineEmpty}>
            <Text style={styles.inlineEmptyTitle}>{t("workOrders.emptyDone")}</Text>
            <Text style={styles.inlineEmptyHint}>{t("workOrders.emptyDoneHint")}</Text>
          </View>
        );
      case "allEmpty":
        return (
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-outline" size={30} color={C.ink4} />
            <Text style={styles.emptyTitle}>{t("workOrders.emptyOpen")}</Text>
            <Text style={styles.emptyHint}>{t("workOrders.emptyOpenHint")}</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          renderItem={renderRow}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroKicker: {
    color: shellTokens.ink3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroRoomsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: shellTokens.raised,
    borderWidth: 1,
    borderColor: shellTokens.line,
    borderRadius: 999,
    paddingHorizontal: 11,
    minHeight: 32,
  },
  heroRoomsText: { color: shellTokens.ink, fontSize: 11.5, fontWeight: "700" },
  heroTitle: { color: shellTokens.ink, fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { color: shellTokens.ink2, fontSize: 13, marginTop: 7 },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  signalChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  signalText: { fontSize: 11, fontWeight: "800" },

  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 7,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 9,
  },
  sectionTitle: {
    color: C.ink3,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionHint: { color: C.ink4, fontSize: 11, fontWeight: "700" },

  cardWrap: { paddingHorizontal: 16, paddingBottom: 11 },

  doneToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 11,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface2,
  },
  doneToggleText: { color: C.ink2, fontSize: 13, fontWeight: "700" },
  doneToggleHint: { color: C.ink4, fontSize: 12, fontWeight: "700" },
  doneChevron: { marginLeft: "auto" },

  inlineEmpty: {
    marginHorizontal: 16,
    marginBottom: 11,
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line2,
    backgroundColor: C.surface2,
    alignItems: "center",
    gap: 3,
  },
  inlineEmptyTitle: { color: C.ink2, fontSize: 13, fontWeight: "700" },
  inlineEmptyHint: { color: C.ink4, fontSize: 12, textAlign: "center" },

  empty: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 32, gap: 7 },
  emptyTitle: { color: C.ink, fontSize: 15.5, fontWeight: "700", marginTop: 4 },
  emptyHint: { color: C.ink3, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
