import { useCallback, useEffect, useMemo, useState, type ComponentProps } from "react";
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
import { dueState, sortQueue, type WorkOrder } from "@/lib/engineering/workOrders";
import { C, R, shellTokens } from "@/components/shared/tokens";
import { WorkOrderCard } from "@/components/engineering/WorkOrderCard";

/* ─── Orders tab — the engineering workbench queue ──────────────────────────
   Dark shell hero with the real shape of the day (open / urgent / guest /
   past-SLA signals), a working three-way segmented, and Evening Lobby work
   cards. Open orders can be claimed straight from the card. */

type Tab = "open" | "active" | "done";

const EMPTY_META: Record<Tab, { icon: ComponentProps<typeof Ionicons>["name"]; titleKey: string; hintKey: string }> = {
  open: { icon: "checkmark-done-outline", titleKey: "workOrders.emptyOpen", hintKey: "workOrders.emptyOpenHint" },
  active: { icon: "construct-outline", titleKey: "workOrders.emptyActive", hintKey: "workOrders.emptyActiveHint" },
  done: { icon: "moon-outline", titleKey: "workOrders.emptyDone", hintKey: "workOrders.emptyDoneHint" },
};

export default function WorkOrdersScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isOnline, user } = useAppStore();
  const locale = user?.language_pref === "es" ? "es" : "en";

  const [tab, setTab] = useState<Tab>("open");
  const [open, setOpen] = useState<WorkOrder[]>([]);
  const [active, setActive] = useState<WorkOrder[]>([]);
  const [done, setDone] = useState<WorkOrder[]>([]);
  const [doneLoaded, setDoneLoaded] = useState(false);
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
    if (tab === "done" && !doneLoaded) loadDone();
  }, [tab, doneLoaded, loadDone]);

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
    if (tab === "done") await loadDone();
    setRefreshing(false);
  }, [loadQueues, loadDone, tab]);

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
          setActive((prev) => [{ ...wo, status: "in_progress", assigned_to: user?.id ?? null }, ...prev]);
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

  const data = useMemo(() => {
    if (tab === "open") return sortQueue(open);
    if (tab === "active") return sortQueue(active);
    return done;
  }, [tab, open, active, done]);

  // Hero signals — built from live open + active queues, nonzero only.
  const signals = useMemo(() => {
    const watching = [...open, ...active];
    const urgent = watching.filter((wo) => wo.priority === "urgent").length;
    const guest = watching.filter((wo) => wo.guest_reported).length;
    const pastSla = watching.filter((wo) => dueState(wo, locale)?.kind === "overdue").length;
    const held = active.filter((wo) => wo.status === "on_hold").length;
    return [
      urgent > 0 && { key: "urgent", label: t("workOrders.signalUrgent", { count: urgent }), fg: C.alert, bg: C.alertSoft, line: C.alertLine },
      pastSla > 0 && { key: "sla", label: t("workOrders.signalPastSla", { count: pastSla }), fg: C.alert, bg: C.alertSoft, line: C.alertLine },
      guest > 0 && { key: "guest", label: t("workOrders.signalGuest", { count: guest }), fg: C.info, bg: C.infoSoft, line: C.infoLine },
      held > 0 && { key: "hold", label: t("workOrders.signalOnHold", { count: held }), fg: C.caution, bg: C.cautionSoft, line: C.cautionLine },
    ].filter(Boolean) as { key: string; label: string; fg: string; bg: string; line: string }[];
  }, [open, active, locale, t]);

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: "open", label: t("workOrders.tabOpen"), count: open.length },
    { key: "active", label: t("workOrders.tabActive"), count: active.length },
    { key: "done", label: t("workOrders.tabDone") },
  ];

  const empty = EMPTY_META[tab];

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

      <View style={styles.segmented} testID="wo-segmented">
        {tabs.map((item) => {
          const isActive = tab === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.segment, isActive && styles.segmentActive]}
              onPress={() => setTab(item.key)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.segmentLabel, isActive && styles.segmentLabelActive]}>
                {item.label}
                {item.count != null && item.count > 0 ? ` ${item.count}` : ""}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={C.accent} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          renderItem={({ item }) => (
            <View style={styles.cardWrap}>
              <WorkOrderCard
                wo={item}
                locale={locale}
                onPress={() => router.push(`/(app)/work-orders/${item.id}`)}
                onClaim={
                  tab === "open" && item.status === "open" && !item.assigned_to
                    ? () => claim(item)
                    : undefined
                }
                claiming={claimingId === item.id}
              />
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name={empty.icon} size={30} color={C.ink4} />
              <Text style={styles.emptyTitle}>{t(empty.titleKey)}</Text>
              <Text style={styles.emptyHint}>{t(empty.hintKey)}</Text>
            </View>
          }
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

  segmented: {
    flexDirection: "row",
    marginHorizontal: 18,
    marginTop: 14,
    marginBottom: 12,
    backgroundColor: C.surface3,
    borderRadius: R.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: R.md - 3,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentActive: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    shadowColor: C.ink,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  segmentLabel: { color: C.ink3, fontSize: 12.5, fontWeight: "700" },
  segmentLabelActive: { color: C.ink },

  cardWrap: { paddingHorizontal: 16, paddingBottom: 11 },
  empty: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 32, gap: 7 },
  emptyTitle: { color: C.ink, fontSize: 15.5, fontWeight: "700", marginTop: 4 },
  emptyHint: { color: C.ink3, fontSize: 12.5, textAlign: "center", lineHeight: 18 },
});
