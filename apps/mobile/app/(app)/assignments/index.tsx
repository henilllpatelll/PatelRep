import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAppStore } from "@/stores/appStore";
import { localDate, dynamicShiftMeta } from "@/lib/utils/date";
import {
  fetchAssignableStaff,
  fetchBoard,
  fetchLateCheckouts,
  removeAssignment,
  saveAssignments,
  suggestAssignments,
  type AssignmentSuggestion,
  type LateCheckoutRequest,
} from "@/lib/api/housekeepingSupervisor";
import {
  buildFloorSnapshot,
  buildNameById,
  buildTeamLoads,
  groupByFloor,
  isActionable,
  normalizeBoardRooms,
  sortRoomsByNumber,
  type AssignableStaff,
  type FloorRoom,
  type TeamLoad,
} from "@/lib/housekeeping/supervisor";
import { R, monoFont } from "@/components/shared/tokens";
import { Avatar, SectionLabel } from "@/components/shared/mobileHandoff";
import { ProgressBar, StatusRail } from "@/components/shared/evening";
import { HeroSignalRow, type HeroSignal } from "@/components/supervisor/atoms";
import { HousekeeperPicker } from "@/components/supervisor/HousekeeperPicker";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { Card } from "@/components/ui/Card";
import { StateBlock } from "@/components/ui/StateBlock";
import { StatusBadge, type StatusKey } from "@/components/ui/StatusBadge";

/* ─── Assignments — who cleans what today ───────────────────────────────────
   Dark shell hero with the assignment shape of the day and an AI balance
   action (suggest → review sheet → apply). Unassigned rooms first, then
   one workload card per housekeeper. Tap any room to reassign or remove. */

export default function AssignmentsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const toast = useToast();
  const { isOnline, user } = useAppStore();

  const [rooms, setRooms] = useState<FloorRoom[]>([]);
  const [staff, setStaff] = useState<AssignableStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerRoom, setPickerRoom] = useState<FloorRoom | null>(null);
  const [floorPickerRooms, setFloorPickerRooms] = useState<FloorRoom[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<AssignmentSuggestion[] | null>(null);
  const [suggestNotice, setSuggestNotice] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [lateCoByRoom, setLateCoByRoom] = useState<Map<string, LateCheckoutRequest>>(new Map());

  const loadData = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    const [boardRes, staffRes, lateCoRes] = await Promise.allSettled([
      fetchBoard(localDate()),
      fetchAssignableStaff(),
      fetchLateCheckouts(),
    ]);
    if (boardRes.status === "fulfilled") setRooms(normalizeBoardRooms(boardRes.value));
    if (staffRes.status === "fulfilled") setStaff(staffRes.value);
    if (lateCoRes.status === "fulfilled") {
      const m = new Map<string, LateCheckoutRequest>();
      for (const req of lateCoRes.value) m.set(req.room_id, req);
      setLateCoByRoom(m);
    }
    setLoading(false);
  }, [isOnline]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!user?.tenant_id) return;
    const channel = supabase
      .channel("assignments-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_assignments", filter: `tenant_id=eq.${user.tenant_id}` },
        () => {
          loadData();
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_status", filter: `tenant_id=eq.${user.tenant_id}` },
        () => {
          loadData();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.tenant_id, loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const nameById = useMemo(() => buildNameById(staff), [staff]);
  const snapshot = useMemo(() => buildFloorSnapshot(rooms), [rooms]);
  const teamLoads = useMemo(() => buildTeamLoads(rooms, nameById), [rooms, nameById]);
  const unassigned = useMemo(
    () => sortRoomsByNumber(rooms.filter((room) => isActionable(room.status) && !room.assignedTo)),
    [rooms],
  );
  const unassignedByFloor = useMemo(
    () => groupByFloor(rooms.filter((room) => isActionable(room.status) && !room.assignedTo)),
    [rooms],
  );
  const assignedCount = rooms.filter((room) => room.assignedTo != null).length;

  const signals = useMemo<HeroSignal[]>(
    () =>
      [
        unassigned.length > 0 && {
          key: "unassigned",
          label: t("assignments.signalUnassigned", { count: unassigned.length }),
          fg: theme.status.dirty,
          bg: theme.status.dirtySoft,
          line: theme.status.dirtyLine,
        },
      ].filter(Boolean) as HeroSignal[],
    [theme, unassigned.length, t],
  );

  /* ── AI balance: suggest → review → apply ── */

  const requestSuggestions = useCallback(async () => {
    if (suggesting) return;
    setSuggesting(true);
    setSuggestNotice(null);
    try {
      const result = await suggestAssignments(localDate());
      if (result.suggestions.length > 0) {
        setSuggestions(result.suggestions);
      } else {
        // If rooms are already manually assigned but shift schedule is empty, the AI
        // returns "no housekeepers on shift". Surface a more helpful explanation.
        const hasAssignments = rooms.some((r) => r.assignedTo != null);
        setSuggestNotice(
          hasAssignments
            ? t("assignments.suggestShiftGap")
            : result.message || t("assignments.suggestEmpty"),
        );
      }
    } catch {
      setSuggestNotice(t("assignments.suggestError"));
    } finally {
      setSuggesting(false);
    }
  }, [suggesting, t]);

  const applySuggestions = useCallback(async () => {
    if (!suggestions || applying) return;
    setApplying(true);
    try {
      const assignments = suggestions.flatMap((suggestion) =>
        suggestion.rooms.map((room) => ({
          room_id: room.room_id,
          housekeeper_id: suggestion.housekeeper.id,
        })),
      );
      await saveAssignments(localDate(), assignments, true);
      setSuggestions(null);
      await loadData();
    } catch {
      setSuggestNotice(t("assignments.applyError"));
      setSuggestions(null);
    } finally {
      setApplying(false);
    }
  }, [suggestions, applying, loadData, t]);

  /* ── Single-room assign / reassign / remove ── */

  const assignTo = useCallback(
    async (member: AssignableStaff) => {
      if (floorPickerRooms) {
        setSaving(true);
        try {
          await saveAssignments(
            localDate(),
            floorPickerRooms.map((room) => ({ room_id: room.roomId, housekeeper_id: member.userId })),
          );
          setFloorPickerRooms(null);
          await loadData();
        } catch (err) {
          console.warn("Floor assign failed:", err);
        } finally {
          setSaving(false);
        }
        return;
      }
      if (!pickerRoom) return;
      setSaving(true);
      try {
        await saveAssignments(localDate(), [
          { room_id: pickerRoom.roomId, housekeeper_id: member.userId },
        ]);
        setPickerRoom(null);
        await loadData();
      } catch (err) {
        console.warn("Assign failed:", err);
      } finally {
        setSaving(false);
      }
    },
    [pickerRoom, floorPickerRooms, loadData],
  );

  const onAssignedRoomPress = useCallback(
    (room: FloorRoom) => {
      Alert.alert(t("assignments.roomActionTitle", { room: room.roomNumber }), undefined, [
        { text: t("assignments.reassign"), onPress: () => setPickerRoom(room) },
        {
          text: t("assignments.removeAssignment"),
          style: "destructive",
          onPress: async () => {
            if (!room.assignmentId) return;
            try {
              await removeAssignment(room.assignmentId);
              await loadData();
            } catch (err) {
              console.warn("Remove assignment failed:", err);
            }
          },
        },
        { text: t("common.cancel"), style: "cancel" },
      ]);
    },
    [t, loadData],
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <StateBlock status="loading" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <ScrollView
        style={[styles.scroll, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        <View style={[styles.topBleed, { backgroundColor: theme.shell.bg }]} />
        <View style={[styles.hero, { paddingTop: insets.top + 14, backgroundColor: theme.shell.bg }]}>
          <Text style={[styles.heroKicker, { color: theme.shell.ink3 }]}>
            {dynamicShiftMeta(user?.language_pref ?? "en", t("assignments.kicker"))}
          </Text>
          <Text style={[styles.heroTitle, { color: theme.shell.ink }]}>{t("assignments.title")}</Text>
          <Text style={[styles.heroSummary, { color: theme.shell.ink2 }]}>
            {t("assignments.summary", {
              assigned: assignedCount,
              unassigned: unassigned.length,
              housekeepers: teamLoads.length,
            })}
          </Text>
          <HeroSignalRow signals={signals} />
          {snapshot.toClean + snapshot.inProgress > 0 ? (
            <TouchableOpacity
              style={[
                styles.aiBtn,
                { borderColor: theme.shell.line, backgroundColor: theme.shell.surface },
                suggesting && styles.dimmed,
              ]}
              onPress={() => void requestSuggestions()}
              disabled={suggesting}
              activeOpacity={0.82}
              testID="ai-balance"
            >
              <Ionicons name="sparkles" size={13} color={theme.ai.primary} />
              <Text style={[styles.aiBtnText, { color: theme.shell.ink2 }]}>
                {suggesting ? t("assignments.suggesting") : t("assignments.aiBalance")}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.body}>
          {suggestNotice ? (
            <View style={[styles.noticeCard, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
              <Ionicons name="information-circle-outline" size={15} color={theme.textMuted} />
              <Text style={[styles.noticeText, { color: theme.textSecondary }]}>{suggestNotice}</Text>
            </View>
          ) : null}

          {unassignedByFloor.length > 0 ? (
            <View>
              <SectionLabel hint={t("assignments.roomCount", { count: unassigned.length })}>
                {t("assignments.unassignedSection")}
              </SectionLabel>
              <View style={styles.rows}>
                {unassignedByFloor.map(({ floor, rooms: floorRooms }) => (
                  <View key={floor} style={styles.floorGroup}>
                    <View style={styles.floorHeader}>
                      <Text style={[styles.floorLabel, { color: theme.textMuted }]}>
                        {t("assignments.floorSection", { floor })}
                      </Text>
                      <TouchableOpacity
                        style={[
                          styles.assignFloorBtn,
                          { borderColor: theme.primaryLine, backgroundColor: theme.surface },
                        ]}
                        onPress={() => setFloorPickerRooms(floorRooms)}
                        activeOpacity={0.8}
                        testID={`assign-floor-${floor}`}
                      >
                        <Ionicons name="people-outline" size={13} color={theme.primaryAction} />
                        <Text style={[styles.assignFloorText, { color: theme.primaryAction }]}>
                          {t("assignments.assignFloor")}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {floorRooms.map((room) => {
                      const statusKey = getRoomStatusKey(room.status);
                      const statusLabel = t(
                        statusKey ? `rooms.card.status.${room.status}` : "rooms.card.status.UNKNOWN",
                        { status: room.status.replace(/_/g, " ") },
                      );
                      return (
                        <Pressable
                          key={room.roomId}
                          onPress={() => setPickerRoom(room)}
                          accessibilityRole="button"
                          accessibilityLabel={`${room.roomNumber} — ${statusLabel}`}
                          testID={`unassigned-${room.roomNumber}`}
                        >
                          <Card style={styles.unassignedRow}>
                            <StatusRail status={room.status} />
                            <Text style={[styles.unassignedNumber, { color: theme.textPrimary }]}>{room.roomNumber}</Text>
                            <View style={styles.unassignedBody}>
                              {statusKey ? (
                                <StatusBadge statusKey={statusKey} label={statusLabel} />
                              ) : (
                                <Text style={[styles.unassignedStatus, { color: theme.textMuted }]}>{statusLabel}</Text>
                              )}
                              <View style={styles.unassignedChips}>
                                {room.cleanTypeLabel ? (
                                  <Text style={[styles.unassignedMeta, { color: theme.textMuted }]}>{room.cleanTypeLabel}</Text>
                                ) : null}
                                {room.vip ? (
                                  <View style={[styles.vipChip, { backgroundColor: theme.accentBrassSoft, borderColor: theme.accentBrassLine }]}>
                                    <Text style={[styles.vipChipText, { color: theme.accentBrass }]}>★ VIP</Text>
                                  </View>
                                ) : null}
                                {lateCoByRoom.has(room.roomId) ? (
                                  <TouchableOpacity
                                    style={[
                                      styles.lateCoChip,
                                      { backgroundColor: theme.status.pickupSoft, borderColor: theme.status.pickupLine },
                                    ]}
                                    activeOpacity={0.75}
                                    onPress={() => {
                                      const req = lateCoByRoom.get(room.roomId);
                                      toast.info(
                                        req?.requested_time
                                          ? t("assignments.lateCoTime", { time: req.requested_time })
                                          : t("assignments.lateCoNoTime"),
                                      );
                                    }}
                                  >
                                    <Text style={[styles.lateCoChipText, { color: theme.status.pickup }]}>⏰ {t("assignments.lateCo")}</Text>
                                  </TouchableOpacity>
                                ) : null}
                              </View>
                            </View>
                            <Ionicons name="person-add-outline" size={17} color={theme.primaryAction} />
                          </Card>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {teamLoads.length > 0 ? (
            <View>
              <SectionLabel hint={t("assignments.housekeeperCount", { count: teamLoads.length })}>
                {t("assignments.teamSection")}
              </SectionLabel>
              <View style={styles.rows}>
                {teamLoads.map((load) => (
                  <HousekeeperLoadCard
                    key={load.housekeeperId}
                    load={load}
                    summary={t("assignments.loadSummary", {
                      done: load.done,
                      total: load.total,
                      minutes: load.minutesLeft,
                    })}
                    onRoomPress={onAssignedRoomPress}
                  />
                ))}
              </View>
            </View>
          ) : null}

          {teamLoads.length === 0 && unassigned.length === 0 ? (
            <StateBlock
              status="empty"
              emptyIcon="people-outline"
              emptyTitle={t("assignments.noAssignments")}
              emptyBody={t("assignments.noAssignmentsHint")}
              style={styles.empty}
            />
          ) : null}
        </View>
      </ScrollView>

      <HousekeeperPicker
        visible={pickerRoom != null || floorPickerRooms != null}
        roomNumber={pickerRoom?.roomNumber ?? null}
        customTitle={
          floorPickerRooms
            ? t("assignments.assignFloorTitle", { floor: floorPickerRooms[0]?.floor ?? 0, count: floorPickerRooms.length })
            : null
        }
        staff={staff.filter((member) => member.role === "housekeeper")}
        loads={teamLoads}
        saving={saving}
        onSelect={(member) => void assignTo(member)}
        onClose={() => { setPickerRoom(null); setFloorPickerRooms(null); }}
      />

      {/* AI suggestion review sheet */}
      <Modal
        visible={suggestions != null}
        transparent
        animationType="slide"
        onRequestClose={() => setSuggestions(null)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSuggestions(null)} />
        <View style={[styles.sheet, { backgroundColor: theme.background }]}>
          <View style={[styles.grabber, { backgroundColor: theme.border }]} />
          <View style={styles.sheetKickerRow}>
            <Ionicons name="sparkles" size={13} color={theme.ai.primary} />
            <Text style={[styles.sheetKicker, { color: theme.ai.primary }]}>{t("assignments.suggestKicker")}</Text>
          </View>
          <Text style={[styles.sheetTitle, { color: theme.textPrimary }]}>{t("assignments.suggestTitle")}</Text>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
            {(suggestions ?? []).map((suggestion) => {
              const name =
                nameById.get(suggestion.housekeeper.id) ||
                suggestion.housekeeper.preferred_name ||
                suggestion.housekeeper.full_name ||
                "—";
              return (
                <Card key={suggestion.housekeeper.id} style={styles.suggestionCard}>
                  <View style={styles.suggestionHeader}>
                    <Avatar name={name} size={32} />
                    <Text style={[styles.suggestionName, { color: theme.textPrimary }]} numberOfLines={1}>{name}</Text>
                    <Text style={[styles.suggestionMeta, { color: theme.textMuted }]}>
                      {t("assignments.suggestionMeta", {
                        count: suggestion.room_count,
                        minutes: suggestion.total_minutes,
                      })}
                    </Text>
                  </View>
                  <View style={styles.suggestionChips}>
                    {suggestion.rooms.map((room) => (
                      <View key={room.room_id} style={[styles.suggestionChip, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
                        <Text style={[styles.suggestionChipText, { color: theme.textSecondary }]}>{room.room_number}</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              );
            })}
          </ScrollView>
          <View style={styles.sheetActions}>
            <TouchableOpacity
              style={[styles.sheetCancelBtn, { borderColor: theme.border }]}
              onPress={() => setSuggestions(null)}
              disabled={applying}
            >
              <Text style={[styles.sheetCancelText, { color: theme.textMuted }]}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetApplyBtn, { backgroundColor: theme.primaryAction }, applying && styles.dimmed]}
              onPress={() => void applySuggestions()}
              disabled={applying}
              activeOpacity={0.85}
              testID="apply-suggestions"
            >
              <Text style={[styles.sheetApplyText, { color: theme.shell.ink }]}>
                {applying ? t("assignments.applying") : t("assignments.applyAll")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/* ─── Housekeeper workload card ─────────────────────────────────────────────── */

const ROOM_STATUS_KEYS: Record<string, StatusKey> = {
  DIRTY: "dirty",
  OCCUPIED: "occupied",
  PICKUP: "pickup",
  IN_PROGRESS: "inProgress",
  CLEAN: "clean",
  INSPECTED: "ready",
  OOO: "outOfOrder",
  OUT_OF_ORDER: "outOfOrder",
  OUT_OF_SERVICE: "outOfOrder",
};

function getRoomStatusKey(status: string): StatusKey | null {
  return ROOM_STATUS_KEYS[status] ?? null;
}

function HousekeeperLoadCard({
  load,
  summary,
  onRoomPress,
}: {
  load: TeamLoad;
  summary: string;
  onRoomPress: (room: FloorRoom) => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View testID={`load-card-${load.housekeeperId}`}>
      <Card style={styles.loadCard}>
        <View style={styles.loadHeader}>
          <Avatar name={load.name} size={36} />
          <View style={styles.loadHeaderBody}>
            <Text style={[styles.loadName, { color: theme.textPrimary }]} numberOfLines={1}>
              {load.name}
            </Text>
            <Text style={[styles.loadSummary, { color: theme.textMuted }]}>{summary}</Text>
          </View>
          {load.inProgress > 0 ? (
            <View style={[styles.loadActiveDot, { backgroundColor: theme.status.pickup }]} />
          ) : null}
        </View>
        <ProgressBar value={load.done} total={load.total} color={theme.status.ready} />
        <View style={styles.loadChips}>
          {load.rooms.map((room) => {
            const statusKey = getRoomStatusKey(room.status);
            const statusLabel = t(
              statusKey ? `rooms.card.status.${room.status}` : "rooms.card.status.UNKNOWN",
              { status: room.status.replace(/_/g, " ") },
            );
            return (
              <Pressable
                key={room.roomId}
                onPress={() => onRoomPress(room)}
                accessibilityRole="button"
                accessibilityLabel={`${room.roomNumber} — ${statusLabel}`}
              >
                {statusKey ? (
                  <StatusBadge statusKey={statusKey} label={room.roomNumber} />
                ) : (
                  <View style={[styles.roomChip, { backgroundColor: theme.surfaceMuted, borderColor: theme.border }]}>
                    <Text style={[styles.roomChipText, { color: theme.textMuted }]}>{room.roomNumber}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600 },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { fontSize: 13, marginTop: 7 },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 14,
    marginTop: 13,
  },
  aiBtnText: { fontSize: 12.5, fontWeight: "700" },

  body: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },
  rows: { gap: 8 },

  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: R.lg,
    padding: 12,
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18 },

  floorGroup: { gap: 6 },
  floorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginTop: 4,
  },
  floorLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  assignFloorBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  assignFloorText: { fontSize: 11.5, fontWeight: "700" },

  unassignedRow: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 16,
    paddingRight: 13,
    paddingVertical: 12,
  },
  unassignedNumber: { fontFamily: monoFont, fontSize: 22, lineHeight: 26, fontWeight: "800" },
  unassignedBody: { flex: 1, minWidth: 0, gap: 1 },
  unassignedStatus: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  unassignedChips: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  unassignedMeta: { fontSize: 11.5 },
  vipChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  vipChipText: { fontSize: 10, fontWeight: "800" },
  lateCoChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 },
  lateCoChipText: { fontSize: 10, fontWeight: "800" },

  loadCard: { padding: 14, gap: 10 },
  loadHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  loadHeaderBody: { flex: 1, minWidth: 0, gap: 1 },
  loadName: { fontSize: 14, fontWeight: "700" },
  loadSummary: { fontSize: 11.5 },
  loadActiveDot: { width: 8, height: 8, borderRadius: 4 },
  loadChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  roomChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  roomChipText: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "800" },

  empty: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 32, gap: 7 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
    maxHeight: "75%",
  },
  grabber: {
    alignSelf: "center",
    width: 38,
    height: 4,
    borderRadius: 2,
    marginBottom: 12,
  },
  sheetKickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  sheetKicker: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", marginTop: 4, marginBottom: 12 },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { gap: 8 },
  suggestionCard: { padding: 12, gap: 9 },
  suggestionHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  suggestionName: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "700" },
  suggestionMeta: { fontFamily: monoFont, fontSize: 11, fontWeight: "700" },
  suggestionChips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  suggestionChip: {
    borderWidth: 1,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  suggestionChipText: { fontFamily: monoFont, fontSize: 12, fontWeight: "800" },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  sheetCancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: R.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCancelText: { fontSize: 14, fontWeight: "600" },
  sheetApplyBtn: {
    flex: 2,
    minHeight: 46,
    borderRadius: R.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetApplyText: { fontSize: 14, fontWeight: "800" },
  dimmed: { opacity: 0.5 },
});
