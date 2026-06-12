import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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
  removeAssignment,
  saveAssignments,
  suggestAssignments,
  type AssignmentSuggestion,
} from "@/lib/api/housekeepingSupervisor";
import {
  buildFloorSnapshot,
  buildNameById,
  buildTeamLoads,
  isActionable,
  normalizeBoardRooms,
  sortRoomsByNumber,
  type AssignableStaff,
  type FloorRoom,
  type TeamLoad,
} from "@/lib/housekeeping/supervisor";
import { C, R, monoFont, shellTokens } from "@/components/shared/tokens";
import { Avatar, SectionLabel } from "@/components/shared/mobileHandoff";
import { getStatusMeta, ProgressBar, StatusRail } from "@/components/shared/evening";
import { HeroSignalRow, type HeroSignal } from "@/components/supervisor/atoms";
import { HousekeeperPicker } from "@/components/supervisor/HousekeeperPicker";

/* ─── Assignments — who cleans what today ───────────────────────────────────
   Dark shell hero with the assignment shape of the day and an AI balance
   action (suggest → review sheet → apply). Unassigned rooms first, then
   one workload card per housekeeper. Tap any room to reassign or remove. */

export default function AssignmentsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { isOnline, user } = useAppStore();

  const [rooms, setRooms] = useState<FloorRoom[]>([]);
  const [staff, setStaff] = useState<AssignableStaff[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pickerRoom, setPickerRoom] = useState<FloorRoom | null>(null);
  const [saving, setSaving] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState<AssignmentSuggestion[] | null>(null);
  const [suggestNotice, setSuggestNotice] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const loadData = useCallback(async () => {
    if (!isOnline) {
      setLoading(false);
      return;
    }
    const [boardRes, staffRes] = await Promise.allSettled([
      fetchBoard(localDate()),
      fetchAssignableStaff(),
    ]);
    if (boardRes.status === "fulfilled") setRooms(normalizeBoardRooms(boardRes.value));
    if (staffRes.status === "fulfilled") setStaff(staffRes.value);
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
  const assignedCount = rooms.filter((room) => room.assignedTo != null).length;

  const signals = useMemo<HeroSignal[]>(
    () =>
      [
        unassigned.length > 0 && {
          key: "unassigned",
          label: t("assignments.signalUnassigned", { count: unassigned.length }),
          fg: C.alert,
          bg: C.alertSoft,
          line: C.alertLine,
        },
      ].filter(Boolean) as HeroSignal[],
    [unassigned.length, t],
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
        setSuggestNotice(result.message || t("assignments.suggestEmpty"));
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
    [pickerRoom, loadData],
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
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={styles.topBleed} />
        <View style={[styles.hero, { paddingTop: insets.top + 14 }]}>
          <Text style={styles.heroKicker}>
            {dynamicShiftMeta(user?.language_pref ?? "en", t("assignments.kicker"))}
          </Text>
          <Text style={styles.heroTitle}>{t("assignments.title")}</Text>
          <Text style={styles.heroSummary}>
            {t("assignments.summary", {
              assigned: assignedCount,
              unassigned: unassigned.length,
              housekeepers: teamLoads.length,
            })}
          </Text>
          <HeroSignalRow signals={signals} />
          {snapshot.toClean + snapshot.inProgress > 0 ? (
            <TouchableOpacity
              style={[styles.aiBtn, suggesting && styles.dimmed]}
              onPress={() => void requestSuggestions()}
              disabled={suggesting}
              activeOpacity={0.82}
              testID="ai-balance"
            >
              <Ionicons name="sparkles" size={13} color="#CBB8F0" />
              <Text style={styles.aiBtnText}>
                {suggesting ? t("assignments.suggesting") : t("assignments.aiBalance")}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.body}>
          {suggestNotice ? (
            <View style={styles.noticeCard}>
              <Ionicons name="information-circle-outline" size={15} color={C.ink3} />
              <Text style={styles.noticeText}>{suggestNotice}</Text>
            </View>
          ) : null}

          {unassigned.length > 0 ? (
            <View>
              <SectionLabel hint={t("assignments.roomCount", { count: unassigned.length })}>
                {t("assignments.unassignedSection")}
              </SectionLabel>
              <View style={styles.rows}>
                {unassigned.map((room) => {
                  const meta = getStatusMeta(room.status);
                  return (
                    <TouchableOpacity
                      key={room.roomId}
                      style={styles.unassignedRow}
                      onPress={() => setPickerRoom(room)}
                      activeOpacity={0.8}
                      testID={`unassigned-${room.roomNumber}`}
                    >
                      <StatusRail status={room.status} />
                      <Text style={styles.unassignedNumber}>{room.roomNumber}</Text>
                      <View style={styles.unassignedBody}>
                        <Text style={[styles.unassignedStatus, { color: meta.fg }]}>{meta.label}</Text>
                        <Text style={styles.unassignedMeta}>
                          {t("roomBoard.floor", { floor: room.floor })}
                          {room.cleanTypeLabel ? ` · ${room.cleanTypeLabel}` : ""}
                          {room.vip ? " · VIP" : ""}
                        </Text>
                      </View>
                      <Ionicons name="person-add-outline" size={17} color={C.accent} />
                    </TouchableOpacity>
                  );
                })}
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
            <View style={styles.empty}>
              <Ionicons name="people-outline" size={30} color={C.ink4} />
              <Text style={styles.emptyTitle}>{t("assignments.noAssignments")}</Text>
              <Text style={styles.emptyHint}>{t("assignments.noAssignmentsHint")}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <HousekeeperPicker
        visible={pickerRoom != null}
        roomNumber={pickerRoom?.roomNumber ?? null}
        staff={staff}
        loads={teamLoads}
        saving={saving}
        onSelect={(member) => void assignTo(member)}
        onClose={() => setPickerRoom(null)}
      />

      {/* AI suggestion review sheet */}
      <Modal
        visible={suggestions != null}
        transparent
        animationType="slide"
        onRequestClose={() => setSuggestions(null)}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSuggestions(null)} />
        <View style={styles.sheet}>
          <View style={styles.grabber} />
          <View style={styles.sheetKickerRow}>
            <Ionicons name="sparkles" size={13} color={C.ai} />
            <Text style={styles.sheetKicker}>{t("assignments.suggestKicker")}</Text>
          </View>
          <Text style={styles.sheetTitle}>{t("assignments.suggestTitle")}</Text>
          <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent}>
            {(suggestions ?? []).map((suggestion) => {
              const name =
                nameById.get(suggestion.housekeeper.id) ||
                suggestion.housekeeper.preferred_name ||
                suggestion.housekeeper.full_name ||
                "—";
              return (
                <View key={suggestion.housekeeper.id} style={styles.suggestionCard}>
                  <View style={styles.suggestionHeader}>
                    <Avatar name={name} size={32} />
                    <Text style={styles.suggestionName} numberOfLines={1}>{name}</Text>
                    <Text style={styles.suggestionMeta}>
                      {t("assignments.suggestionMeta", {
                        count: suggestion.room_count,
                        minutes: suggestion.total_minutes,
                      })}
                    </Text>
                  </View>
                  <View style={styles.suggestionChips}>
                    {suggestion.rooms.map((room) => (
                      <View key={room.room_id} style={styles.suggestionChip}>
                        <Text style={styles.suggestionChipText}>{room.room_number}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <View style={styles.sheetActions}>
            <TouchableOpacity
              style={styles.sheetCancelBtn}
              onPress={() => setSuggestions(null)}
              disabled={applying}
            >
              <Text style={styles.sheetCancelText}>{t("common.cancel")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.sheetApplyBtn, applying && styles.dimmed]}
              onPress={() => void applySuggestions()}
              disabled={applying}
              activeOpacity={0.85}
              testID="apply-suggestions"
            >
              <Text style={styles.sheetApplyText}>
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

function HousekeeperLoadCard({
  load,
  summary,
  onRoomPress,
}: {
  load: TeamLoad;
  summary: string;
  onRoomPress: (room: FloorRoom) => void;
}) {
  return (
    <View style={styles.loadCard} testID={`load-card-${load.housekeeperId}`}>
      <View style={styles.loadHeader}>
        <Avatar name={load.name} size={36} />
        <View style={styles.loadHeaderBody}>
          <Text style={styles.loadName} numberOfLines={1}>{load.name}</Text>
          <Text style={styles.loadSummary}>{summary}</Text>
        </View>
        {load.inProgress > 0 ? <View style={styles.loadActiveDot} /> : null}
      </View>
      <ProgressBar value={load.done} total={load.total} color={C.ready} />
      <View style={styles.loadChips}>
        {load.rooms.map((room) => {
          const meta = getStatusMeta(room.status);
          return (
            <TouchableOpacity
              key={room.roomId}
              style={[styles.roomChip, { backgroundColor: meta.bg, borderColor: meta.border }]}
              onPress={() => onRoomPress(room)}
              activeOpacity={0.75}
              accessibilityLabel={`${room.roomNumber} — ${meta.label}`}
            >
              <Text style={[styles.roomChipText, { color: meta.fg }]}>{room.roomNumber}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 28 },

  topBleed: { position: "absolute", top: -600, left: 0, right: 0, height: 600, backgroundColor: shellTokens.bg },
  hero: {
    paddingHorizontal: 18,
    paddingBottom: 20,
    backgroundColor: shellTokens.bg,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
  },
  heroKicker: {
    color: shellTokens.ink3,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  heroTitle: { color: shellTokens.ink, fontSize: 27, lineHeight: 32, fontWeight: "600", marginTop: 4 },
  heroSummary: { color: shellTokens.ink2, fontSize: 13, marginTop: 7 },
  aiBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: shellTokens.line,
    backgroundColor: shellTokens.surface,
    borderRadius: 11,
    minHeight: 44,
    paddingHorizontal: 14,
    marginTop: 13,
  },
  aiBtnText: { color: shellTokens.ink2, fontSize: 12.5, fontWeight: "700" },

  body: { paddingHorizontal: 16, paddingTop: 14, gap: 16 },
  rows: { gap: 8 },

  noticeCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: R.lg,
    padding: 12,
  },
  noticeText: { flex: 1, fontSize: 12.5, lineHeight: 18, color: C.ink2 },

  unassignedRow: {
    position: "relative",
    overflow: "hidden",
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    paddingLeft: 16,
    paddingRight: 13,
    paddingVertical: 12,
  },
  unassignedNumber: { fontFamily: monoFont, fontSize: 22, lineHeight: 26, fontWeight: "800", color: C.ink },
  unassignedBody: { flex: 1, minWidth: 0, gap: 1 },
  unassignedStatus: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  unassignedMeta: { fontSize: 11.5, color: C.ink3 },

  loadCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 14,
    gap: 10,
  },
  loadHeader: { flexDirection: "row", alignItems: "center", gap: 11 },
  loadHeaderBody: { flex: 1, minWidth: 0, gap: 1 },
  loadName: { fontSize: 14, fontWeight: "700", color: C.ink },
  loadSummary: { fontSize: 11.5, color: C.ink3 },
  loadActiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.caution },
  loadChips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  roomChip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  roomChipText: { fontFamily: monoFont, fontSize: 12.5, fontWeight: "800" },

  empty: { alignItems: "center", paddingVertical: 52, paddingHorizontal: 32, gap: 7 },
  emptyTitle: { color: C.ink, fontSize: 15.5, fontWeight: "700", marginTop: 4 },
  emptyHint: { color: C.ink3, fontSize: 12.5, textAlign: "center", lineHeight: 18 },

  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: C.paper,
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
    backgroundColor: C.line,
    marginBottom: 12,
  },
  sheetKickerRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  sheetKicker: {
    color: C.ai,
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: C.ink, marginTop: 4, marginBottom: 12 },
  sheetScroll: { flexGrow: 0 },
  sheetScrollContent: { gap: 8 },
  suggestionCard: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: R.lg,
    padding: 12,
    gap: 9,
  },
  suggestionHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  suggestionName: { flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: "700", color: C.ink },
  suggestionMeta: { fontFamily: monoFont, fontSize: 11, fontWeight: "700", color: C.ink3 },
  suggestionChips: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  suggestionChip: {
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.line2,
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  suggestionChipText: { fontFamily: monoFont, fontSize: 12, fontWeight: "800", color: C.ink2 },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  sheetCancelBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCancelText: { fontSize: 14, fontWeight: "600", color: C.ink3 },
  sheetApplyBtn: {
    flex: 2,
    minHeight: 46,
    borderRadius: R.md,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetApplyText: { fontSize: 14, fontWeight: "800", color: "#fff" },
  dimmed: { opacity: 0.5 },
});
