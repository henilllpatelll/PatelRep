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
import { getRoomsByDate, upsertRooms } from "@/lib/offline/db";
import { localDate, dynamicShiftMeta } from "@/lib/utils/date";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppStore, type Room } from "@/stores/appStore";
import { R } from "@/components/shared/tokens";
import { Avatar, IconButton } from "@/components/shared/mobileHandoff";
import { AIBriefingCard } from "@/components/shared/evening";
import { FocusCard, ShiftMosaic, SignalChips } from "@/components/home/CompanionHome";
import { SupervisorHome } from "@/components/home/SupervisorHome";
import { EngineerHome } from "@/components/engineering/EngineerHome";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { buildLocalBriefing, buildSmartQueue, fetchShiftBriefing, getStartEntry, type ShiftBriefing } from "@/lib/ai/briefing";
import { buildShiftSnapshot, getCompanionCheckin, getGreetingKey } from "@/lib/ai/companion";
import { useTheme } from "@/lib/theme/useTheme";

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

export default function HousekeeperHomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, isOnline, myRooms, setMyRooms, refreshRooms } = useAppStore();
  const effectiveRole = user?.effective_role ?? user?.role;
  const isEngineer = String(effectiveRole) === "engineer";
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
    const interval = setInterval(() => { void loadRooms(); }, 45_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadRooms();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [effectiveRole, loadRooms]);

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
  const checkin = useMemo(() => getCompanionCheckin(snapshot, t), [snapshot, t]);
  const firstEntry = getStartEntry(smartQueue);
  const inProgressRoom = useMemo(
    () => myRooms.find((room) => room.status === "IN_PROGRESS") ?? null,
    [myRooms],
  );
  const openRoom = useCallback((room: Room) => {
    router.push(`/(app)/my-rooms/${room.id}`);
  }, []);

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
    <View style={[styles.companionContainer, { backgroundColor: theme.shell.bg }]}>
      <ScrollView
        style={[styles.companionScroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.companionScrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.shell.ink2} />}
      >
        {/* Dark bleed behind iOS overscroll so the hero reads full-bleed */}
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />

        {/* Evening Lobby hero — greeting, check-in, and the shift mosaic */}
        <View style={[styles.shellHeader, { paddingTop: insets.top + 10, backgroundColor: theme.shell.bg }]}>
          <View style={styles.headerTop}>
            <Avatar name={user?.full_name ?? "Staff"} size={34} />
            <IconButton icon="notifications-outline" />
          </View>
          <Text style={[styles.shellHeaderMeta, { color: theme.shell.ink3 }]}>
            {dynamicShiftMeta(user?.language_pref ?? "en", t("home.shiftSuffix"))}
          </Text>
          <Text style={[styles.shellTitle, { color: theme.shell.ink }]}>
            {t(getGreetingKey(), { name: firstName(user?.full_name) })}
          </Text>
          <Text style={[styles.shellCompanion, { color: theme.shell.ink2 }]}>{checkin.message}</Text>
          {snapshot.total > 0 ? (
            <>
              <ShiftMosaic rooms={myRooms} onPressRoom={openRoom} />
              <Text style={[styles.heroPaceLine, { color: theme.shell.ink2 }]}>
                {t("home.heroProgress", { done: snapshot.done, total: snapshot.total })}
                {snapshot.minutesLeft > 0 ? ` · ${t("home.minutesLeft", { minutes: snapshot.minutesLeft })}` : ""}
                {snapshot.finishByLabel ? ` · ${t("home.finishBy", { time: snapshot.finishByLabel })}` : ""}
              </Text>
              <SignalChips snapshot={snapshot} t={t} />
            </>
          ) : null}
        </View>

        <View style={styles.companionBody}>
          {firstEntry ? (
            <FocusCard
              entry={firstEntry}
              inProgressRoom={inProgressRoom}
              t={t}
              onStart={openRoom}
              onResume={openRoom}
            />
          ) : null}

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
                <TouchableOpacity
                  style={[
                    styles.briefingGhostBtn,
                    { borderColor: theme.shell.line, backgroundColor: theme.shell.surface },
                  ]}
                  onPress={() => void requestAiBriefing()}
                  disabled={briefingLoading}
                  activeOpacity={0.82}
                >
                  <Ionicons name="sparkles" size={12} color="#CBB8F0" />
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

          {checkin.tip ? (
            <View
              style={[styles.tipCard, { backgroundColor: theme.primarySoft, borderColor: theme.primaryLine }]}
              testID="companion-tip"
            >
              <View style={[styles.tipIconWrap, { backgroundColor: theme.surface }]}>
                <Ionicons name="leaf-outline" size={15} color={theme.primary} />
              </View>
              <View style={styles.tipBody}>
                <Text style={[styles.tipKicker, { color: theme.primary }]}>{t("home.companion.kicker")}</Text>
                <Text style={[styles.tipText, { color: theme.textPrimary }]}>{checkin.tip}</Text>
              </View>
            </View>
          ) : null}

          {snapshot.stage === "done" || snapshot.stage === "empty" ? (
            <StateBlock
              status="empty"
              emptyIcon="checkmark-circle-outline"
              emptyTitle={t("home.allDone")}
              emptyBody={t("home.pullToRefresh")}
              style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
            />
          ) : null}

          <Button
            label={t("home.openMyRooms")}
            onPress={() => router.push("/(app)/my-rooms" as never)}
            variant="secondary"
            icon="arrow-forward"
          />
        </View>
      </ScrollView>
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
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  shellHeaderMeta: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 4,
  },
  shellTitle: {
    fontSize: 30,
    fontWeight: "600",
    lineHeight: 34,
  },
  shellCompanion: {
    marginTop: 7,
    fontSize: 14.5,
    lineHeight: 21,
  },
  heroPaceLine: {
    marginTop: 12,
    fontSize: 12,
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
  tipCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    borderWidth: 1,
    borderRadius: R.lg,
    padding: 14,
  },
  tipIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  tipBody: { flex: 1, gap: 3 },
  tipKicker: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  tipText: {
    fontSize: 13,
    lineHeight: 19,
  },
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
