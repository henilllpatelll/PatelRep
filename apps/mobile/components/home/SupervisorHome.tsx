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
import { localDate, dynamicShiftMeta } from "@/lib/utils/date";
import { getGreetingKey } from "@/lib/ai/companion";
import { fetchAssignableStaff, fetchBoard } from "@/lib/api/housekeepingSupervisor";
import {
  buildFloorSnapshot,
  buildNameById,
  buildTeamLoads,
  normalizeBoardRooms,
  sortRoomsByNumber,
  type FloorRoom,
} from "@/lib/housekeeping/supervisor";
import { C, R, shellTokens } from "@/components/shared/tokens";
import { getStatusMeta } from "@/components/shared/evening";
import { Avatar, IconButton, SectionLabel } from "@/components/shared/mobileHandoff";
import { FloorMosaic, HeroSignalRow, TeamLoadRow, type HeroSignal } from "@/components/supervisor/atoms";

/* ─── Supervisor Home — the floor pulse ─────────────────────────────────────
   The whole hotel in one glance: a board-wide mosaic on the dark hero,
   nonzero-only signals, then the two things that need the supervisor now
   (inspection queue, unassigned rooms) and the team's live progress. */

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "there";
}

export function SupervisorHome({ name }: { name: string }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isOnline, user } = useAppStore();

  const [rooms, setRooms] = useState<FloorRoom[]>([]);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    const [boardRes, staffRes] = await Promise.allSettled([
      fetchBoard(localDate()),
      fetchAssignableStaff(),
    ]);
    if (boardRes.status === "fulfilled") setRooms(normalizeBoardRooms(boardRes.value));
    if (staffRes.status === "fulfilled") setNameById(buildNameById(staffRes.value));
    setLoading(false);
  }, [isOnline]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("supervisor-home-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_status", filter: `tenant_id=eq.${user.tenant_id}` },
        () => {
          load();
        },
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

  const snapshot = useMemo(() => buildFloorSnapshot(rooms), [rooms]);
  const teamLoads = useMemo(() => buildTeamLoads(rooms, nameById), [rooms, nameById]);
  const mosaicRooms = useMemo(() => sortRoomsByNumber(rooms), [rooms]);

  const signals = useMemo<HeroSignal[]>(
    () =>
      [
        snapshot.unassigned > 0 && {
          key: "unassigned",
          label: t("home.supervisor.signalUnassigned", { count: snapshot.unassigned }),
          fg: C.alert,
          bg: C.alertSoft,
          line: C.alertLine,
        },
        snapshot.submitted > 0 && {
          key: "toInspect",
          label: t("home.supervisor.signalToInspect", { count: snapshot.submitted }),
          fg: C.info,
          bg: C.infoSoft,
          line: C.infoLine,
        },
        snapshot.dnd > 0 && {
          key: "dnd",
          label: t("home.supervisor.signalDnd", { count: snapshot.dnd }),
          fg: C.ink2,
          bg: C.surface3,
          line: C.line,
        },
        snapshot.vip > 0 && {
          key: "vip",
          label: t("home.supervisor.signalVip", { count: snapshot.vip }),
          fg: C.brass,
          bg: C.brassSoft,
          line: C.brassLine,
        },
      ].filter(Boolean) as HeroSignal[],
    [snapshot, t],
  );

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
            <TouchableOpacity onPress={() => router.push("/(app)/notifications" as never)} activeOpacity={0.8}>
              <IconButton icon="notifications-outline" />
            </TouchableOpacity>
          </View>
          <Text style={styles.heroKicker}>
            {dynamicShiftMeta(user?.language_pref ?? "en", t("home.supervisor.shiftMeta"))}
          </Text>
          <Text style={styles.heroTitle}>{t(getGreetingKey(), { name: firstName(name) })}</Text>
          {snapshot.total > 0 ? (
            <>
              <Text style={styles.heroSummary}>
                {t("home.supervisor.heroSummary", {
                  ready: snapshot.ready,
                  total: snapshot.total,
                  working: snapshot.inProgress,
                })}
              </Text>
              <FloorMosaic rooms={mosaicRooms} getLabel={(status) => getStatusMeta(status).label} />
              <HeroSignalRow signals={signals} />
            </>
          ) : (
            <Text style={styles.heroSummary}>{t("home.supervisor.emptyBoard")}</Text>
          )}
        </View>

        <View style={styles.body}>
          {/* What needs the supervisor right now */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionCard, snapshot.submitted > 0 && styles.actionCardInfo]}
              onPress={() => router.push("/(app)/inspect" as never)}
              activeOpacity={0.82}
              testID="action-inspect"
            >
              <View style={styles.actionTopRow}>
                <Ionicons
                  name="shield-checkmark-outline"
                  size={16}
                  color={snapshot.submitted > 0 ? C.info : C.ink3}
                />
                <Text style={[styles.actionCount, snapshot.submitted > 0 && { color: C.info }]}>
                  {snapshot.submitted}
                </Text>
              </View>
              <Text style={styles.actionLabel}>{t("home.supervisor.toInspect")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionCard, snapshot.unassigned > 0 && styles.actionCardAlert]}
              onPress={() => router.push("/(app)/assignments" as never)}
              activeOpacity={0.82}
              testID="action-assign"
            >
              <View style={styles.actionTopRow}>
                <Ionicons
                  name="person-add-outline"
                  size={16}
                  color={snapshot.unassigned > 0 ? C.alert : C.ink3}
                />
                <Text style={[styles.actionCount, snapshot.unassigned > 0 && { color: C.alert }]}>
                  {snapshot.unassigned}
                </Text>
              </View>
              <Text style={styles.actionLabel}>{t("home.supervisor.unassignedRooms")}</Text>
            </TouchableOpacity>
          </View>

          {/* The team's live progress */}
          {teamLoads.length > 0 ? (
            <View>
              <SectionLabel hint={t("home.supervisor.housekeeperCount", { count: teamLoads.length })}>
                {t("home.supervisor.teamSection")}
              </SectionLabel>
              <View style={styles.rows}>
                {teamLoads.map((load) => (
                  <TeamLoadRow
                    key={load.housekeeperId}
                    load={load}
                    summary={t("home.supervisor.loadSummary", {
                      done: load.done,
                      total: load.total,
                      minutes: load.minutesLeft,
                    })}
                    onPress={() => router.push("/(app)/assignments" as never)}
                  />
                ))}
              </View>
            </View>
          ) : snapshot.total > 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("home.supervisor.noTeamYet")}</Text>
              <Text style={styles.emptyText}>{t("home.supervisor.noTeamYetHint")}</Text>
            </View>
          ) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>{t("home.supervisor.emptyBoardTitle")}</Text>
              <Text style={styles.emptyText}>{t("home.supervisor.emptyBoardHint")}</Text>
            </View>
          )}

          <TouchableOpacity
            style={styles.boardBtn}
            onPress={() => router.push("/(app)/room-board" as never)}
            activeOpacity={0.85}
            testID="open-board"
          >
            <Text style={styles.boardBtnText}>{t("home.supervisor.openBoard")}</Text>
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
  heroTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
    color: shellTokens.ink3,
    marginBottom: 4,
  },
  heroTitle: { fontSize: 30, fontWeight: "600", lineHeight: 34, color: shellTokens.ink },
  heroSummary: { marginTop: 7, fontSize: 14.5, lineHeight: 21, color: shellTokens.ink2 },

  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 14 },

  actionRow: { flexDirection: "row", gap: 10 },
  actionCard: {
    flex: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 4,
  },
  actionCardInfo: { borderColor: C.infoLine, backgroundColor: C.infoSoft },
  actionCardAlert: { borderColor: C.alertLine, backgroundColor: C.alertSoft },
  actionTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actionCount: { fontSize: 26, lineHeight: 30, fontWeight: "700", color: C.ink },
  actionLabel: { fontSize: 11.5, fontWeight: "600", color: C.ink2 },

  rows: { gap: 8 },

  emptyCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 16,
  },
  emptyTitle: { fontSize: 14, fontWeight: "700", color: C.ink },
  emptyText: { fontSize: 12, color: C.ink3, marginTop: 4 },

  boardBtn: {
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
  boardBtnText: { color: C.accent, fontSize: 13.5, fontWeight: "800" },
});
