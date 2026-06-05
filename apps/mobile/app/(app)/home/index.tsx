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
import { C, R, displayFont, monoFont } from "@/components/shared/tokens";
import {
  Avatar,
  CopilotHero,
  HandoffRow,
  HeroButton,
  IconButton,
  Mono,
  Pill,
  ProgressRing,
  RoomNumberTile,
  SectionLabel,
} from "@/components/shared/mobileHandoff";

const ENGINEER_ORDERS = [
  { id: "WO-1141", title: "Replace fan-coil belt", loc: "R-209 - zone B", pri: "HIGH", tone: "alert" as const, meta: "22m", active: true },
  { id: "WO-1138", title: "Reseat toilet flange", loc: "R-144", pri: "MED", tone: "caution" as const, meta: "queued" },
  { id: "WO-1135", title: "Pool pump pressure check", loc: "Mech room", pri: "LOW", tone: "info" as const, meta: "queued" },
];

const DONE_STATUSES = new Set(["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function roomSubtitle(room: Room) {
  const type = room.vip_flag ? "Suite" : room.status === "PICKUP" ? "Stay-over" : "Queen";
  if (room.vip_flag) return `${type} · VIP arrival`;
  if (room.status === "DIRTY") return `${type} · Checkout`;
  if (room.status === "IN_PROGRESS") return `${type} · Stay-over`;
  return `${type} · Room`;
}

function roomMeta(room: Room, index: number) {
  if (room.status === "IN_PROGRESS") return "in progress";
  if (index === 0) return "next";
  if (room.vip_flag && room.checkin_time) return "by 3pm";
  return `${index + 1}th`;
}

function roomNote(room: Room) {
  if (room.vip_flag) return "Extra pillows · still water";
  if (room.guest_name && room.status === "IN_PROGRESS") return "Guest still in - knock first";
  if (room.risk_level === "HIGH") return "High risk - give this one a little extra time";
  return undefined;
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

export default function HousekeeperHomeScreen() {
  const { t } = useTranslation();
  const { user, isOnline, myRooms, setMyRooms } = useAppStore();
  const isEngineer = user?.role === "engineer" || user?.role === "chief_engineer";
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
        <Text style={styles.headerMeta}>{t("home.shiftMeta")}</Text>
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
          <Text style={styles.heroSentence}>{remainingCount} rooms left.</Text>
          {firstRoom ? (
            <Text>
              {" "}
              I'd clean <Text style={styles.heroStrong}>{planRooms}</Text> first, then keep your VIP room fresh for check-in.
            </Text>
          ) : (
            <Text> Your board is clear for now.</Text>
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
              <TouchableOpacity onPress={() => router.push("/(app)/my-rooms")}>
                <Text style={styles.seeAll}>{t("home.seeAll")}</Text>
              </TouchableOpacity>
            }
          >
            {t("home.upNext")}
          </SectionLabel>
          <View style={styles.rows}>
            {nextRooms.slice(0, 3).map((room, index) => (
              <HandoffRow
                key={room.id}
                onPress={() => router.push(`/(app)/my-rooms/${room.id}`)}
                lead={<RoomNumberTile roomNumber={room.room_number} status={room.status} />}
                title={
                  <>
                    <Text style={styles.rowTitle}>{roomSubtitle(room)}</Text>
                    {room.vip_flag ? (
                      <Pill tone="accent" icon="star">
                        VIP
                      </Pill>
                    ) : null}
                  </>
                }
                sub={roomNote(room)}
                right={<Mono style={styles.roomMeta}>{roomMeta(room, index)}</Mono>}
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
    fontFamily: displayFont,
    fontSize: 30,
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
    fontFamily: displayFont,
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
    borderRadius: 16,
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
  rowTitle: {
    fontSize: 13.5,
    fontWeight: "600",
    color: C.ink,
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
    fontFamily: displayFont,
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
