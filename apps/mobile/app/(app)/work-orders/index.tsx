import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { enqueueAction } from "@/lib/offline/db";
import { claimWorkOrder, listWorkOrders } from "@/lib/api/workOrders";
import { countQueueSignals, splitWorkbench, type WorkOrder } from "@/lib/engineering/workOrders";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { StateBlock } from "@/components/ui/StateBlock";
import { WorkOrderCard } from "@/components/engineering/WorkOrderCard";
import CreateWorkOrderModal from "@/components/engineering/CreateWorkOrderModal";

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
  const theme = useTheme();
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
  const [search, setSearch] = useState("");
  const [showCreateWo, setShowCreateWo] = useState(false);

  const loadQueues = useCallback(async () => {
    const [openRes, escalatedRes, progressRes, holdRes] = await Promise.allSettled([
      listWorkOrders("open"),
      listWorkOrders("escalated"),
      listWorkOrders("in_progress"),
      listWorkOrders("on_hold"),
    ]);
    if (openRes.status === "fulfilled") setOpen(openRes.value);
    const escalated = escalatedRes.status === "fulfilled" ? escalatedRes.value : [];
    const progress = progressRes.status === "fulfilled" ? progressRes.value : [];
    const held = holdRes.status === "fulfilled" ? holdRes.value : [];
    setActive([...escalated, ...progress, ...held]);
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

  // Reload queues whenever this tab gains focus so completed WOs don't linger.
  useFocusEffect(
    useCallback(() => {
      loadQueues();
    }, [loadQueues])
  );

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
      // Optimistic update for both online and offline paths
      setOpen((prev) => prev.filter((o) => o.id !== wo.id));
      setActive((prev) => [
        { ...wo, status: "in_progress", assigned_to: user?.id ?? null, started_at: new Date().toISOString() },
        ...prev,
      ]);
      try {
        if (isOnline) {
          await claimWorkOrder(wo.id);
          await loadQueues(); // confirm server state
        } else {
          await enqueueAction("work_order", "claim", {}, wo.id);
        }
      } catch (err) {
        console.warn("Claim failed:", err);
        await loadQueues(); // revert on failure
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

  const matchesSearch = useCallback(
    (wo: WorkOrder): boolean => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        wo.title.toLowerCase().includes(q) ||
        (wo.description ?? "").toLowerCase().includes(q) ||
        (wo.rooms?.room_number ?? "").includes(q)
      );
    },
    [search]
  );

  // Hero signals — built from live open + active queues, nonzero only.
  const signals = useMemo(() => {
    const counts = countQueueSignals([...open, ...active]);
    return [
      counts.urgent > 0 && {
        key: "urgent",
        label: t("workOrders.signalUrgent", { count: counts.urgent }),
        fg: theme.status.dirty,
        bg: theme.status.dirtySoft,
        line: theme.status.dirtyLine,
      },
      counts.pastSla > 0 && {
        key: "sla",
        label: t("workOrders.signalPastSla", { count: counts.pastSla }),
        fg: theme.status.dirty,
        bg: theme.status.dirtySoft,
        line: theme.status.dirtyLine,
      },
      counts.guest > 0 && {
        key: "guest",
        label: t("workOrders.signalGuest", { count: counts.guest }),
        fg: theme.status.clean,
        bg: theme.status.cleanSoft,
        line: theme.status.cleanLine,
      },
      counts.onHold > 0 && {
        key: "hold",
        label: t("workOrders.signalOnHold", { count: counts.onHold }),
        fg: theme.status.pickup,
        bg: theme.status.pickupSoft,
        line: theme.status.pickupLine,
      },
    ].filter(Boolean) as { key: string; label: string; fg: string; bg: string; line: string }[];
  }, [open, active, t, theme]);

  const rows = useMemo<Row[]>(() => {
    const filteredBench = bench.filter(matchesSearch);
    const filteredQueue = queue.filter(matchesSearch);
    const filteredTeam = team.filter(matchesSearch);
    const list: Row[] = [];
    if (filteredBench.length === 0 && filteredQueue.length === 0 && filteredTeam.length === 0 && !search) {
      list.push({ type: "allEmpty", key: "all-empty" });
    } else {
      if (filteredBench.length > 0) {
        list.push({ type: "section", key: "s-bench", title: t("workOrders.sectionBench"), hint: String(filteredBench.length) });
        for (const wo of filteredBench) list.push({ type: "wo", key: wo.id, wo, claimable: false });
      }
      if (!search || filteredQueue.length > 0) {
        list.push({ type: "section", key: "s-queue", title: t("workOrders.sectionQueue"), hint: String(filteredQueue.length) });
        if (filteredQueue.length === 0 && !search) {
          list.push({ type: "queueEmpty", key: "queue-empty" });
        } else {
          for (const wo of filteredQueue) {
            list.push({ type: "wo", key: wo.id, wo, claimable: wo.status === "open" && !wo.assigned_to });
          }
        }
      }
      if (filteredTeam.length > 0) {
        list.push({ type: "section", key: "s-team", title: t("workOrders.sectionTeam"), hint: String(filteredTeam.length) });
        for (const wo of filteredTeam) list.push({ type: "wo", key: wo.id, wo, claimable: false });
      }
    }
    list.push({ type: "doneToggle", key: "done-toggle" });
    if (doneExpanded) {
      const filteredDone = done.filter(matchesSearch);
      if (doneLoaded && filteredDone.length === 0) {
        list.push({ type: "doneEmpty", key: "done-empty" });
      } else {
        for (const wo of filteredDone) list.push({ type: "wo", key: wo.id, wo, claimable: false });
      }
    }
    return list;
  }, [bench, queue, team, done, doneExpanded, doneLoaded, search, matchesSearch, t]);

  const header = (
    <View>
      <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
      <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
        <View style={styles.heroTopRow}>
          <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>{t("workOrders.kicker")}</Text>
          <TouchableOpacity
            style={[styles.heroNewWoBtn, { backgroundColor: theme.primaryAction }]}
            onPress={() => setShowCreateWo(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            testID="wo-new"
          >
            <Ionicons name="add" size={14} color={theme.shell.ink} />
            <Text style={[styles.heroRoomsText, { color: theme.shell.ink }]}>{t("workOrders.newWorkOrder")}</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("workOrders.title")}</Text>
        <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>
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
      <View style={[styles.searchBar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Ionicons name="search-outline" size={15} color={theme.textDisabled} />
        <TextInput
          style={[styles.searchInput, { color: theme.textPrimary }]}
          value={search}
          onChangeText={setSearch}
          placeholder={t("workOrders.searchPlaceholder", { defaultValue: "Search work orders…" })}
          placeholderTextColor={theme.textDisabled}
          returnKeyType="search"
        />
        {search ? (
          <TouchableOpacity onPress={() => setSearch("")} hitSlop={8} accessibilityRole="button">
            <Ionicons name="close-circle" size={16} color={theme.textDisabled} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  const renderRow = ({ item }: { item: Row }) => {
    switch (item.type) {
      case "section":
        return (
          <View style={styles.sectionRow}>
            <Text style={[styles.sectionTitle, { color: theme.textMuted }]}>{item.title}</Text>
            {item.hint ? <Text style={[styles.sectionHint, { color: theme.textDisabled }]}>{item.hint}</Text> : null}
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
            style={[styles.doneToggle, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}
            onPress={() => setDoneExpanded((prev) => !prev)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ expanded: doneExpanded }}
            testID="wo-done-toggle"
          >
            <Ionicons name="checkmark-done-outline" size={15} color={theme.textSecondary} />
            <Text style={[styles.doneToggleText, { color: theme.textSecondary }]}>{t("workOrders.sectionDone")}</Text>
            {doneLoaded && done.length > 0 ? (
              <Text style={[styles.doneToggleHint, { color: theme.textDisabled }]}>{done.length}</Text>
            ) : null}
            <Ionicons
              name={doneExpanded ? "chevron-up" : "chevron-down"}
              size={14}
              color={theme.textDisabled}
              style={styles.doneChevron}
            />
          </TouchableOpacity>
        );
      case "queueEmpty":
        return (
          <StateBlock
            status="empty"
            emptyIcon="list-outline"
            emptyTitle={t("workOrders.emptyOpen")}
            emptyBody={t("workOrders.emptyOpenHint")}
            style={[styles.inlineEmpty, { borderColor: theme.borderSubtle, backgroundColor: theme.surfaceSubtle }]}
          />
        );
      case "doneEmpty":
        return (
          <StateBlock
            status="empty"
            emptyIcon="checkmark-done-outline"
            emptyTitle={t("workOrders.emptyDone")}
            emptyBody={t("workOrders.emptyDoneHint")}
            style={[styles.inlineEmpty, { borderColor: theme.borderSubtle, backgroundColor: theme.surfaceSubtle }]}
          />
        );
      case "allEmpty":
        return (
          <StateBlock
            status="empty"
            emptyIcon="checkmark-done-outline"
            emptyTitle={t("workOrders.emptyOpen")}
            emptyBody={t("workOrders.emptyOpenHint")}
            style={styles.empty}
          />
        );
      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {loading ? (
        <View style={styles.center}>
          <StateBlock status="loading" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.key}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
          renderItem={renderRow}
        />
      )}
      <CreateWorkOrderModal
        visible={showCreateWo}
        onClose={() => setShowCreateWo(false)}
        onCreated={() => {
          setShowCreateWo(false);
          loadQueues();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  listContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroNewWoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 11,
    minHeight: 32,
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroRoomsText: { fontSize: 11.5, fontWeight: "700" },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { fontSize: 13, marginTop: 7 },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginTop: 12 },
  signalChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3.5,
  },
  signalText: { fontSize: 11, fontWeight: "800" },

  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: R.md,
  },
  searchInput: { flex: 1, fontSize: 13.5, paddingVertical: 0 },

  sectionRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 7,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 9,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  sectionHint: { fontSize: 11, fontWeight: "700" },

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
  },
  doneToggleText: { fontSize: 13, fontWeight: "700" },
  doneToggleHint: { fontSize: 12, fontWeight: "700" },
  doneChevron: { marginLeft: "auto" },

  inlineEmpty: {
    marginHorizontal: 16,
    marginBottom: 11,
    borderRadius: R.md,
    borderWidth: 1,
  },

  empty: { paddingVertical: 52 },
});
