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
import { api } from "@/lib/api/client";
import { getRooms, upsertRooms } from "@/lib/offline/db";
import { localDate } from "@/lib/utils/date";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, R, monoFont } from "@/components/shared/tokens";
import {
  Avatar,
  CopilotHero,
  HandoffRow,
  HeroButton,
  IconButton,
  Mono,
  Pill,
  ProgressRing,
  SectionLabel,
} from "@/components/shared/mobileHandoff";
import { AIBriefingCard, RoomQueueCard, SectionHeader } from "@/components/shared/evening";
import { buildLocalBriefing, buildSmartQueue, fetchShiftBriefing, getStartEntry, type ShiftBriefing } from "@/lib/ai/briefing";
import { getRoomQueueBucket } from "@/lib/housekeeping/roomWorkflow";

const ENGINEER_ORDERS = [
  { id: "WO-1141", title: "Replace fan-coil belt", loc: "R-209 - zone B", pri: "HIGH", tone: "alert" as const, meta: "22m", active: true },
  { id: "WO-1138", title: "Reseat toilet flange", loc: "R-144", pri: "MED", tone: "caution" as const, meta: "queued" },
  { id: "WO-1135", title: "Pool pump pressure check", loc: "Mech room", pri: "LOW", tone: "info" as const, meta: "queued" },
];

const DONE_STATUSES = new Set(["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function dynamicShiftMeta(languagePref: string, suffix: string): string {
  const now = new Date();
  const locale = languagePref === "es" ? "es-MX" : "en-US";
  const weekday = now.toLocaleDateString(locale, { weekday: "short" });
  const month = now.toLocaleDateString(locale, { month: "short" });
  return `${weekday} · ${month} ${now.getDate()} · ${suffix}`;
}

export default function HousekeeperHomeScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { user, isOnline, myRooms, setMyRooms } = useAppStore();
  const effectiveRole = user?.effective_role ?? user?.role;
  const isEngineer = effectiveRole === "engineer" || effectiveRole === "chief_engineer";
  const [loading, setLoading] = useState(myRooms.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [aiBriefing, setAiBriefing] = useState<ShiftBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const language: "en" | "es" = user?.language_pref === "es" ? "es" : "en";

  const loadRooms = useCallback(async () => {
    if (isOnline) {
      try {
        const result = await api.get<{ data: Room[] }>(`/housekeeping/my-rooms?date=${localDate()}`);
        setMyRooms(result.data);
        await upsertRooms(result.data);
      } catch {
        const cached = (await getRooms()) as Room[];
        setMyRooms(cached);
      }
    } else {
      const cached = (await getRooms()) as Room[];
      setMyRooms(cached);
    }
    setLoading(false);
  }, [isOnline, setMyRooms]);

  useEffect(() => {
    if (!isEngineer && myRooms.length === 0) {
      loadRooms();
    }
  }, [isEngineer, loadRooms, myRooms.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const smartQueue = useMemo(() => buildSmartQueue(myRooms), [myRooms]);
  const localBriefing = useMemo(
    () => (myRooms.length > 0 ? buildLocalBriefing(myRooms, t) : null),
    [myRooms, t],
  );
  const briefing = aiBriefing ?? localBriefing;
  const doneCount = myRooms.filter((room) => DONE_STATUSES.has(room.status)).length;
  const remainingCount = Math.max(0, myRooms.length - doneCount);
  const vipCount = myRooms.filter((room) => room.vip_flag && !DONE_STATUSES.has(room.status)).length;
  const attentionCount = useMemo(
    () => myRooms.filter((room) => getRoomQueueBucket(room) === "needs_attention").length,
    [myRooms],
  );
  const firstEntry = getStartEntry(smartQueue);

  const requestAiBriefing = useCallback(async () => {
    if (briefingLoading || myRooms.length === 0) return;
    setBriefingLoading(true);
    const result = await fetchShiftBriefing(myRooms, language, t, isOnline);
    setAiBriefing(result);
    setBriefingLoading(false);
  }, [briefingLoading, myRooms, language, t, isOnline]);

  if (isEngineer) {
    return <EngineerHomeScreen name={user?.full_name ?? "Engineer"} />;
  }

  if (effectiveRole === "housekeeping_supervisor") {
    return <SupervisorHomeScreen name={user?.full_name ?? "Supervisor"} />;
  }

  if (effectiveRole === "front_desk") {
    return <FrontDeskHomeScreen name={user?.full_name ?? "Front Desk"} />;
  }

  if (effectiveRole === "gm") {
    return <GMHomeScreen name={user?.full_name ?? "GM"} />;
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Evening Lobby shell hero */}
      <View style={[styles.shellHeader, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerTop}>
          <Avatar name={user?.full_name ?? "Staff"} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={styles.shellHeaderMeta}>{dynamicShiftMeta(user?.language_pref ?? "en", t("home.shiftSuffix"))}</Text>
        <Text style={styles.shellTitle}>{t("home.greeting", { name: firstName(user?.full_name) })}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {briefing ? (
          <AIBriefingCard
            kicker={t("ai.briefing.kicker")}
            headline={briefing.headline}
            planLabel={t("ai.briefing.planLabel")}
            plan={briefing.plan}
            watchouts={briefing.watchouts}
            loading={briefingLoading}
            footNote={`${briefing.source === "ai" ? t("ai.briefing.sourceAi") : t("ai.briefing.sourceLocal")} · ${t("ai.briefing.estTotal", { minutes: briefing.estimatedMinutes })}`}
          >
            <View style={styles.briefingActions}>
              {firstEntry ? (
                <TouchableOpacity
                  style={styles.briefingPrimaryBtn}
                  onPress={() => router.push(`/(app)/my-rooms/${firstEntry.room.id}`)}
                  activeOpacity={0.86}
                >
                  <Text style={styles.briefingPrimaryText}>{t("home.startWith", { room: firstEntry.room.room_number })}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={styles.briefingGhostBtn}
                onPress={() => void requestAiBriefing()}
                disabled={briefingLoading}
                activeOpacity={0.82}
              >
                <Ionicons name="sparkles" size={12} color="#CBB8F0" />
                <Text style={styles.briefingGhostText}>{t("ai.briefing.refresh")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.briefingGhostBtn}
                onPress={() => router.push("/(app)/copilot")}
                activeOpacity={0.82}
              >
                <Text style={styles.briefingGhostText}>{t("home.askAI")}</Text>
              </TouchableOpacity>
            </View>
          </AIBriefingCard>
        ) : null}

        <View style={styles.paceCard}>
          <ProgressRing value={doneCount} total={myRooms.length || 0} />
          <View style={styles.paceBody}>
            <Text style={styles.paceTitle}>{t("home.roomsLeft", { count: remainingCount })}</Text>
            <View style={styles.pillRow}>
              {attentionCount > 0 ? (
                <Pill tone="alert" icon="alert-circle-outline">
                  {attentionCount}
                </Pill>
              ) : (
                <Pill tone="ready">{t("home.onPace")}</Pill>
              )}
              {vipCount > 0 ? (
                <Pill tone="accent" icon="star">
                  {vipCount} VIP
                </Pill>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.upNextBlock}>
          <SectionHeader
            title={t("home.upNext")}
            hint={`${Math.min(3, smartQueue.length)} / ${remainingCount}`}
            action={
              <TouchableOpacity onPress={() => router.push("/(app)/my-rooms" as never)}>
                <Text style={styles.seeAll}>{t("home.seeAll")}</Text>
              </TouchableOpacity>
            }
          />
          <View style={styles.rows}>
            {smartQueue.slice(0, 3).map((entry) => (
              <RoomQueueCard
                key={entry.room.id}
                room={entry.room}
                position={entry.position}
                estimateMinutes={entry.estimateMinutes}
                onPress={() => router.push(`/(app)/my-rooms/${entry.room.id}`)}
              />
            ))}
            {smartQueue.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>{t("home.allDone")}</Text>
                <Text style={styles.emptyText}>{t("home.pullToRefresh")}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function EngineerHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const engineerName = firstName(name);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={styles.headerMeta}>{t("home.engineer.shiftMeta")}</Text>
        <Text style={styles.title}>{t("home.engineer.greeting", { name: engineerName })}</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <CopilotHero
          kicker={t("home.engineer.failurePrediction")}
          confidence={88}
          actions={
            <>
              <HeroButton primary icon="construct-outline">
                {t("home.engineer.preEmpt")}
              </HeroButton>
              <HeroButton>{t("home.engineer.dismiss")}</HeroButton>
            </>
          }
          foot={
            <>
              <Ionicons name="trending-up-outline" size={11} color="rgba(241,237,228,0.5)" />
              <Mono style={styles.heroFootText}>{t("home.engineer.coilsTrending")}</Mono>
            </>
          }
        >
          <Text>
            Units <Text style={styles.heroStrong}>211 and 213</Text> show the same belt wear as 209. Swapping all three this morning avoids a likely guest-facing failure by Friday.
          </Text>
        </CopilotHero>

        <View style={styles.engineerStats}>
          {[
            { value: "3", label: t("home.engineer.openOrders") },
            { value: "1", label: t("home.engineer.pmDue"), color: C.caution },
            { value: "2", label: t("home.engineer.closedToday"), color: C.ready },
          ].map((stat) => (
            <View key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text>
              <Text style={styles.engineerStatLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.pmCard}>
          <IconButton icon="calendar-outline" tone="caution" />
          <View style={styles.pmBody}>
            <Text style={styles.pmTitle}>{t("home.engineer.hvacFilters")}</Text>
            <Text style={styles.pmText}>{t("home.engineer.hvacUnits")}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={C.caution} />
        </View>

        <View>
          <SectionLabel hint="3 open" action={<Text style={styles.seeAll}>{t("home.engineer.allOrders")}</Text>}>
            {t("home.engineer.workOrders")}
          </SectionLabel>
          <View style={styles.rows}>
            {ENGINEER_ORDERS.map((order) => (
              <HandoffRow
                key={order.id}
                lead={<IconButton icon="construct-outline" tone={order.active ? "accent" : undefined} size={46} />}
                title={
                  <>
                    <Mono style={styles.workOrderId}>{order.id}</Mono>
                    <Pill tone={order.tone}>{order.pri}</Pill>
                  </>
                }
                sub={`${order.title} - ${order.loc}`}
                right={
                  order.active ? (
                    <Pill tone="progress" icon="time-outline">
                      {order.meta}
                    </Pill>
                  ) : (
                    <Mono style={styles.roomMeta}>{order.meta}</Mono>
                  )
                }
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SupervisorHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [stats, setStats] = useState({ assigned: "—", inProgress: "—", inspected: "—" });

  useEffect(() => {
    if (!isOnline) return;
    api
      .get<{ data: Array<{ status: string; assigned_to: string | null }> }>(
        `/housekeeping/board?date=${localDate()}`
      )
      .then((res) => {
        const rooms = res.data;
        setStats({
          assigned: String(rooms.filter((r) => r.assigned_to != null).length),
          inProgress: String(rooms.filter((r) => r.status === "IN_PROGRESS").length),
          inspected: String(rooms.filter((r) => r.status === "INSPECTED").length),
        });
      })
      .catch(console.warn);
  }, [isOnline]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={styles.headerMeta}>{t("home.supervisor.shiftMeta")}</Text>
        <Text style={styles.title}>{t("home.supervisor.greeting", { name: firstName(name) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.engineerStats}>
          {[
            { value: stats.assigned, label: t("home.supervisor.roomsAssigned") },
            { value: stats.inProgress, label: t("home.supervisor.inProgress"), color: C.caution },
            { value: stats.inspected, label: t("home.supervisor.inspected"), color: C.ready },
          ].map((stat) => (
            <View key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text>
              <Text style={styles.engineerStatLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("home.supervisor.boardTitle")}</Text>
          <Text style={styles.emptyText}>{t("home.supervisor.boardHint")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function FrontDeskHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [stats, setStats] = useState({ newReq: "—", inProgress: "—", resolved: "—" });

  useEffect(() => {
    if (!isOnline) return;
    api
      .get<{ data: Array<{ status: string }> }>("/guest-requests?per_page=200")
      .then((res) => {
        const requests = res.data;
        setStats({
          newReq: String(requests.filter((r) => r.status === "open").length),
          inProgress: String(requests.filter((r) => r.status === "in_progress").length),
          resolved: String(requests.filter((r) => r.status === "resolved").length),
        });
      })
      .catch(console.warn);
  }, [isOnline]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={styles.headerMeta}>{t("home.frontDesk.shiftMeta")}</Text>
        <Text style={styles.title}>{t("home.frontDesk.greeting", { name: firstName(name) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.engineerStats}>
          {[
            { value: stats.newReq, label: t("home.frontDesk.newRequests"), color: C.info },
            { value: stats.inProgress, label: t("home.frontDesk.inProgress"), color: C.caution },
            { value: stats.resolved, label: t("home.frontDesk.resolvedToday"), color: C.ready },
          ].map((stat) => (
            <View key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text>
              <Text style={styles.engineerStatLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("home.frontDesk.requestsTitle")}</Text>
          <Text style={styles.emptyText}>{t("home.frontDesk.requestsHint")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

function GMHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [stats, setStats] = useState({ cleanPct: "—", openWOs: "—", newRequests: "—" });

  useEffect(() => {
    if (!isOnline) return;
    Promise.all([
      api.get<{ data: Array<{ status: string }> }>(`/housekeeping/board?date=${localDate()}`),
      api.get<{ data: Array<{ status: string }> }>("/work-orders?status=open&per_page=200"),
      api.get<{ data: Array<{ status: string }> }>("/guest-requests?status=open&per_page=200"),
    ])
      .then(([boardRes, woRes, grRes]) => {
        const rooms = boardRes.data;
        const cleanCount = rooms.filter((r) => r.status === "CLEAN" || r.status === "INSPECTED").length;
        const cleanPct = rooms.length > 0 ? Math.round((cleanCount / rooms.length) * 100) : 0;
        setStats({
          cleanPct: `${cleanPct}%`,
          openWOs: String(woRes.data.length),
          newRequests: String(grRes.data.length),
        });
      })
      .catch(console.warn);
  }, [isOnline]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={styles.headerMeta}>{t("home.gm.shiftMeta")}</Text>
        <Text style={styles.title}>{t("home.gm.greeting", { name: firstName(name) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.engineerStats}>
          {[
            { value: stats.cleanPct, label: t("home.gm.roomsClean") },
            { value: stats.openWOs, label: t("home.gm.openWOs"), color: C.caution },
            { value: stats.newRequests, label: t("home.gm.guestRequests"), color: C.info },
          ].map((stat) => (
            <View key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text>
              <Text style={styles.engineerStatLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
        <View style={styles.emptyCard}>
          <Text style={styles.emptyTitle}>{t("home.gm.alertsTitle")}</Text>
          <Text style={styles.emptyText}>{t("home.gm.alertsHint")}</Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.paper,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: C.paper,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
    backgroundColor: C.paper,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  headerMeta: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: C.ink3,
    marginBottom: 4,
  },
  title: {
    fontSize: 30,
    fontWeight: "600",
    lineHeight: 34,
    color: C.ink,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 13,
  },
  shellHeader: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    backgroundColor: C.paper,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
  },
  shellHeaderMeta: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: C.ink3,
    marginBottom: 4,
  },
  shellTitle: {
    fontSize: 30,
    fontWeight: "600",
    lineHeight: 34,
    color: C.ink,
  },
  briefingActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  briefingPrimaryBtn: {
    backgroundColor: C.accent,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  briefingPrimaryText: { color: "#fff", fontSize: 13.5, fontWeight: "800" },
  briefingGhostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 13,
    justifyContent: "center",
  },
  briefingGhostText: { color: C.ink2, fontSize: 12.5, fontWeight: "700" },
  upNextBlock: { gap: 9 },
  heroStrong: {
    fontFamily: monoFont,
    fontStyle: "normal",
    fontWeight: "700",
    color: C.paper,
  },
  heroFootText: {
    color: "rgba(241,237,228,0.5)",
    fontSize: 10.5,
  },
  paceCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  paceBody: {
    flex: 1,
  },
  paceTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: C.ink,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 9,
  },
  seeAll: {
    fontSize: 12,
    color: C.accent,
    fontWeight: "600",
  },
  rows: {
    gap: 8,
  },
  roomMeta: {
    fontSize: 11,
    color: C.ink3,
  },
  emptyCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 16,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: C.ink,
  },
  emptyText: {
    fontSize: 12,
    color: C.ink3,
    marginTop: 4,
  },
  engineerStats: {
    flexDirection: "row",
    gap: 9,
  },
  engineerStat: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  engineerStatValue: {
    fontSize: 26,
    lineHeight: 28,
    color: C.ink,
  },
  engineerStatLabel: {
    color: C.ink3,
    fontSize: 11,
    marginTop: 5,
  },
  pmCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.cautionSoft,
    borderWidth: 1,
    borderColor: C.cautionLine,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  pmBody: {
    flex: 1,
  },
  pmTitle: {
    color: C.ink,
    fontSize: 13.5,
    fontWeight: "700",
  },
  pmText: {
    color: C.caution,
    fontSize: 11.5,
    marginTop: 2,
  },
  workOrderId: {
    color: C.ink3,
    fontSize: 11,
    fontWeight: "700",
  },
});
