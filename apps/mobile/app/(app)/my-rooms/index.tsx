import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentProps } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { getRooms, upsertRooms } from "@/lib/offline/db";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, monoFont } from "@/components/shared/tokens";
import { FloatingAIButton } from "@/components/shared/mobileHandoff";
import { localDate } from "@/lib/utils/date";
import {
  compareRoomsForCleaningQueue,
  getPrimaryTimingLine,
  getRoomBadges,
  getRoomQueueBucket,
  type RoomQueueBucket,
} from "@/lib/housekeeping/roomWorkflow";

type FilterKey = "all" | RoomQueueBucket;

const CLEAN_TYPE_LABEL: Record<string, string> = {
  DEP: "Departure",
  FULL: "Full",
  LIGHT: "Light",
};

const CLEAN_TYPE_META: Record<string, { icon?: ComponentProps<typeof Ionicons>["name"]; fg: string }> = {
  DEP: { icon: "log-out-outline", fg: C.alert },
  FULL: { fg: C.caution },
  LIGHT: { fg: C.caution },
};

const STATUS_CONFIG: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  DIRTY: { label: "Vacant Dirty", bg: C.alertSoft, fg: C.alert, border: C.alertLine },
  OCCUPIED: { label: "Occupied Dirty", bg: C.alertSoft, fg: C.alert, border: C.alertLine },
  PICKUP: { label: "Pickup", bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  IN_PROGRESS: { label: "In Progress", bg: C.cautionSoft, fg: C.caution, border: C.cautionLine },
  CLEAN: { label: "Submitted", bg: C.infoSoft, fg: C.info, border: C.infoLine },
  INSPECTED: { label: "Ready", bg: C.readySoft, fg: C.ready, border: C.readyLine },
  OOO: { label: "Out of Order / Out of Service", bg: C.oooSoft, fg: C.ooo, border: C.oooLine },
  OUT_OF_ORDER: { label: "Out of Order / Out of Service", bg: C.oooSoft, fg: C.ooo, border: C.oooLine },
  OUT_OF_SERVICE: { label: "Out of Order / Out of Service", bg: C.oooSoft, fg: C.ooo, border: C.oooLine },
};

const SECTION_META: Array<{ bucket: RoomQueueBucket; title: string; empty?: string }> = [
  { bucket: "in_progress", title: "IN PROGRESS" },
  { bucket: "next_to_clean", title: "NEXT TO CLEAN" },
  { bucket: "needs_attention", title: "NEEDS ATTENTION" },
  { bucket: "submitted", title: "SUBMITTED" },
  { bucket: "ready", title: "READY" },
  { bucket: "blocked", title: "BLOCKED / OUT OF SERVICE" },
];

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "next_to_clean", label: "Next to Clean" },
  { key: "needs_attention", label: "Needs Attention" },
  { key: "in_progress", label: "Started" },
  { key: "submitted", label: "Submitted" },
  { key: "ready", label: "Ready" },
];

function dayLabel() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function getCleanTypeLabel(room: Room): string | null {
  return room.clean_type_label ?? (room.clean_type ? CLEAN_TYPE_LABEL[room.clean_type] ?? room.clean_type : null);
}

function getCleanTypeDisplay(room: Room): string | null {
  const label = getCleanTypeLabel(room);
  if (!label || !room.clean_type) return null;
  if (room.status === "INSPECTED" && (room.clean_type === "FULL" || room.clean_type === "LIGHT")) {
    return `${label} Done`;
  }
  return label;
}

function getRoomTypeLine(room: Room): string {
  const roomType = room.rooms?.room_types?.name;
  const floor = room.floor ? `Floor ${room.floor}` : null;
  return [roomType, floor].filter(Boolean).join(" - ") || "Assigned room";
}

type RoomItemProps = {
  room: Room;
  onPress: () => void;
};

function RoomItem({ room, onPress }: RoomItemProps) {
  const cfg = STATUS_CONFIG[room.status] ?? { label: room.status, bg: C.surface3, fg: C.ink3, border: C.line };
  const timing = getPrimaryTimingLine(room);
  const badges = getRoomBadges(room);
  const cleanType = getCleanTypeDisplay(room);
  const cleanTypeMeta = room.clean_type ? CLEAN_TYPE_META[room.clean_type] : null;

  return (
    <TouchableOpacity activeOpacity={0.86} onPress={onPress} style={styles.card}>
      <View style={[styles.statusRail, { backgroundColor: cfg.fg }]} />
      <View style={styles.cardMain}>
        <View style={styles.roomIdentity}>
          <Text style={styles.roomNumber}>{room.room_number}</Text>
          <Text style={styles.roomType}>{getRoomTypeLine(room)}</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={[styles.statusPill, { backgroundColor: cfg.bg, borderColor: cfg.border }]}>
            <Text style={[styles.statusPillText, { color: cfg.fg }]}>{cfg.label}</Text>
          </View>
          {cleanType ? (
            <View
              accessible
              accessibilityLabel={`${cleanType} clean type`}
              style={styles.cleanTypeRow}
            >
              {cleanTypeMeta?.icon ? <Ionicons name={cleanTypeMeta.icon} size={10} color={cleanTypeMeta.fg} /> : null}
              <Text style={[styles.cleanTypeLabelText, cleanTypeMeta && { color: cleanTypeMeta.fg }]}>{cleanType}</Text>
            </View>
          ) : null}
        </View>

        {timing ? (
          <View style={styles.timingRow}>
            <Ionicons name="time-outline" size={12} color={C.ink3} />
            <Text style={styles.timingText}>
              {timing.label}: {timing.value}
            </Text>
          </View>
        ) : null}

        {badges.length > 0 ? (
          <View style={styles.badgeRow}>
            {badges.map((badge) => {
              if (badge.key === "checkout") return null;
              const loud = badge.key === "dnd";
              return (
                <View key={badge.key} style={[styles.badge, loud && styles.badgeCritical]}>
                  <Text style={[styles.badgeText, loud && styles.badgeCriticalText]}>{badge.label}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export default function MyRoomsScreen() {
  const { t } = useTranslation();
  const { isOnline, myRooms, setMyRooms } = useAppStore();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");

  const loadRooms = useCallback(async () => {
    if (isOnline) {
      try {
        const result = await api.get<{ data: Room[] }>(`/housekeeping/my-rooms?date=${localDate()}`);
        setMyRooms(result.data);
        setApiError(null);
        await upsertRooms(result.data);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setApiError(msg);
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
    void loadRooms();
  }, [loadRooms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const groupedRooms = useMemo(() => {
    const now = new Date();
    const groups: Record<RoomQueueBucket, Room[]> = {
      next_to_clean: [],
      needs_attention: [],
      in_progress: [],
      submitted: [],
      ready: [],
      blocked: [],
    };

    myRooms.forEach((room) => {
      groups[getRoomQueueBucket(room, now)].push(room);
    });

    Object.values(groups).forEach((rooms) => rooms.sort((a, b) => compareRoomsForCleaningQueue(a, b, now)));
    return groups;
  }, [myRooms]);

  const counts = useMemo(() => {
    const bucketCounts = {
      next_to_clean: groupedRooms.next_to_clean.length,
      needs_attention: groupedRooms.needs_attention.length,
      in_progress: groupedRooms.in_progress.length,
      submitted: groupedRooms.submitted.length,
      ready: groupedRooms.ready.length,
      blocked: groupedRooms.blocked.length,
    };
    const completed = bucketCounts.submitted + bucketCounts.ready;
    return { ...bucketCounts, completed, total: myRooms.length };
  }, [groupedRooms, myRooms.length]);

  const visibleSections = useMemo(() => {
    if (activeFilter === "all") return SECTION_META.filter((section) => groupedRooms[section.bucket].length > 0);
    return SECTION_META.filter((section) => section.bucket === activeFilter && groupedRooms[section.bucket].length > 0);
  }, [activeFilter, groupedRooms]);

  const progressPercent = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;


  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {!isOnline ? (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>{t("common.offline")}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>My Rooms</Text>
            <Text style={styles.headerDate}>{dayLabel()}</Text>
          </View>
          <Text style={styles.assignedCount}>{counts.total} assigned</Text>
        </View>

        {counts.total > 0 ? (
          <View style={styles.progressBlock}>
            <View style={styles.progressTop}>
              <Text style={styles.progressText}>
                {counts.completed} / {counts.total} completed
              </Text>
              <Text style={styles.progressPercent}>{progressPercent}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
            </View>
          </View>
        ) : null}

        {counts.total > 0 ? (
          <View style={styles.summaryGrid}>
            <SummaryChip label="Needs Attention" value={counts.needs_attention} tone="alert" />
            <SummaryChip label="To Clean" value={counts.next_to_clean} tone="accent" />
            <SummaryChip label="In Progress" value={counts.in_progress} tone="caution" />
            <SummaryChip label="Submitted" value={counts.submitted} tone="info" />
            <SummaryChip label="Ready" value={counts.ready} tone="ready" />
          </View>
        ) : null}

        {counts.total > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {FILTERS.map((filter) => {
              const active = activeFilter === filter.key;
              return (
                <TouchableOpacity
                  key={filter.key}
                  onPress={() => setActiveFilter(filter.key)}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  activeOpacity={0.82}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>{filter.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}

        {counts.total === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("rooms.noRooms")}</Text>
            <Text style={styles.emptyText}>Pull to refresh if your supervisor adds assignments.</Text>
            {apiError ? <Text style={styles.errorText}>API error: {apiError}</Text> : null}
          </View>
        ) : (
          <View style={styles.sections}>
            {visibleSections.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>Nothing in this filter</Text>
                <Text style={styles.emptyText}>Switch filters to see the rest of your assignment sheet.</Text>
              </View>
            ) : (
              visibleSections.map((section) => (
                <View key={section.bucket} style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <Text style={styles.sectionTitle}>{section.title}</Text>
                    <Text style={styles.sectionCount}>{groupedRooms[section.bucket].length}</Text>
                  </View>
                  <View style={styles.sectionList}>
                    {groupedRooms[section.bucket].map((room) => (
                      <RoomItem
                        key={room.id}
                        room={room}
                        onPress={() => router.push(`/(app)/my-rooms/${room.id}`)}
                      />
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        )}
      </ScrollView>
      <FloatingAIButton bottom={insets.bottom + 84} onPress={() => router.push("/(app)/copilot")} />
    </View>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: "alert" | "accent" | "caution" | "info" | "ready" }) {
  const color = tone === "alert" ? C.alert : tone === "accent" ? C.accent : tone === "caution" ? C.caution : tone === "info" ? C.info : C.ready;
  return (
    <View style={styles.summaryChip}>
      <Text style={[styles.summaryValue, { color }]}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 42 },

  offlineBanner: { backgroundColor: C.alert, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  offlineText: { flex: 1, color: "#fff", fontSize: 12 },

  header: { paddingTop: 14, paddingBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14 },
  title: { fontSize: 30, fontWeight: "700", color: C.ink, lineHeight: 36 },
  headerDate: { fontSize: 13, color: C.ink3, marginTop: 2 },
  assignedCount: { fontFamily: monoFont, color: C.ink2, fontSize: 12, fontWeight: "700", marginTop: 8 },

  progressBlock: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 13, gap: 9 },
  progressTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progressText: { color: C.ink, fontSize: 14, fontWeight: "700" },
  progressPercent: { fontFamily: monoFont, color: C.ink3, fontSize: 12, fontWeight: "700" },
  progressTrack: { height: 8, borderRadius: 999, backgroundColor: C.surface3, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 999, backgroundColor: C.ready },

  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  summaryChip: {
    minHeight: 52,
    minWidth: "30%",
    flexGrow: 1,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  summaryValue: { fontFamily: monoFont, fontSize: 18, fontWeight: "800" },
  summaryLabel: { color: C.ink3, fontSize: 11.5, fontWeight: "700", marginTop: 1 },

  filterRow: { gap: 7, paddingTop: 14, paddingBottom: 2 },
  filterChip: {
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.surface,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipActive: { backgroundColor: C.ink, borderColor: C.ink },
  filterText: { color: C.ink2, fontSize: 12.5, fontWeight: "700" },
  filterTextActive: { color: C.paper },

  sections: { gap: 18, marginTop: 16 },
  section: { gap: 9 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { color: C.ink3, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  sectionCount: { fontFamily: monoFont, color: C.ink3, fontSize: 11, fontWeight: "800" },
  sectionList: { gap: 10 },

  card: {
    position: "relative",
    overflow: "hidden",
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 14,
    paddingLeft: 16,
    shadowColor: C.ink,
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statusRail: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  cardMain: { padding: 14, gap: 9 },
  roomIdentity: { minWidth: 0 },
  roomNumber: { fontFamily: monoFont, fontSize: 32, lineHeight: 36, fontWeight: "800", color: C.ink },
  roomType: { color: C.ink3, fontSize: 13, marginTop: 1 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 7, alignItems: "center" },
  statusPill: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4 },
  statusPillText: { fontSize: 11, fontWeight: "800", textTransform: "uppercase" },
  cleanTypeRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  cleanTypeLabelText: { fontSize: 10, fontWeight: "700" },
  timingRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  timingText: { color: C.ink2, fontFamily: monoFont, fontSize: 12 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: { backgroundColor: C.surface2, borderWidth: 1, borderColor: C.line2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  badgeCritical: { backgroundColor: C.alertSoft, borderColor: C.alertLine },
  badgeText: { color: C.ink2, fontSize: 10.5, fontWeight: "800" },
  badgeCriticalText: { color: C.alert },

  emptyCard: { marginTop: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16 },
  emptyTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  emptyText: { color: C.ink3, fontSize: 12, marginTop: 4 },
  errorText: { color: C.alert, fontSize: 11, marginTop: 6, fontFamily: monoFont },
});
