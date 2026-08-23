import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { listNotifications, markRead, type AppNotification } from "@/lib/api/notifications";
import { endShift, getCurrentShift, startShift, type ShiftSession } from "@/lib/api/shifts";
import { getRoomsByDate, upsertRooms } from "@/lib/offline/db";
import { localDate, dynamicShiftMeta } from "@/lib/utils/date";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, type Room } from "@/stores/appStore";
import { R, monoFont, serifFont } from "@/components/shared/tokens";
import { Avatar, IconButton } from "@/components/shared/mobileHandoff";
import { AIBriefingCard } from "@/components/shared/evening";
import { FocusCard, NeedsYouRow, ShiftProgressCard, type NeedsYouItem } from "@/components/home/CompanionHome";
import { EmptyBoardState } from "@/components/home/EmptyBoardState";
import { EndOfShiftState } from "@/components/home/EndOfShiftState";
import HoldToConfirmSheet from "@/components/home/HoldToConfirmSheet";
import { SupervisorHome } from "@/components/home/SupervisorHome";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { buildLocalBriefing, buildSmartQueue, estimateCleanMinutes, fetchShiftBriefing, getStartEntry, type ShiftBriefing } from "@/lib/ai/briefing";
import { fetchShiftRecap, type ShiftRecap } from "@/lib/ai/shiftRecap";
import { buildShiftSnapshot, getCompanionCheckin, getGreetingKey } from "@/lib/ai/companion";
import { listItems, type LostFoundItem } from "@/lib/api/lostFound";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

function formatClockTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function HousekeeperHomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { user, isOnline, myRooms, setMyRooms, refreshRooms } = useAppStore();
  const effectiveRole = user?.effective_role ?? user?.role;
  const isEngineer = String(effectiveRole) === "engineer";
  const [loading, setLoading] = useState(myRooms.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [aiBriefing, setAiBriefing] = useState<ShiftBriefing | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [supervisorNote, setSupervisorNote] = useState<AppNotification | null>(null);
  const [shiftSession, setShiftSession] = useState<ShiftSession | null>(null);
  const [holdConfirmRoom, setHoldConfirmRoom] = useState<Room | null>(null);
  const [clockingOut, setClockingOut] = useState(false);
  const [clockedOut, setClockedOut] = useState(false);
  const [shiftRecap, setShiftRecap] = useState<ShiftRecap | null>(null);
  const [shiftRecapLoading, setShiftRecapLoading] = useState(false);
  const [todaysFoundItems, setTodaysFoundItems] = useState<LostFoundItem[]>([]);
  const language: "en" | "es" = user?.language_pref === "es" ? "es" : "en";

  // Best-effort — the shift timeline degrades to a plain progress bar when
  // this hasn't resolved yet (offline, or the request failed).
  const loadShiftSession = useCallback(async () => {
    if (!isOnline) return;
    try {
      const existing = await getCurrentShift();
      setShiftSession(existing ?? (await startShift()));
    } catch {
      // Leave shiftSession as-is; ShiftProgressCard falls back to the plain bar.
    }
  }, [isOnline]);

  const loadSupervisorNote = useCallback(async () => {
    if (!isOnline) return;
    try {
      const result = await listNotifications(false);
      const note = result.data.find((n) => n.type === "direct_message" || n.type === "broadcast");
      setSupervisorNote(note ?? null);
    } catch {
      // Best-effort — Home should never block on a notifications fetch failure.
    }
  }, [isOnline]);

  const acknowledgeSupervisorNote = useCallback(async () => {
    if (!supervisorNote) return;
    const id = supervisorNote.id;
    setSupervisorNote(null);
    try {
      await markRead(id);
    } catch {
      // Leave it dismissed locally; it will reappear on the next unread fetch if the write failed.
    }
  }, [supervisorNote]);

  const loadRooms = useCallback(async () => {
    if (isOnline) {
      try {
        const result = await api.get<{ data: Room[] }>(`/housekeeping/my-rooms?date=${localDate()}`);
        setMyRooms(result.data);
        await upsertRooms(result.data);
        setLastCheckedAt(new Date());
      } catch {
        const cached = (await getRoomsByDate(localDate())) as Room[];
        setMyRooms(cached);
      }
    } else {
      const cached = (await getRoomsByDate(localDate())) as Room[];
      setMyRooms(cached);
    }
    setLoading(false);
  }, [isOnline, setMyRooms]);

  useEffect(() => {
    if (effectiveRole !== "housekeeper") return;
    void loadRooms();
    void loadSupervisorNote();
    void loadShiftSession();
    const interval = setInterval(() => {
      void loadRooms();
      void loadSupervisorNote();
    }, 45_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void loadRooms();
        void loadSupervisorNote();
        void loadShiftSession();
      }
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [effectiveRole, loadRooms, loadSupervisorNote, loadShiftSession]);

  // Refresh room counts when navigating back from the room detail screen
  // so the home counter reflects the latest status immediately.
  useFocusEffect(
    useCallback(() => {
      if (effectiveRole === "housekeeper") void refreshRooms();
    }, [effectiveRole, refreshRooms]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  // Earliest upcoming VIP arrival — a real, calendar-backed marker for the
  // shift timeline (never a fabricated/scheduled time we don't have data for).
  const nextVipArrival = useMemo(() => {
    const now = Date.now();
    const times = myRooms
      .filter((room) => room.vip_flag && room.checkin_time)
      .map((room) => new Date(room.checkin_time as string).getTime())
      .filter((time) => Number.isFinite(time) && time > now);
    return times.length > 0 ? new Date(Math.min(...times)) : null;
  }, [myRooms]);
  const shiftStart = useMemo(() => {
    if (!shiftSession?.started_at) return null;
    const date = new Date(shiftSession.started_at);
    return Number.isNaN(date.getTime()) ? null : date;
  }, [shiftSession]);

  const openWorkOrderRooms = useMemo(
    () => myRooms.filter((room) => room.open_work_order_id),
    [myRooms],
  );

  const smartQueue = useMemo(() => buildSmartQueue(myRooms), [myRooms]);
  const localBriefing = useMemo(
    () => (myRooms.length > 0 ? buildLocalBriefing(myRooms, t) : null),
    [myRooms, t],
  );
  const briefing = aiBriefing ?? localBriefing;
  const snapshot = useMemo(
    () => buildShiftSnapshot(myRooms, language === "es" ? "es-MX" : "en-US"),
    [myRooms, language],
  );
  const companionCheckin = useMemo(() => getCompanionCheckin(snapshot, t), [snapshot, t]);

  // Fires once per shift when the board clears — mirrors requestAiBriefing's
  // fetch-with-local-fallback pattern, just for the end-of-shift recap instead.
  useEffect(() => {
    if (snapshot.stage !== "done" || shiftRecap || shiftRecapLoading || myRooms.length === 0) return;
    setShiftRecapLoading(true);
    void fetchShiftRecap(myRooms, language, t, isOnline).then((result) => {
      setShiftRecap(result);
      setShiftRecapLoading(false);
    });
  }, [snapshot.stage, shiftRecap, shiftRecapLoading, myRooms, language, t, isOnline]);

  // Real "before you clock out" signals — today's lost & found items this
  // housekeeper logged, surfaced once the board is clear.
  useEffect(() => {
    if (snapshot.stage !== "done" || !isOnline || !user?.id) return;
    listItems()
      .then((res) => {
        const today = localDate();
        setTodaysFoundItems(
          (res.data ?? []).filter(
            (item) => item.found_by === user.id && (item.created_at ?? "").slice(0, 10) === today,
          ),
        );
      })
      .catch(() => {});
  }, [snapshot.stage, isOnline, user?.id]);
  const shiftDurationLabel = useMemo(() => {
    if (!shiftStart) return null;
    const totalMinutes = Math.max(0, Math.round((Date.now() - shiftStart.getTime()) / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  }, [shiftStart]);
  // Snapshotted when the sheet opens rather than ticking live — it's a short-lived
  // modal, not worth a second interval alongside FocusCard's own elapsed timer.
  const holdConfirmElapsedSec = useMemo(() => {
    if (!holdConfirmRoom?.updated_at) return 0;
    const started = new Date(holdConfirmRoom.updated_at).getTime();
    return Number.isNaN(started) ? 0 : Math.max(0, Math.floor((Date.now() - started) / 1000));
  }, [holdConfirmRoom]);
  const firstEntry = getStartEntry(smartQueue);
  const inProgressRoom = useMemo(
    () => myRooms.find((room) => room.status === "IN_PROGRESS") ?? null,
    [myRooms],
  );
  // The room actively being cleaned always leads the focus card — matching the
  // "Right now" design intent, a flagged note or open work order shouldn't hide
  // the live timer on a room the housekeeper already has open.
  const focusEntry = useMemo(() => {
    if (inProgressRoom) {
      const minutes = estimateCleanMinutes(inProgressRoom);
      return { room: inProgressRoom, position: 1, estimateMinutes: minutes, etaMinutes: minutes };
    }
    return firstEntry;
  }, [inProgressRoom, firstEntry]);
  const openRoom = useCallback((room: Room) => {
    router.push(`/(app)/my-rooms/${room.id}`);
  }, []);
  const openMyRooms = useCallback(() => router.push("/(app)/my-rooms" as never), []);

  // The focus card's primary button doubles as "Start cleaning" (room not yet
  // in progress) and "Mark clean" (room in progress). Only the latter — and
  // only for non-DEP rooms, which don't need the detail screen's linen-count
  // fields — gets the quick hold-to-confirm sheet; everything else still opens
  // the full room screen, same as before.
  const openOrConfirmRoom = useCallback((room: Room) => {
    if (room.status === "IN_PROGRESS" && room.clean_type !== "DEP") {
      setHoldConfirmRoom(room);
      return;
    }
    openRoom(room);
  }, [openRoom]);

  const handleRoomConfirmed = useCallback(
    (roomId: string) => {
      setHoldConfirmRoom(null);
      const updatedAt = new Date().toISOString();
      setMyRooms(myRooms.map((r) => (r.id === roomId ? { ...r, status: "CLEAN", updated_at: updatedAt } : r)));
      void refreshRooms();
    },
    [myRooms, setMyRooms, refreshRooms],
  );

  const handleClockOut = useCallback(async () => {
    setClockingOut(true);
    try {
      await endShift();
      setClockedOut(true);
    } catch (err: unknown) {
      toast.error((err as Error).message ?? t("home.endOfShift.clockOutFailed"));
    } finally {
      setClockingOut(false);
    }
  }, [toast, t]);

  // Real, actionable signals only — never a fabricated inbox. An explicit
  // supervisor message leads (it's a direct instruction, not an inferred
  // signal), then priority mirrors the companion tip's (attention > DND >
  // arrivals); capped at three so the stack stays scannable, matching the
  // "Right now" design direction.
  const needsYouItems = useMemo(() => {
    const items: NeedsYouItem[] = [];
    if (supervisorNote) {
      items.push({
        key: "message",
        icon: "chatbubble-ellipses-outline",
        tone: "info",
        title: supervisorNote.title,
        subtitle: supervisorNote.body,
        actionLabel: t("home.needsYou.gotIt"),
        onPress: () => void acknowledgeSupervisorNote(),
      });
    }
    if (snapshot.attention > 0) {
      items.push({
        key: "review",
        icon: "alert-circle-outline",
        tone: "alert",
        title: t("home.signal.review", { count: snapshot.attention }),
        subtitle: t("home.needsYou.reviewSubtitle"),
        actionLabel: t("rooms.detail.primary.view"),
        onPress: openMyRooms,
      });
    }
    if (snapshot.dndCount > 0) {
      items.push({
        key: "dnd",
        icon: "moon-outline",
        tone: "caution",
        title: t("home.signal.dnd", { count: snapshot.dndCount }),
        subtitle: t("home.needsYou.dndSubtitle"),
        actionLabel: t("rooms.detail.primary.view"),
        onPress: openMyRooms,
      });
    }
    if (snapshot.arrivals > 0) {
      items.push({
        key: "arrivals",
        icon: "time-outline",
        tone: "info",
        title: t("home.signal.arrivals", { count: snapshot.arrivals }),
        subtitle: t("home.needsYou.arrivalsSubtitle"),
        actionLabel: t("rooms.detail.primary.view"),
        onPress: openMyRooms,
      });
    }
    return items.slice(0, 3);
  }, [snapshot, t, openMyRooms, supervisorNote, acknowledgeSupervisorNote]);

  const requestAiBriefing = useCallback(async () => {
    if (briefingLoading || myRooms.length === 0) return;
    setBriefingLoading(true);
    const result = await fetchShiftBriefing(myRooms, language, t, isOnline);
    setAiBriefing(result);
    setBriefingLoading(false);
  }, [briefingLoading, myRooms, language, t, isOnline]);

  if (isEngineer) {
    return <EngineerHome name={user?.full_name ?? "Engineer"} />;
  }

  if (effectiveRole === "housekeeping_supervisor") {
    return <SupervisorHome name={user?.full_name ?? "Supervisor"} />;
  }

  if (effectiveRole === "front_desk") {
    return <FrontDeskHomeScreen name={user?.full_name ?? "Front Desk"} />;
  }

  if (effectiveRole === "gm") {
    return <GMHomeScreen name={user?.full_name ?? "GM"} />;
  }

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.companionContainer, { backgroundColor: theme.background }]}>
      <ScrollView
        style={[styles.companionScroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.companionScrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.textSecondary} />}
      >
        {/* Overscroll bleed matches the flat cream canvas — no separate dark hero band */}
        <View style={[styles.topBleed, { backgroundColor: theme.background }]} />

        <View style={[styles.shellHeader, { paddingTop: insets.top + 10, backgroundColor: theme.background }]}>
          <View style={styles.shellHeaderRow}>
            <View style={styles.shellHeaderTextCol}>
              <Text style={[styles.shellHeaderMeta, { color: theme.textMuted }]}>
                {dynamicShiftMeta(user?.language_pref ?? "en", t("home.shiftSuffix"))}
              </Text>
              <Text style={[styles.shellTitle, { color: theme.textPrimary }]}>
                {t(getGreetingKey(), { name: firstName(user?.full_name) })}
              </Text>
            </View>
            <View style={styles.shellHeaderActions}>
              <Avatar name={user?.full_name ?? "Staff"} size={34} />
              <IconButton icon="notifications-outline" />
            </View>
          </View>
        </View>

        <View style={styles.companionBody}>
          {focusEntry ? (
            <FocusCard
              entry={focusEntry}
              inProgressRoom={inProgressRoom}
              t={t}
              onStart={openOrConfirmRoom}
              onResume={openRoom}
            />
          ) : null}

          {snapshot.stage !== "done" ? (
            <ShiftProgressCard snapshot={snapshot} t={t} shiftStart={shiftStart} nextVipArrival={nextVipArrival} />
          ) : null}

          {needsYouItems.length > 0 || (briefing && snapshot.stage !== "done") ? (
            <View style={styles.needsSection}>
              <View style={styles.needsSectionHeader}>
                <Text style={[styles.needsSectionTitle, { color: theme.textMuted }]}>{t("home.needsYou.title")}</Text>
                <Text style={[styles.needsSectionCount, { color: theme.textDisabled }]}>
                  {needsYouItems.length + (briefing && snapshot.stage !== "done" ? 1 : 0)}
                </Text>
              </View>
              {needsYouItems.map((item) => (
                <NeedsYouRow key={item.key} item={item} />
              ))}
              {briefing && snapshot.stage !== "done" ? (
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
                    <TouchableOpacity
                      style={[
                        styles.briefingGhostBtn,
                        { borderColor: theme.shell.line, backgroundColor: theme.shell.surface },
                      ]}
                      onPress={() => void requestAiBriefing()}
                      disabled={briefingLoading}
                      activeOpacity={0.82}
                    >
                      <Ionicons name="sparkles" size={12} color={theme.ai.primary} />
                      <Text style={[styles.briefingGhostText, { color: theme.shell.ink2 }]}>
                        {t("ai.briefing.refresh")}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.briefingGhostBtn,
                        { borderColor: theme.shell.line, backgroundColor: theme.shell.surface },
                      ]}
                      onPress={() => router.push("/(app)/copilot")}
                      activeOpacity={0.82}
                    >
                      <Text style={[styles.briefingGhostText, { color: theme.shell.ink2 }]}>{t("home.askAI")}</Text>
                    </TouchableOpacity>
                  </View>
                </AIBriefingCard>
              ) : null}
            </View>
          ) : null}

          {snapshot.stage === "empty" ? (
            <EmptyBoardState
              message={companionCheckin.message}
              hint={t("home.pullToRefresh")}
              waitingLabel={
                lastCheckedAt
                  ? t("home.emptyBoard.waiting", { time: formatClockTime(lastCheckedAt) })
                  : null
              }
              actions={[
                {
                  key: "my-rooms",
                  icon: "list-outline",
                  label: t("home.openMyRooms"),
                  hint: t("home.emptyBoard.myRoomsHint"),
                  onPress: openMyRooms,
                },
                {
                  key: "ask-ai",
                  icon: "sparkles-outline",
                  label: t("home.askAI"),
                  hint: t("home.emptyBoard.askAiHint"),
                  onPress: () => router.push("/(app)/copilot"),
                },
              ]}
            />
          ) : null}

          {snapshot.stage === "done" ? (
            <EndOfShiftState
              message={companionCheckin.message}
              subMessage={t("home.allDone")}
              roomsCleanedLabel={t("home.endOfShift.roomsCleaned", { count: snapshot.done })}
              shiftDurationLabel={
                shiftDurationLabel ? t("home.endOfShift.shiftDuration", { duration: shiftDurationLabel }) : null
              }
              clockOutLabel={t("home.endOfShift.clockOut")}
              clockedOutLabel={t("home.endOfShift.clockedOut")}
              clockedOut={clockedOut}
              clockingOut={clockingOut}
              onClockOut={() => void handleClockOut()}
              aiRecap={shiftRecap}
              aiRecapLoading={shiftRecapLoading}
              aiRecapKicker={t("home.endOfShift.recapKicker")}
              aiRecapFootNoteAi={t("ai.briefing.sourceAi")}
              aiRecapFootNoteLocal={t("ai.briefing.sourceLocal")}
              handoffRooms={openWorkOrderRooms.map((room) => ({
                roomNumber: room.room_number,
                workOrderId: room.open_work_order_id as string,
                title: room.open_work_order_title ?? null,
              }))}
              foundItemsCount={todaysFoundItems.length}
              onOpenWorkOrder={(workOrderId) =>
                router.push({ pathname: "/(app)/work-orders/[woId]", params: { woId: workOrderId } } as never)
              }
              onOpenLostFound={() => router.push("/(app)/lost-found" as never)}
              beforeClockOutLabel={t("home.endOfShift.beforeClockOut")}
              handoffLabel={(room) =>
                t("home.endOfShift.handoff", { room: room.roomNumber, title: room.title ?? t("home.endOfShift.handoffGeneric") })
              }
              foundItemsLabel={(count) => t("home.endOfShift.foundItems", { count })}
            />
          ) : null}

          {snapshot.stage !== "empty" ? (
            <Button
              label={t("home.openMyRooms")}
              onPress={openMyRooms}
              variant="secondary"
              icon="arrow-forward"
            />
          ) : null}
        </View>
      </ScrollView>

      {holdConfirmRoom ? (
        <HoldToConfirmSheet
          visible
          room={holdConfirmRoom}
          elapsedSec={holdConfirmElapsedSec}
          nextUp={firstEntry && firstEntry.room.id !== holdConfirmRoom.id ? firstEntry : null}
          onClose={() => setHoldConfirmRoom(null)}
          onConfirmed={handleRoomConfirmed}
        />
      ) : null}
    </View>
  );
}

function FrontDeskHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{t("home.frontDesk.shiftMeta")}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("home.frontDesk.greeting", { name: firstName(name) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.engineerStats}>
          {[
            { value: stats.newReq, label: t("home.frontDesk.newRequests"), color: theme.status.clean },
            { value: stats.inProgress, label: t("home.frontDesk.inProgress"), color: theme.status.pickup },
            { value: stats.resolved, label: t("home.frontDesk.resolvedToday"), color: theme.status.ready },
          ].map((stat) => (
            <Card key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, stat.color ? { color: stat.color } : undefined]}>{stat.value}</Text>
              <Text style={[styles.engineerStatLabel, { color: theme.textMuted }]}>{stat.label}</Text>
            </Card>
          ))}
        </View>
        <StateBlock
          status="empty"
          emptyIcon="chatbubbles-outline"
          emptyTitle={t("home.frontDesk.requestsTitle")}
          emptyBody={t("home.frontDesk.requestsHint")}
          style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
        />
      </ScrollView>
    </View>
  );
}

function GMHomeScreen({ name }: { name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
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
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.borderSubtle, backgroundColor: theme.background }]}>
        <View style={styles.headerTop}>
          <Avatar name={name} size={34} />
          <IconButton icon="notifications-outline" />
        </View>
        <Text style={[styles.headerMeta, { color: theme.textMuted }]}>{t("home.gm.shiftMeta")}</Text>
        <Text style={[styles.title, { color: theme.textPrimary }]}>{t("home.gm.greeting", { name: firstName(name) })}</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.engineerStats}>
          {[
            { value: stats.cleanPct, label: t("home.gm.roomsClean") },
            { value: stats.openWOs, label: t("home.gm.openWOs"), color: theme.status.pickup },
            { value: stats.newRequests, label: t("home.gm.guestRequests"), color: theme.status.clean },
          ].map((stat) => (
            <Card key={stat.label} style={styles.engineerStat}>
              <Text style={[styles.engineerStatValue, { color: stat.color ?? theme.textPrimary }]}>{stat.value}</Text>
              <Text style={[styles.engineerStatLabel, { color: theme.textMuted }]}>{stat.label}</Text>
            </Card>
          ))}
        </View>
        <StateBlock
          status="empty"
          emptyIcon="notifications-outline"
          emptyTitle={t("home.gm.alertsTitle")}
          emptyBody={t("home.gm.alertsHint")}
          style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
    borderBottomWidth: 1,
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
    marginBottom: 4,
  },
  title: {
    fontSize: 30,
    fontWeight: "600",
    lineHeight: 34,
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
  companionContainer: {
    flex: 1,
  },
  companionScroll: {
    flex: 1,
  },
  companionScrollContent: {
    flexGrow: 1,
  },
  topBleed: {
    position: "absolute",
    top: -600,
    left: 0,
    right: 0,
    height: 600,
  },
  companionBody: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
    gap: 13,
  },
  shellHeader: {
    paddingHorizontal: 18,
    paddingBottom: 14,
  },
  shellHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  shellHeaderTextCol: {
    flex: 1,
    minWidth: 0,
  },
  shellHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  shellHeaderMeta: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  shellTitle: {
    fontFamily: serifFont,
    fontSize: 30,
    lineHeight: 34,
  },
  needsSection: {
    gap: 8,
  },
  needsSectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  needsSectionTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  needsSectionCount: {
    fontFamily: monoFont,
    fontSize: 11,
    fontWeight: "700",
  },
  briefingActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  briefingGhostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 13,
    justifyContent: "center",
  },
  briefingGhostText: { fontSize: 12.5, fontWeight: "700" },
  emptyCard: {
    borderWidth: 1,
    borderRadius: R.lg,
    padding: 16,
  },
  engineerStats: {
    flexDirection: "row",
    gap: 9,
  },
  engineerStat: {
    flex: 1,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  engineerStatValue: {
    fontSize: 26,
    lineHeight: 28,
  },
  engineerStatLabel: {
    fontSize: 11,
    marginTop: 5,
  },
});
