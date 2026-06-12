import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "@/lib/api/client";
import { getRooms, upsertRooms } from "@/lib/offline/db";
import { localDate, dynamicShiftMeta } from "@/lib/utils/date";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, R, monoFont } from "@/components/shared/tokens";
import { Avatar, CopilotHero, HandoffRow, HeroButton, IconButton, Mono, Pill, SectionLabel } from "@/components/shared/mobileHandoff";
import { SupervisorHome } from "@/components/home/SupervisorHome";
import { buildLocalBriefing, buildSmartQueue, fetchShiftBriefing, getStartEntry, type ShiftBriefing, type SmartQueueEntry } from "@/lib/ai/briefing";
import { buildShiftSnapshot, getCompanionCheckin, getGreetingKey } from "@/lib/ai/companion";

const ENGINEER_ORDERS = [
  { id: "WO-1141", title: "Replace fan-coil belt", loc: "R-209 - zone B", pri: "HIGH", tone: "alert" as const, meta: "22m", active: true },
  { id: "WO-1138", title: "Reseat toilet flange", loc: "R-144", pri: "MED", tone: "caution" as const, meta: "queued" },
  { id: "WO-1135", title: "Pool pump pressure check", loc: "Mech room", pri: "LOW", tone: "info" as const, meta: "queued" },
];

type Translate = (key: string, options?: Record<string, unknown>) => string;
type Tone = "neutral" | "ready" | "caution" | "alert" | "info" | "ai";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function getToneColors(tone: Tone) {
  switch (tone) {
    case "ready":
      return { bg: C.readySoft, fg: C.ready, line: C.readyLine };
    case "caution":
      return { bg: C.cautionSoft, fg: C.caution, line: C.cautionLine };
    case "alert":
      return { bg: C.alertSoft, fg: C.alert, line: C.alertLine };
    case "info":
      return { bg: C.infoSoft, fg: C.info, line: C.infoLine };
    case "ai":
      return { bg: C.aiSoft, fg: C.ai, line: C.aiLine };
    default:
      return { bg: C.surface2, fg: C.ink2, line: C.line2 };
  }
}

function getStatusVisual(status: Room["status"]) {
  switch (status) {
    case "INSPECTED":
      return { label: "Inspected", tone: "ready" as Tone, ...getToneColors("ready") };
    case "CLEAN":
      return { label: "Clean", tone: "info" as Tone, ...getToneColors("info") };
    case "IN_PROGRESS":
      return { label: "In progress", tone: "caution" as Tone, ...getToneColors("caution") };
    case "PICKUP":
      return { label: "Pickup", tone: "caution" as Tone, ...getToneColors("caution") };
    case "DIRTY":
    case "OCCUPIED":
      return { label: status === "OCCUPIED" ? "Occupied" : "Dirty", tone: "alert" as Tone, ...getToneColors("alert") };
    case "OOO":
    case "OUT_OF_ORDER":
    case "OUT_OF_SERVICE":
      return { label: "Out of order", tone: "neutral" as Tone, bg: C.oooSoft, fg: C.ooo, line: C.oooLine };
    default:
      return { label: "Room", tone: "neutral" as Tone, ...getToneColors("neutral") };
  }
}

function roomDescriptor(room: Room) {
  return room.rooms?.room_types?.name ?? room.clean_type_label ?? room.clean_type ?? "Guest room";
}

function hasWorkOrder(room: Room) {
  return Boolean(room.open_work_order_id || room.open_work_order_number);
}

function getFocusReason(room: Room, t: Translate) {
  if (room.status === "IN_PROGRESS") return t("home.focus.reasonInProgress");
  if (room.vip_flag) return t("home.focus.reasonVip");
  if (room.checkin_time) return t("home.focus.reasonArrival");
  if (room.clean_type === "DEP") return t("home.focus.reasonDeparture");
  return t("home.focus.reasonDefault");
}

function routeChipText(room: Room) {
  if (room.status === "IN_PROGRESS") return "Resume";
  if (room.vip_flag) return "VIP";
  if (room.dnd_flag) return "DND";
  if (hasWorkOrder(room)) return "WO";
  if (room.risk_level === "HIGH") return "Review";
  return room.clean_type_label ?? room.clean_type ?? getStatusVisual(room.status).label;
}

function MiniFlag({ label, tone = "neutral", testID }: { label: string; tone?: Tone; testID?: string }) {
  const colors = getToneColors(tone);
  return (
    <View style={[styles.miniFlag, { backgroundColor: colors.bg, borderColor: colors.line }]} testID={testID}>
      <Text style={[styles.miniFlagText, { color: colors.fg }]}>{label}</Text>
    </View>
  );
}

function ShiftMetric({ value, label, helper, tone = "neutral", testID }: { value: string; label: string; helper: string; tone?: Tone; testID?: string }) {
  const colors = getToneColors(tone);
  return (
    <View style={[styles.shiftMetric, { borderColor: colors.line }]} testID={testID}>
      <Text style={[styles.shiftMetricValue, { color: colors.fg }]}>{value}</Text>
      <Text style={styles.shiftMetricLabel}>{label}</Text>
      <Text style={styles.shiftMetricHelper}>{helper}</Text>
    </View>
  );
}

function NextRoomPanel({ entry, inProgressRoom, t, onStart, onResume }: { entry: SmartQueueEntry | null; inProgressRoom: Room | null; t: Translate; onStart: (room: Room) => void; onResume: (room: Room) => void }) {
  if (!entry) {
    return (
      <View style={styles.nextRoomPanel} testID="next-room-panel-empty">
        <Text style={styles.panelEyebrow}>{"Today's focus"}</Text>
        <Text style={styles.emptyHeroTitle}>{t("home.allDone")}</Text>
        <Text style={styles.emptyHeroText}>{t("home.pullToRefresh")}</Text>
      </View>
    );
  }

  const room = entry.room;
  const status = getStatusVisual(room.status);
  const startLabel = room.status === "IN_PROGRESS" ? t("home.focus.resume", { room: room.room_number }) : t("home.startWith", { room: room.room_number });

  return (
    <View style={styles.nextRoomPanel} testID="next-room-panel">
      <View style={styles.panelTopRow}>
        <Text style={styles.panelEyebrow}>Next best room</Text>
        <MiniFlag label={`~${entry.estimateMinutes} min`} />
      </View>
      <View style={styles.nextRoomMainRow}>
        <View style={[styles.roomNumberPlate, { backgroundColor: status.bg, borderColor: status.line }]}>
          <Text style={[styles.roomNumberText, { color: status.fg }]}>{room.room_number}</Text>
        </View>
        <View style={styles.nextRoomCopy}>
          <Text style={styles.nextRoomTitle}>Room {room.room_number}</Text>
          <Text style={styles.nextRoomSubtitle} numberOfLines={1}>{roomDescriptor(room)}</Text>
          <Text style={styles.nextRoomReason}>{getFocusReason(room, t)}</Text>
        </View>
      </View>
      <View style={styles.flagRow}>
        <MiniFlag label={status.label} tone={status.tone} />
        {room.vip_flag ? <MiniFlag label="VIP" tone="ai" testID="next-room-vip" /> : null}
        {room.risk_level === "HIGH" ? <MiniFlag label="Review" tone="alert" testID="next-room-review" /> : null}
        {room.dnd_flag ? <MiniFlag label="DND" tone="caution" /> : null}
        {hasWorkOrder(room) ? <MiniFlag label="Work order" tone="alert" /> : null}
      </View>
      <TouchableOpacity style={styles.primaryStartButton} onPress={() => onStart(room)} activeOpacity={0.88} testID="next-room-start">
        <Text style={styles.primaryStartText}>{startLabel}</Text>
        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
      {inProgressRoom && inProgressRoom.id !== room.id ? (
        <TouchableOpacity style={styles.resumeStrip} onPress={() => onResume(inProgressRoom)} activeOpacity={0.82} testID="next-room-resume">
          <View style={styles.resumeDot} />
          <Text style={styles.resumeStripText}>{t("home.focus.resume", { room: inProgressRoom.room_number })} · {t("home.focus.inProgress")}</Text>
          <Ionicons name="chevron-forward" size={15} color={C.caution} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function QueuePreviewRow({ entry, onPress }: { entry: SmartQueueEntry; onPress: (room: Room) => void }) {
  const status = getStatusVisual(entry.room.status);
  return (
    <TouchableOpacity style={styles.routeRow} onPress={() => onPress(entry.room)} activeOpacity={0.82} testID={`queue-preview-${entry.room.room_number}`}>
      <View style={styles.routePosition}><Mono style={styles.routePositionText}>{entry.position}</Mono></View>
      <View style={styles.routeRoomBlock}>
        <Text style={styles.routeRoomNumber}>Room {entry.room.room_number}</Text>
        <Text style={styles.routeRoomMeta} numberOfLines={1}>{roomDescriptor(entry.room)}</Text>
      </View>
      <View style={styles.routeRight}>
        <MiniFlag label={routeChipText(entry.room)} tone={entry.room.status === "IN_PROGRESS" ? "caution" : entry.room.vip_flag ? "ai" : "neutral"} />
        <Text style={[styles.routeEta, { color: status.fg }]}>~{entry.estimateMinutes}m</Text>
      </View>
    </TouchableOpacity>
  );
}

function BriefingPanel({ briefing, loading, onRefresh }: { briefing: ShiftBriefing | null; loading: boolean; onRefresh: () => void }) {
  if (!briefing) return null;
  return (
    <View style={styles.briefingPanel} testID="ai-plan-card">
      <View style={styles.briefingHeaderRow}>
        <View style={styles.briefingTitleWrap}><View style={styles.aiDot} /><Text style={styles.briefingEyebrow}>AI plan</Text></View>
        <TouchableOpacity style={styles.briefingRefresh} onPress={onRefresh} disabled={loading} activeOpacity={0.82}>
          <Ionicons name={loading ? "sync" : "sparkles"} size={13} color={C.ai} />
          <Text style={styles.briefingRefreshText}>{loading ? "Updating" : "New plan"}</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.briefingHeadline}>{briefing.headline}</Text>
      {briefing.plan.length > 0 ? (
        <View style={styles.briefingPlanRow}>{briefing.plan.slice(0, 6).map((roomNumber, index) => <View key={`${roomNumber}-${index}`} style={styles.planChip}><Text style={styles.planChipText}>{roomNumber}</Text></View>)}</View>
      ) : null}
      {briefing.watchouts.length > 0 ? (
        <View style={styles.watchoutList}>{briefing.watchouts.map((watchout) => <View key={watchout} style={styles.watchoutRow}><Ionicons name="alert-circle-outline" size={14} color={C.caution} /><Text style={styles.watchoutText}>{watchout}</Text></View>)}</View>
      ) : null}
      <View style={styles.briefingFooterRow}>
        <Text style={styles.briefingFooter}>{briefing.source === "ai" ? "Generated by AI" : "Planned on device"} · ~{briefing.estimatedMinutes} min left</Text>
        <TouchableOpacity onPress={() => router.push("/(app)/copilot")} activeOpacity={0.78}><Text style={styles.askAiText}>Ask AI</Text></TouchableOpacity>
      </View>
    </View>
  );
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
        setMyRooms((await getRooms()) as Room[]);
      }
    } else {
      setMyRooms((await getRooms()) as Room[]);
    }
    setLoading(false);
  }, [isOnline, setMyRooms]);

  useEffect(() => {
    if (!isEngineer && myRooms.length === 0) void loadRooms();
  }, [isEngineer, loadRooms, myRooms.length]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const smartQueue = useMemo(() => buildSmartQueue(myRooms), [myRooms]);
  const localBriefing = useMemo(() => (myRooms.length > 0 ? buildLocalBriefing(myRooms, t) : null), [myRooms, t]);
  const briefing = aiBriefing ?? localBriefing;
  const snapshot = useMemo(() => buildShiftSnapshot(myRooms, language === "es" ? "es-MX" : "en-US"), [myRooms, language]);
  const checkin = useMemo(() => getCompanionCheckin(snapshot, t), [snapshot, t]);
  const firstEntry = getStartEntry(smartQueue);
  const inProgressRoom = useMemo(() => myRooms.find((room) => room.status === "IN_PROGRESS") ?? null, [myRooms]);
  const queuePreview = useMemo(() => smartQueue.slice(0, 4), [smartQueue]);
  const attentionLabel = snapshot.attention > 0 ? "Needs review" : snapshot.vipLeft > 0 ? "VIP left" : "Clear";
  const openRoom = useCallback((room: Room) => router.push(`/(app)/my-rooms/${room.id}`), []);

  const requestAiBriefing = useCallback(async () => {
    if (briefingLoading || myRooms.length === 0) return;
    setBriefingLoading(true);
    const result = await fetchShiftBriefing(myRooms, language, t, isOnline);
    setAiBriefing(result);
    setBriefingLoading(false);
  }, [briefingLoading, myRooms, language, t, isOnline]);

  if (isEngineer) return <EngineerHomeScreen name={user?.full_name ?? "Engineer"} />;
  if (effectiveRole === "housekeeping_supervisor") return <SupervisorHome name={user?.full_name ?? "Supervisor"} />;
  if (effectiveRole === "front_desk") return <FrontDeskHomeScreen name={user?.full_name ?? "Front Desk"} />;
  if (effectiveRole === "gm") return <GMHomeScreen name={user?.full_name ?? "GM"} />;
  if (loading) return <View style={styles.center}><ActivityIndicator color={C.accent} /></View>;

  return (
    <View style={styles.housekeepingRoot} testID="housekeeping-home">
      <ScrollView style={styles.housekeepingScroll} contentContainerStyle={styles.housekeepingContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>
        <View style={[styles.housekeepingHeader, { paddingTop: insets.top + 12 }]}>
          <View style={styles.headerTop}>
            <Avatar name={user?.full_name ?? "Staff"} size={36} />
            <View style={styles.headerActions}>
              <View style={[styles.connectionPill, isOnline ? styles.connectionPillOnline : styles.connectionPillOffline]}>
                <View style={[styles.connectionDot, isOnline ? styles.connectionDotOnline : styles.connectionDotOffline]} />
                <Text style={styles.connectionText}>{isOnline ? "Live" : "Offline"}</Text>
              </View>
              <IconButton icon="notifications-outline" />
            </View>
          </View>
          <Text style={styles.housekeepingMeta}>{dynamicShiftMeta(user?.language_pref ?? "en", t("home.shiftSuffix"))}</Text>
          <Text style={styles.housekeepingTitle}>{t(getGreetingKey(), { name: firstName(user?.full_name) })}</Text>
          <Text style={styles.housekeepingSubtitle}>{checkin.message}</Text>
          <View style={styles.progressCard} testID="shift-progress-card">
            <View style={styles.progressTopRow}>
              <View><Text style={styles.progressKicker}>Shift progress</Text><Text style={styles.progressValue}>{snapshot.done} / {snapshot.total}</Text></View>
              <View style={styles.progressBadge}><Text style={styles.progressBadgeText}>{snapshot.pct}%</Text></View>
            </View>
            <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${snapshot.pct}%` }]} /></View>
            <Text style={styles.progressCaption}>{snapshot.remaining > 0 ? `${snapshot.remaining} left` : "All assigned rooms handled"}{snapshot.finishByLabel ? ` · on track for ${snapshot.finishByLabel}` : ""}</Text>
          </View>
        </View>

        <View style={styles.housekeepingBody}>
          <NextRoomPanel entry={firstEntry} inProgressRoom={inProgressRoom} t={t} onStart={openRoom} onResume={openRoom} />
          <View style={styles.metricsGrid}>
            <ShiftMetric value={String(snapshot.done)} label="Done" helper="Clean or inspected" tone="ready" testID="metric-done" />
            <ShiftMetric value={String(snapshot.remaining)} label="Left" helper="Still assigned" tone={snapshot.remaining > 0 ? "caution" : "ready"} testID="metric-left" />
            <ShiftMetric value={String(snapshot.attention || snapshot.vipLeft)} label={attentionLabel} helper="Check before starting" tone={snapshot.attention > 0 ? "alert" : snapshot.vipLeft > 0 ? "ai" : "neutral"} testID="metric-attention" />
            <ShiftMetric value={snapshot.minutesLeft > 0 ? `~${snapshot.minutesLeft}m` : "0m"} label="Time" helper="Est. remaining" tone="info" testID="metric-time" />
          </View>
          {queuePreview.length > 0 ? (
            <View style={styles.routeCard} testID="queue-preview">
              <View style={styles.sectionHeaderRow}><View><Text style={styles.sectionEyebrow}>Route preview</Text><Text style={styles.sectionTitle}>Your next few moves</Text></View><TouchableOpacity onPress={() => router.push("/(app)/my-rooms" as never)} activeOpacity={0.76}><Text style={styles.sectionAction}>See all</Text></TouchableOpacity></View>
              <View style={styles.routeRows}>{queuePreview.map((entry) => <QueuePreviewRow key={entry.room.id} entry={entry} onPress={openRoom} />)}</View>
            </View>
          ) : null}
          <BriefingPanel briefing={briefing} loading={briefingLoading} onRefresh={() => void requestAiBriefing()} />
          {checkin.tip ? (
            <View style={styles.nudgeCard} testID="companion-nudge"><View style={styles.nudgeIconWrap}><Ionicons name="leaf-outline" size={15} color={C.primary} /></View><View style={styles.nudgeBody}><Text style={styles.nudgeKicker}>{t("home.companion.kicker")}</Text><Text style={styles.nudgeText}>{checkin.tip}</Text></View></View>
          ) : null}
          {(snapshot.stage === "done" || snapshot.stage === "empty") ? <View style={styles.emptyCard}><Text style={styles.emptyTitle}>{t("home.allDone")}</Text><Text style={styles.emptyText}>{t("home.pullToRefresh")}</Text></View> : null}
          <TouchableOpacity style={styles.myRoomsButton} onPress={() => router.push("/(app)/my-rooms" as never)} activeOpacity={0.88}><Text style={styles.myRoomsButtonText}>{t("home.openMyRooms")}</Text><Ionicons name="arrow-forward" size={16} color="#fff" /></TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

function EngineerHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.container}>
      <View style={styles.header}><View style={styles.headerTop}><Avatar name={name} size={34} /><IconButton icon="notifications-outline" /></View><Text style={styles.headerMeta}>{t("home.engineer.shiftMeta")}</Text><Text style={styles.title}>{t("home.engineer.greeting", { name: firstName(name) })}</Text></View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <CopilotHero kicker={t("home.engineer.failurePrediction")} confidence={88} actions={<><HeroButton primary icon="construct-outline">{t("home.engineer.preEmpt")}</HeroButton><HeroButton>{t("home.engineer.dismiss")}</HeroButton></>} foot={<><Ionicons name="trending-up-outline" size={11} color="rgba(241,237,228,0.5)" /><Mono style={styles.heroFootText}>{t("home.engineer.coilsTrending")}</Mono></>}><Text>Units <Text style={styles.heroStrong}>211 and 213</Text> show the same belt wear as 209. Swapping all three this morning avoids a likely guest-facing failure by Friday.</Text></CopilotHero>
        <View style={styles.engineerStats}>{[{ value: "3", label: t("home.engineer.openOrders") }, { value: "1", label: t("home.engineer.pmDue"), color: C.caution }, { value: "2", label: t("home.engineer.closedToday"), color: C.ready }].map((stat) => <View key={stat.label} style={styles.engineerStat}><Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text><Text style={styles.engineerStatLabel}>{stat.label}</Text></View>)}</View>
        <View style={styles.pmCard}><IconButton icon="calendar-outline" tone="caution" /><View style={styles.pmBody}><Text style={styles.pmTitle}>{t("home.engineer.hvacFilters")}</Text><Text style={styles.pmText}>{t("home.engineer.hvacUnits")}</Text></View><Ionicons name="chevron-forward" size={16} color={C.caution} /></View>
        <View><SectionLabel hint="3 open" action={<Text style={styles.seeAll}>{t("home.engineer.allOrders")}</Text>}>{t("home.engineer.workOrders")}</SectionLabel><View style={styles.rows}>{ENGINEER_ORDERS.map((order) => <HandoffRow key={order.id} lead={<IconButton icon="construct-outline" tone={order.active ? "accent" : undefined} size={46} />} title={<><Mono style={styles.workOrderId}>{order.id}</Mono><Pill tone={order.tone}>{order.pri}</Pill></>} sub={`${order.title} - ${order.loc}`} right={order.active ? <Pill tone="progress" icon="time-outline">{order.meta}</Pill> : <Mono style={styles.roomMeta}>{order.meta}</Mono>} />)}</View></View>
      </ScrollView>
    </View>
  );
}

function FrontDeskHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [stats, setStats] = useState({ newReq: "—", inProgress: "—", resolved: "—" });
  useEffect(() => { if (!isOnline) return; api.get<{ data: Array<{ status: string }> }>("/guest-requests?per_page=200").then((res) => { const requests = res.data; setStats({ newReq: String(requests.filter((r) => r.status === "open").length), inProgress: String(requests.filter((r) => r.status === "in_progress").length), resolved: String(requests.filter((r) => r.status === "resolved").length) }); }).catch(console.warn); }, [isOnline]);
  return <View style={styles.container}><View style={styles.header}><View style={styles.headerTop}><Avatar name={name} size={34} /><IconButton icon="notifications-outline" /></View><Text style={styles.headerMeta}>{t("home.frontDesk.shiftMeta")}</Text><Text style={styles.title}>{t("home.frontDesk.greeting", { name: firstName(name) })}</Text></View><ScrollView style={styles.scroll} contentContainerStyle={styles.content}><View style={styles.engineerStats}>{[{ value: stats.newReq, label: t("home.frontDesk.newRequests"), color: C.info }, { value: stats.inProgress, label: t("home.frontDesk.inProgress"), color: C.caution }, { value: stats.resolved, label: t("home.frontDesk.resolvedToday"), color: C.ready }].map((stat) => <View key={stat.label} style={styles.engineerStat}><Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text><Text style={styles.engineerStatLabel}>{stat.label}</Text></View>)}</View><View style={styles.emptyCard}><Text style={styles.emptyTitle}>{t("home.frontDesk.requestsTitle")}</Text><Text style={styles.emptyText}>{t("home.frontDesk.requestsHint")}</Text></View></ScrollView></View>;
}

function GMHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const { isOnline } = useAppStore();
  const [stats, setStats] = useState({ cleanPct: "—", openWOs: "—", newRequests: "—" });
  useEffect(() => { if (!isOnline) return; Promise.all([api.get<{ data: Array<{ status: string }> }>(`/housekeeping/board?date=${localDate()}`), api.get<{ data: Array<{ status: string }> }>("/work-orders?status=open&per_page=200"), api.get<{ data: Array<{ status: string }> }>("/guest-requests?status=open&per_page=200")]).then(([boardRes, woRes, grRes]) => { const rooms = boardRes.data; const cleanCount = rooms.filter((r) => r.status === "CLEAN" || r.status === "INSPECTED").length; setStats({ cleanPct: `${rooms.length > 0 ? Math.round((cleanCount / rooms.length) * 100) : 0}%`, openWOs: String(woRes.data.length), newRequests: String(grRes.data.length) }); }).catch(console.warn); }, [isOnline]);
  return <View style={styles.container}><View style={styles.header}><View style={styles.headerTop}><Avatar name={name} size={34} /><IconButton icon="notifications-outline" /></View><Text style={styles.headerMeta}>{t("home.gm.shiftMeta")}</Text><Text style={styles.title}>{t("home.gm.greeting", { name: firstName(name) })}</Text></View><ScrollView style={styles.scroll} contentContainerStyle={styles.content}><View style={styles.engineerStats}>{[{ value: stats.cleanPct, label: t("home.gm.roomsClean") }, { value: stats.openWOs, label: t("home.gm.openWOs"), color: C.caution }, { value: stats.newRequests, label: t("home.gm.guestRequests"), color: C.info }].map((stat) => <View key={stat.label} style={styles.engineerStat}><Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text><Text style={styles.engineerStatLabel}>{stat.label}</Text></View>)}</View><View style={styles.emptyCard}><Text style={styles.emptyTitle}>{t("home.gm.alertsTitle")}</Text><Text style={styles.emptyText}>{t("home.gm.alertsHint")}</Text></View></ScrollView></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  header: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: C.line2, backgroundColor: C.paper },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerMeta: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, color: C.ink3, marginBottom: 4 },
  title: { fontSize: 30, fontWeight: "600", lineHeight: 34, color: C.ink },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 24, gap: 13 },
  housekeepingRoot: { flex: 1, backgroundColor: C.paper },
  housekeepingScroll: { flex: 1, backgroundColor: C.paper },
  housekeepingContent: { flexGrow: 1, paddingBottom: 30 },
  housekeepingHeader: { paddingHorizontal: 18, paddingBottom: 18, backgroundColor: C.paper },
  housekeepingMeta: { marginTop: 4, fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, color: C.ink3 },
  housekeepingTitle: { marginTop: 5, fontSize: 31, lineHeight: 35, fontWeight: "700", color: C.ink },
  housekeepingSubtitle: { marginTop: 7, fontSize: 14.5, lineHeight: 21, color: C.ink2 },
  connectionPill: { minHeight: 32, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1 },
  connectionPillOnline: { backgroundColor: C.readySoft, borderColor: C.readyLine },
  connectionPillOffline: { backgroundColor: C.cautionSoft, borderColor: C.cautionLine },
  connectionDot: { width: 6, height: 6, borderRadius: 3 },
  connectionDotOnline: { backgroundColor: C.ready },
  connectionDotOffline: { backgroundColor: C.caution },
  connectionText: { fontSize: 11, fontWeight: "800", color: C.ink2 },
  progressCard: { marginTop: 16, backgroundColor: C.surface, borderRadius: R.xl, borderWidth: 1, borderColor: C.line2, padding: 15, shadowColor: C.ink, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  progressTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressKicker: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.9, color: C.primary },
  progressValue: { marginTop: 3, fontFamily: monoFont, fontSize: 28, lineHeight: 31, fontWeight: "800", color: C.ink },
  progressBadge: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentLine },
  progressBadgeText: { color: C.accent, fontSize: 12.5, fontWeight: "900" },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: C.surface3, overflow: "hidden", marginTop: 12 },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: C.accent },
  progressCaption: { marginTop: 9, color: C.ink3, fontSize: 12, fontWeight: "700" },
  housekeepingBody: { paddingHorizontal: 18, gap: 13 },
  nextRoomPanel: { backgroundColor: C.surface, borderRadius: 24, borderWidth: 1, borderColor: C.line, padding: 16, gap: 14, shadowColor: C.ink, shadowOpacity: 0.07, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 3 },
  panelTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  panelEyebrow: { fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 1, color: C.primary },
  nextRoomMainRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  roomNumberPlate: { width: 86, minHeight: 84, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  roomNumberText: { fontFamily: monoFont, fontSize: 31, lineHeight: 35, fontWeight: "900" },
  nextRoomCopy: { flex: 1, minWidth: 0 },
  nextRoomTitle: { fontSize: 20, lineHeight: 24, fontWeight: "800", color: C.ink },
  nextRoomSubtitle: { marginTop: 2, fontSize: 12.5, fontWeight: "700", color: C.ink3 },
  nextRoomReason: { marginTop: 7, fontSize: 13.2, lineHeight: 19, color: C.ink2 },
  flagRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  miniFlag: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 5 },
  miniFlagText: { fontSize: 10.5, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.45 },
  primaryStartButton: { minHeight: 52, borderRadius: 16, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  primaryStartText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  resumeStrip: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 42, paddingHorizontal: 12, borderRadius: 13, backgroundColor: C.cautionSoft, borderWidth: 1, borderColor: C.cautionLine },
  resumeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.caution },
  resumeStripText: { flex: 1, fontSize: 12.5, fontWeight: "800", color: C.caution },
  emptyHeroTitle: { fontSize: 20, fontWeight: "800", color: C.ink },
  emptyHeroText: { fontSize: 13, lineHeight: 19, color: C.ink2 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  shiftMetric: { width: "48.5%", minHeight: 92, backgroundColor: C.surface, borderWidth: 1, borderRadius: R.lg, paddingHorizontal: 13, paddingVertical: 12 },
  shiftMetricValue: { fontFamily: monoFont, fontSize: 23, lineHeight: 26, fontWeight: "900" },
  shiftMetricLabel: { marginTop: 5, color: C.ink, fontSize: 12.5, fontWeight: "800" },
  shiftMetricHelper: { marginTop: 2, color: C.ink3, fontSize: 10.8, lineHeight: 14 },
  routeCard: { backgroundColor: C.surface, borderRadius: R.xl, borderWidth: 1, borderColor: C.line, padding: 15, gap: 12 },
  sectionHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  sectionEyebrow: { fontSize: 10.5, fontWeight: "900", letterSpacing: 0.9, textTransform: "uppercase", color: C.primary },
  sectionTitle: { marginTop: 2, fontSize: 16, fontWeight: "800", color: C.ink },
  sectionAction: { color: C.accent, fontSize: 12.5, fontWeight: "900" },
  routeRows: { gap: 8 },
  routeRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 58, borderRadius: 15, backgroundColor: C.surface2, paddingHorizontal: 11, paddingVertical: 9 },
  routePosition: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: C.surface, borderWidth: 1, borderColor: C.line2 },
  routePositionText: { fontSize: 11, color: C.ink3, fontWeight: "900" },
  routeRoomBlock: { flex: 1, minWidth: 0 },
  routeRoomNumber: { color: C.ink, fontSize: 14, fontWeight: "800" },
  routeRoomMeta: { marginTop: 2, color: C.ink3, fontSize: 11.5, fontWeight: "600" },
  routeRight: { alignItems: "flex-end", gap: 4 },
  routeEta: { fontSize: 11, fontWeight: "900" },
  briefingPanel: { borderRadius: R.xl, borderWidth: 1, borderColor: C.aiLine, backgroundColor: C.surface, padding: 15, gap: 12 },
  briefingHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  briefingTitleWrap: { flexDirection: "row", alignItems: "center", gap: 7 },
  aiDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.ai },
  briefingEyebrow: { fontSize: 11, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.9, color: C.ai },
  briefingRefresh: { minHeight: 34, borderRadius: 999, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: C.aiSoft, borderWidth: 1, borderColor: C.aiLine },
  briefingRefreshText: { color: C.ai, fontSize: 11.5, fontWeight: "900" },
  briefingHeadline: { color: C.ink, fontSize: 14.5, lineHeight: 20, fontWeight: "700" },
  briefingPlanRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  planChip: { minWidth: 42, minHeight: 34, paddingHorizontal: 10, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: C.aiSoft, borderWidth: 1, borderColor: C.aiLine },
  planChipText: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "900", color: C.ai },
  watchoutList: { gap: 7 },
  watchoutRow: { flexDirection: "row", alignItems: "flex-start", gap: 7 },
  watchoutText: { flex: 1, color: C.ink2, fontSize: 12.4, lineHeight: 17 },
  briefingFooterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10, paddingTop: 2 },
  briefingFooter: { flex: 1, color: C.ink3, fontSize: 11.5, fontWeight: "700" },
  askAiText: { color: C.ai, fontSize: 12.5, fontWeight: "900" },
  nudgeCard: { flexDirection: "row", alignItems: "flex-start", gap: 11, backgroundColor: C.accentSoft, borderWidth: 1, borderColor: C.accentLine, borderRadius: R.lg, padding: 14 },
  nudgeIconWrap: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.surface, alignItems: "center", justifyContent: "center" },
  nudgeBody: { flex: 1, gap: 3 },
  nudgeKicker: { fontSize: 10.5, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase", color: C.primary },
  nudgeText: { fontSize: 13, lineHeight: 19, color: C.ink },
  myRoomsButton: { minHeight: 52, borderRadius: 17, backgroundColor: C.accent, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 2 },
  myRoomsButtonText: { color: "#fff", fontSize: 14.5, fontWeight: "900" },
  heroStrong: { fontFamily: monoFont, fontStyle: "normal", fontWeight: "700", color: C.paper },
  heroFootText: { color: "rgba(241,237,228,0.5)", fontSize: 10.5 },
  seeAll: { fontSize: 12, color: C.accent, fontWeight: "600" },
  rows: { gap: 8 },
  roomMeta: { fontSize: 11, color: C.ink3 },
  emptyCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, padding: 16 },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 12, color: C.ink3, marginTop: 4 },
  engineerStats: { flexDirection: "row", gap: 9 },
  engineerStat: { flex: 1, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, paddingHorizontal: 14, paddingVertical: 13 },
  engineerStatValue: { fontSize: 26, lineHeight: 28, color: C.ink },
  engineerStatLabel: { color: C.ink3, fontSize: 11, marginTop: 5 },
  pmCard: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.cautionSoft, borderWidth: 1, borderColor: C.cautionLine, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pmBody: { flex: 1 },
  pmTitle: { color: C.ink, fontSize: 13.5, fontWeight: "700" },
  pmText: { color: C.caution, fontSize: 11.5, marginTop: 2 },
  workOrderId: { color: C.ink3, fontSize: 11, fontWeight: "700" },
});
