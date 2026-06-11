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

const ENGINEER_ORDERS = [
  { id: "WO-1141", title: "Replace fan-coil belt", loc: "R-209 - zone B", pri: "HIGH", tone: "alert" as const, meta: "22m", active: true },
  { id: "WO-1138", title: "Reseat toilet flange", loc: "R-144", pri: "MED", tone: "caution" as const, meta: "queued" },
  { id: "WO-1135", title: "Pool pump pressure check", loc: "Mech room", pri: "LOW", tone: "info" as const, meta: "queued" },
];

const DONE_STATUSES = new Set(["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);

const STATUS_CONFIG: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  DIRTY:         { label: "Vacant Dirty",                  bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  OCCUPIED:      { label: "Occupied Dirty",                bg: C.alertSoft,   fg: C.alert,   border: C.alertLine },
  PICKUP:        { label: "Pickup",                        bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  IN_PROGRESS:   { label: "In Progress",                   bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  CLEAN:         { label: "Clean",                         bg: C.infoSoft,    fg: C.info,    border: C.infoLine },
  INSPECTED:     { label: "Inspected / Ready",             bg: C.readySoft,   fg: C.ready,   border: C.readyLine },
  OOO:           { label: "Out of Order",                  bg: C.oooSoft,     fg: C.ooo,     border: C.oooLine },
  OUT_OF_ORDER:  { label: "Out of Order",                  bg: C.oooSoft,     fg: C.ooo,     border: C.oooLine },
  OUT_OF_SERVICE:{ label: "Out of Service",                bg: C.oooSoft,     fg: C.ooo,     border: C.oooLine },
};

const CLEAN_TYPE_SHORT: Record<string, string> = { DEP: "Departure", FULL: "Full", LIGHT: "Light" };

function formatCheckoutTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  } catch { return null; }
}

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function roomMeta(room: Room, index: number) {
  if (room.status === "IN_PROGRESS") return "in progress";
  if (index === 0) return "next";
  if (room.vip_flag && room.checkin_time) return "by 3pm";
  return `${index + 1}th`;
}

function sortNextRooms(rooms: Room[]) {
  const score = (room: Room) => {
    if (room.vip_flag) return 3;
    if (room.status === "IN_PROGRESS") return 0;
    if (room.status === "DIRTY") return 1;
    if (room.status === "PICKUP") return 2;
    return 4;
  };

  return rooms
    .filter((room) => !DONE_STATUSES.has(room.status))
    .sort((a, b) => score(a) - score(b) || a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
}

function dynamicShiftMeta(languagePref: string, suffix: string): string {
  const now = new Date();
  const locale = languagePref === "es" ? "es-MX" : "en-US";
  const weekday = now.toLocaleDateString(locale, { weekday: "short" });
  const month = now.toLocaleDateString(locale, { month: "short" });
  return `${weekday} · ${month} ${now.getDate()} · ${suffix}`;
}

function DashboardRoomCard({ room, index, onPress }: { room: Room; index: number; onPress: () => void }) {
  const status = room.status ?? "DIRTY";
  const cfg = STATUS_CONFIG[status] ?? { label: status, bg: C.surface3, fg: C.ink3, border: C.line };
  const roomType = room.rooms?.room_types?.name ?? null;
  const cleanTypeLabel = room.clean_type ? (CLEAN_TYPE_SHORT[room.clean_type] ?? null) : null;
  const checkoutIso = room.actual_checkout_at ?? room.checkout_time ?? null;
  const checkoutLabel = room.actual_checkout_at ? "Checked out" : "Due out";
  const checkoutTime = formatCheckoutTime(checkoutIso);

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.roomCard}>
      {status === "OCCUPIED" ? (
        <View style={styles.occupiedRail}>
          {[0, 1, 2].map((stripe) => (
            <View key={stripe} style={styles.occupiedRailStripe} />
          ))}
        </View>
      ) : (
        <View style={[styles.statusRail, { backgroundColor: cfg.fg }]} />
      )}
      <View style={styles.roomCardLeft}>
        <View style={styles.roomCardTitleRow}>
          <Text style={styles.roomCardNum}>{room.room_number}</Text>
          {room.vip_flag ? (
            <View style={styles.roomVipBadge}><Text style={styles.roomVipText}>VIP</Text></View>
          ) : null}
        </View>
        {roomType ? <Text style={styles.roomType}>{roomType}</Text> : null}
        <View style={styles.roomPillRow}>
          <View style={[styles.roomPill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
            <Text style={[styles.roomPillText, { color: cfg.fg }]}>{cfg.label}</Text>
          </View>
          {cleanTypeLabel ? (
            <View style={styles.cleanTypeRow}>
              {room.clean_type === "DEP" ? <Ionicons name="log-out-outline" size={10} color={C.alert} /> : null}
              <Text style={[styles.cleanTypeText, { color: room.clean_type === "DEP" ? C.alert : C.caution }]}>
                {cleanTypeLabel}
              </Text>
            </View>
          ) : null}
        </View>
        {checkoutTime ? (
          <View style={styles.roomTimeRow}>
            <Ionicons name="time-outline" size={12} color={C.ink3} />
            <Text style={styles.roomTimeText}>{checkoutLabel} {checkoutTime}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.roomCardRight}>
        <Mono style={styles.roomMeta}>{roomMeta(room, index)}</Mono>
        <Ionicons name="chevron-forward" size={14} color={C.ink4} style={{ marginTop: 6 }} />
      </View>
    </TouchableOpacity>
  );
}

export default function HousekeeperHomeScreen() {
  const { t } = useTranslation();
  const { user, isOnline, myRooms, setMyRooms } = useAppStore();
  const effectiveRole = user?.effective_role ?? user?.role;
  const isEngineer = effectiveRole === "engineer" || effectiveRole === "chief_engineer";
  const [loading, setLoading] = useState(myRooms.length === 0);
  const [refreshing, setRefreshing] = useState(false);

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

  const nextRooms = useMemo(() => sortNextRooms(myRooms), [myRooms]);
  const doneCount = myRooms.filter((room) => DONE_STATUSES.has(room.status)).length;
  const remainingCount = Math.max(0, myRooms.length - doneCount);
  const vipCount = myRooms.filter((room) => room.vip_flag && !DONE_STATUSES.has(room.status)).length;
  const actionRooms = nextRooms.filter((room) => room.status !== "IN_PROGRESS");
  const firstRoom = actionRooms[0] ?? nextRooms[0];
  const planRooms = (actionRooms.length > 0 ? actionRooms : nextRooms)
    .slice(0, 3)
    .map((room) => room.room_number)
    .join(" → ");

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
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Avatar name={user?.full_name ?? "Staff"} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={styles.headerMeta}>{dynamicShiftMeta(user?.language_pref ?? "en", t("home.shiftSuffix"))}</Text>
        <Text style={styles.title}>{t("home.greeting", { name: firstName(user?.full_name) })}</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <CopilotHero
          kicker={t("home.copilotKicker")}
          confidence={92}
          actions={
            firstRoom ? (
              <>
                <HeroButton primary onPress={() => router.push(`/(app)/my-rooms/${firstRoom.id}`)}>
                  {t("home.startWith", { room: firstRoom.room_number })}
                </HeroButton>
                <HeroButton>{t("home.seePlan")}</HeroButton>
                <HeroButton icon="sparkles" onPress={() => router.push("/(app)/copilot")}>
                  {t("home.askAI")}
                </HeroButton>
              </>
            ) : undefined
          }
          foot={
            <>
              <Ionicons name="time-outline" size={11} color="rgba(241,237,228,0.5)" />
              <Mono style={styles.heroFootText}>{t("home.savesMins")}</Mono>
            </>
          }
        >
          <Text style={styles.heroSentence}>{t("home.aiPrioritized")}</Text>
          <Text style={styles.heroSentence}>{t("home.roomsLeft", { count: remainingCount })}</Text>
          {firstRoom ? (
            <Text>
              {" "}
              {t("home.copilotPlanBefore")}
              <Text style={styles.heroStrong}>{planRooms}</Text>
              {t("home.copilotPlanAfter")}
            </Text>
          ) : (
            <Text>{t("home.boardClear")}</Text>
          )}
        </CopilotHero>

        <View style={styles.paceCard}>
          <ProgressRing value={doneCount} total={myRooms.length || 0} />
          <View style={styles.paceBody}>
            <Text style={styles.paceTitle}>{t("home.aheadByMins")}</Text>
            <Text style={styles.paceSub}>{t("home.avgTarget")}</Text>
            <View style={styles.pillRow}>
              <Pill tone="ready">{t("home.onPace")}</Pill>
              {vipCount > 0 ? (
                <Pill tone="accent" icon="star">
                  {vipCount} VIP
                </Pill>
              ) : null}
            </View>
          </View>
        </View>

        <View>
          <SectionLabel
            hint={`${Math.min(3, nextRooms.length)} of ${remainingCount}`}
            action={
              <TouchableOpacity onPress={() => router.push("/(app)/my-rooms" as never)}>
                <Text style={styles.seeAll}>{t("home.seeAll")}</Text>
              </TouchableOpacity>
            }
          >
            {t("home.upNext")}
          </SectionLabel>
          <View style={styles.rows}>
            {nextRooms.slice(0, 3).map((room, index) => (
              <DashboardRoomCard
                key={room.id}
                room={room}
                index={index}
                onPress={() => router.push(`/(app)/my-rooms/${room.id}`)}
              />
            ))}
            {nextRooms.length === 0 ? (
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
  heroSentence: {
    fontStyle: "italic",
    fontSize: 19,
    lineHeight: 26,
    color: C.paper,
  },
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
  paceSub: {
    fontSize: 12,
    color: C.ink3,
    marginTop: 2,
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
  roomCard: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 16,
    paddingLeft: 18,
    backgroundColor: C.surface,
    borderRadius: R.lg,
    borderWidth: 1,
    borderColor: C.line,
  },
  statusRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  occupiedRail: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 5,
    justifyContent: "space-evenly",
    backgroundColor: C.alertSoft,
  },
  occupiedRailStripe: { height: "22%", backgroundColor: C.occupied },
  roomCardLeft: { flex: 1, minWidth: 0 },
  roomCardTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  roomCardNum: { fontFamily: monoFont, fontSize: 29, lineHeight: 33, fontWeight: "700", color: C.ink },
  roomVipBadge: {
    backgroundColor: C.accentSoft,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: C.accentLine,
  },
  roomVipText: { fontSize: 9, fontWeight: "700", color: C.accent },
  roomType: { fontSize: 13.5, color: C.ink3, marginBottom: 6, marginTop: 1 },
  roomPillRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" as const },
  roomPill: { borderRadius: 100, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 3, minHeight: 24 },
  roomPillText: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  cleanTypeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cleanTypeText: { fontSize: 10, fontWeight: "700" },
  roomTimeRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  roomTimeText: { fontFamily: monoFont, fontSize: 11, color: C.ink2 },
  roomCardRight: { alignItems: "flex-end", flexShrink: 0 },

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
