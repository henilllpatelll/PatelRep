import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { localDate, localTzOffset, dynamicShiftMeta } from "@/lib/utils/date";
import { getGreetingKey } from "@/lib/ai/companion";
import { fetchAssignableStaff, fetchBoard } from "@/lib/api/housekeepingSupervisor";
import ShiftNoteModal from "@/components/supervisor/ShiftNoteModal";
import BroadcastModal from "@/components/supervisor/BroadcastModal";
import DirectMessageModal from "@/components/supervisor/DirectMessageModal";
import EndShiftModal from "@/components/supervisor/EndShiftModal";
import {
  buildFloorSnapshot,
  buildNameById,
  buildTeamLoads,
  normalizeBoardRooms,
  sortRoomsByNumber,
  type FloorRoom,
} from "@/lib/housekeeping/supervisor";
import { api } from "@/lib/api/client";
import { R } from "@/components/shared/tokens";
import { useTheme } from "@/lib/theme/useTheme";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
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
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { isOnline, user } = useAppStore();

  const [rooms, setRooms] = useState<FloorRoom[]>([]);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [passedToday, setPassedToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showShiftNote, setShowShiftNote] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showEndShift, setShowEndShift] = useState(false);
  const [messageTarget, setMessageTarget] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    const today = localDate();
    const tzOffset = localTzOffset();
    const [boardRes, staffRes, inspectRes] = await Promise.allSettled([
      fetchBoard(today),
      fetchAssignableStaff(),
      api.get<{ data: Array<{ overall_result: string }> }>(
        `/housekeeping/inspections?date_from=${today}&date_to=${today}&tz_offset=${tzOffset}`
      ),
    ]);
    if (boardRes.status === "fulfilled") setRooms(normalizeBoardRooms(boardRes.value));
    if (staffRes.status === "fulfilled") setNameById(buildNameById(staffRes.value));
    if (inspectRes.status === "fulfilled") {
      const records = inspectRes.value.data ?? [];
      setPassedToday(records.filter((r) => r.overall_result === "passed").length);
    }
    setLoading(false);
  }, [isOnline, user?.tenant_id]);

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
          fg: theme.status.dirty,
          bg: theme.status.dirtySoft,
          line: theme.status.dirtyLine,
        },
        snapshot.submitted > 0 && {
          key: "toInspect",
          label: t("home.supervisor.signalToInspect", { count: snapshot.submitted }),
          fg: theme.status.clean,
          bg: theme.status.cleanSoft,
          line: theme.status.cleanLine,
        },
        snapshot.dnd > 0 && {
          key: "dnd",
          label: t("home.supervisor.signalDnd", { count: snapshot.dnd }),
          fg: theme.textSecondary,
          bg: theme.surfaceMuted,
          line: theme.border,
        },
        snapshot.vip > 0 && {
          key: "vip",
          label: t("home.supervisor.signalVip", { count: snapshot.vip }),
          fg: theme.accentBrass,
          bg: theme.accentBrassSoft,
          line: theme.accentBrassLine,
        },
        snapshot.behindSchedule > 0 && {
          key: "behind",
          label: t("home.supervisor.signalBehind", { count: snapshot.behindSchedule }),
          fg: theme.status.dirty,
          bg: theme.status.dirtySoft,
          line: theme.status.dirtyLine,
        },
      ].filter(Boolean) as HeroSignal[],
    [snapshot, t, theme],
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.shell.bg }]}>
      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />

        <View style={[styles.hero, { paddingTop: insets.top + 10, backgroundColor: theme.shell.bg }]}>
          <View style={styles.heroTop}>
            <Avatar name={name} size={34} />
            <Pressable onPress={() => router.push("/(app)/notifications" as never)}>
              <IconButton icon="notifications-outline" />
            </Pressable>
          </View>
          <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>
            {dynamicShiftMeta(user?.language_pref ?? "en", t("home.supervisor.shiftMeta"))}
          </Text>
          <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t(getGreetingKey(), { name: firstName(name) })}</Text>
          {snapshot.total > 0 ? (
            <>
              <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>
                {t("home.supervisor.heroSummary", {
                  ready: snapshot.ready,
                  total: snapshot.total,
                  working: snapshot.inProgress,
                })}
              </Text>
              <FloorMosaic
                rooms={mosaicRooms}
                getLabel={(status) => getStatusMeta(status, theme).label}
              />
              <HeroSignalRow signals={signals} />
            </>
          ) : (
            <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>{t("home.supervisor.emptyBoard")}</Text>
          )}
        </View>

        <View style={styles.body}>
          {/* What needs the supervisor right now */}
          <View style={styles.actionRow}>
            <Pressable
              style={styles.actionPressable}
              onPress={() => router.push("/(app)/inspect" as never)}
              testID="action-inspect"
              accessibilityRole="button"
            >
              <Card
                style={[
                  styles.actionCardLayout,
                  snapshot.submitted > 0
                    ? { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }
                    : undefined,
                ]}
              >
                <View style={styles.actionTopRow}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={16}
                    color={snapshot.submitted > 0 ? theme.status.clean : theme.textMuted}
                  />
                  <Text style={[styles.actionCount, { color: snapshot.submitted > 0 ? theme.status.clean : theme.textPrimary }]}>
                    {snapshot.submitted}
                  </Text>
                </View>
                <Text style={[styles.actionLabel, { color: theme.textSecondary }]}>{t("home.supervisor.toInspect")}</Text>
              </Card>
            </Pressable>
            <Pressable
              style={styles.actionPressable}
              onPress={() => router.push("/(app)/assignments" as never)}
              testID="action-assign"
              accessibilityRole="button"
            >
              <Card
                style={[
                  styles.actionCardLayout,
                  snapshot.unassigned > 0
                    ? { backgroundColor: theme.status.dirtySoft, borderColor: theme.status.dirtyLine }
                    : undefined,
                ]}
              >
                <View style={styles.actionTopRow}>
                  <Ionicons
                    name="person-add-outline"
                    size={16}
                    color={snapshot.unassigned > 0 ? theme.status.dirty : theme.textMuted}
                  />
                  <Text style={[styles.actionCount, { color: snapshot.unassigned > 0 ? theme.status.dirty : theme.textPrimary }]}>
                    {snapshot.unassigned}
                  </Text>
                </View>
                <Text style={[styles.actionLabel, { color: theme.textSecondary }]}>{t("home.supervisor.unassignedRooms")}</Text>
              </Card>
            </Pressable>
            {/* G8 — Passed today */}
            <Pressable
              style={styles.actionPressable}
              onPress={() => router.push("/(app)/inspect" as never)}
              accessibilityRole="button"
            >
              <Card
                style={[
                  styles.actionCardLayout,
                  passedToday > 0
                    ? { backgroundColor: theme.status.readySoft, borderColor: theme.status.readyLine }
                    : undefined,
                ]}
              >
                <View style={styles.actionTopRow}>
                  <Ionicons
                    name="checkmark-done-outline"
                    size={16}
                    color={passedToday > 0 ? theme.status.ready : theme.textMuted}
                  />
                  <Text style={[styles.actionCount, { color: passedToday > 0 ? theme.status.ready : theme.textPrimary }]}>
                    {passedToday}
                  </Text>
                </View>
                <Text style={[styles.actionLabel, { color: theme.textSecondary }]}>{t("home.supervisor.passedToday")}</Text>
              </Card>
            </Pressable>
          </View>

          {/* G12 + G13 — Quick supervisor actions */}
          <View style={styles.quickActionsRow}>
            <Pressable
              style={[styles.quickActionBtn, { backgroundColor: theme.status.cleanSoft, borderColor: theme.status.cleanLine }]}
              onPress={() => setShowShiftNote(true)}
              accessibilityRole="button"
            >
              <Ionicons name="book-outline" size={14} color={theme.status.clean} />
              <Text style={[styles.quickActionText, { color: theme.status.clean }]}>{t("home.supervisor.shiftNote")}</Text>
            </Pressable>
            <Pressable
              style={[styles.quickActionBtn, { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine }]}
              onPress={() => setShowBroadcast(true)}
              accessibilityRole="button"
            >
              <Ionicons name="megaphone-outline" size={14} color={theme.status.pickup} />
              <Text style={[styles.quickActionText, { color: theme.status.pickup }]}>{t("home.supervisor.messageTeam")}</Text>
            </Pressable>
            {(snapshot.ready >= snapshot.total - 5 || snapshot.toClean + snapshot.inProgress <= 4) && snapshot.total > 0 ? (
              <Pressable
                style={[styles.quickActionBtn, { backgroundColor: theme.status.readySoft, borderColor: theme.status.readyLine }]}
                onPress={() => setShowEndShift(true)}
                accessibilityRole="button"
              >
                <Ionicons name="checkmark-done-outline" size={14} color={theme.status.ready} />
                <Text style={[styles.quickActionText, { color: theme.status.ready }]}>{t("endShift.shortLabel")}</Text>
              </Pressable>
            ) : null}
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
                    onMessage={() => setMessageTarget({ id: load.housekeeperId, name: load.name })}
                  />
                ))}
              </View>
            </View>
          ) : snapshot.total > 0 ? (
            <StateBlock
              status="empty"
              emptyIcon="people-outline"
              emptyTitle={t("home.supervisor.noTeamYet")}
              emptyBody={t("home.supervisor.noTeamYetHint")}
              style={styles.emptyState}
            />
          ) : (
            <StateBlock
              status="empty"
              emptyIcon="grid-outline"
              emptyTitle={t("home.supervisor.emptyBoardTitle")}
              emptyBody={t("home.supervisor.emptyBoardHint")}
              style={styles.emptyState}
            />
          )}

          <Button
            label={t("home.supervisor.openBoard")}
            onPress={() => router.push("/(app)/room-board" as never)}
            testID="open-board"
            icon="arrow-forward"
            size="md"
            variant="ghost"
            style={[styles.boardBtn, { backgroundColor: theme.surface, borderColor: theme.primaryLine }]}
          />
        </View>
      </ScrollView>

      <ShiftNoteModal visible={showShiftNote} onClose={() => setShowShiftNote(false)} />
      <BroadcastModal visible={showBroadcast} onClose={() => setShowBroadcast(false)} />
      <EndShiftModal visible={showEndShift} snapshot={snapshot} onClose={() => setShowEndShift(false)} />
      <DirectMessageModal
        visible={messageTarget != null}
        recipientId={messageTarget?.id ?? null}
        recipientName={messageTarget?.name ?? null}
        onClose={() => setMessageTarget(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },

  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
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
    marginBottom: 4,
  },
  heroTitle: { fontSize: 30, fontWeight: "600", lineHeight: 34 },
  heroSummary: { marginTop: 7, fontSize: 14.5, lineHeight: 21 },

  body: { flex: 1, paddingHorizontal: 18, paddingTop: 16, paddingBottom: 28, gap: 14 },

  actionRow: { flexDirection: "row", gap: 10 },
  actionPressable: { flex: 1 },
  actionCardLayout: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 4,
  },
  actionTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  actionCount: { fontSize: 26, lineHeight: 30, fontWeight: "700" },
  actionLabel: { fontSize: 11.5, fontWeight: "600" },

  rows: { gap: 8 },
  quickActionsRow: { flexDirection: "row", gap: 10 },
  quickActionBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    borderWidth: 1,
    borderRadius: R.md, paddingVertical: 12,
  },
  quickActionText: { fontSize: 13, fontWeight: "800" },

  emptyState: {
    borderWidth: 1,
    borderColor: "transparent",
    borderRadius: R.lg,
    padding: 16,
  },

  boardBtn: {
    borderWidth: 1,
  },
});
