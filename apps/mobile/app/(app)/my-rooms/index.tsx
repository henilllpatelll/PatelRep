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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api/client";
import { getRooms, upsertRooms } from "@/lib/offline/db";
import { useAppStore, type Room } from "@/stores/appStore";
import { C, monoFont } from "@/components/shared/tokens";
import { FloatingAIButton } from "@/components/shared/mobileHandoff";
import { ProgressBar, RoomQueueCard, SectionHeader } from "@/components/shared/evening";
import { buildSmartQueue } from "@/lib/ai/briefing";
import { localDate } from "@/lib/utils/date";
import {
  compareRoomsForCleaningQueue,
  getRoomAction,
  getRoomQueueBucket,
  type RoomQueueBucket,
} from "@/lib/housekeeping/roomWorkflow";

type ViewMode = "smart" | "status";
type FilterKey = "all" | RoomQueueBucket;

const SECTION_META: Array<{ bucket: RoomQueueBucket; title: string }> = [
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

export default function MyRoomsScreen() {
  const { t } = useTranslation();
  const { isOnline, myRooms, setMyRooms } = useAppStore();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("smart");
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

  const smartQueue = useMemo(() => buildSmartQueue(myRooms), [myRooms]);

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

  const totalQueueMinutes = useMemo(
    () => smartQueue.reduce((sum, entry) => sum + entry.estimateMinutes, 0),
    [smartQueue],
  );

  const openRoom = useCallback((room: Room) => {
    router.push(`/(app)/my-rooms/${room.id}`);
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={C.accent} />
      </View>
    );
  }

  const progressPercent = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

  return (
    <View style={styles.container}>
      {!isOnline ? (
        <View style={[styles.offlineBanner, { paddingTop: insets.top + 8 }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>{t("common.offline")}</Text>
        </View>
      ) : null}

      {/* Evening Lobby shell header */}
      <View style={[styles.shellHeader, { paddingTop: (isOnline ? insets.top : 0) + 12 }]}>
        <View style={styles.shellTopRow}>
          <View style={styles.shellTitleBlock}>
            <Text style={styles.shellTitle}>{t("rooms.title")}</Text>
            <Text style={styles.shellDate}>{dayLabel()}</Text>
          </View>
          <View style={styles.shellCountBlock}>
            <Text style={styles.shellCountValue}>
              {counts.completed}
              <Text style={styles.shellCountTotal}>/{counts.total}</Text>
            </Text>
            <Text style={styles.shellCountLabel}>{progressPercent}%</Text>
          </View>
        </View>
        {counts.total > 0 ? (
          <View style={styles.shellProgress}>
            <ProgressBar value={counts.completed} total={counts.total} color={C.ready} />
          </View>
        ) : null}

        {/* Smart order / By status toggle */}
        <View style={styles.modeToggle}>
          {(
            [
              { key: "smart" as const, label: t("ai.smartOrder"), icon: "sparkles" as const },
              { key: "status" as const, label: t("ai.byStatus"), icon: "layers-outline" as const },
            ]
          ).map((mode) => {
            const active = viewMode === mode.key;
            return (
              <TouchableOpacity
                key={mode.key}
                onPress={() => setViewMode(mode.key)}
                style={[styles.modeBtn, active && styles.modeBtnActive]}
                activeOpacity={0.85}
              >
                <Ionicons name={mode.icon} size={12} color={active ? C.ink : C.ink3} />
                <Text style={[styles.modeText, active && styles.modeTextActive]}>{mode.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {counts.total === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("rooms.noRooms")}</Text>
            <Text style={styles.emptyText}>Pull to refresh if your supervisor adds assignments.</Text>
            {apiError ? <Text style={styles.errorText}>API error: {apiError}</Text> : null}
          </View>
        ) : viewMode === "smart" ? (
          <View style={styles.sections}>
            {smartQueue.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader
                  title={t("ai.smartOrder")}
                  hint={`~${totalQueueMinutes}m`}
                />
                <View style={styles.sectionList}>
                  {smartQueue.map((entry) => (
                    <RoomQueueCard
                      key={entry.room.id}
                      room={entry.room}
                      position={entry.position}
                      estimateMinutes={entry.estimateMinutes}
                      actionLabel={getRoomAction(entry.room).label}
                      onPress={() => openRoom(entry.room)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {groupedRooms.needs_attention.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title="NEEDS ATTENTION" hint={String(groupedRooms.needs_attention.length)} />
                <View style={styles.sectionList}>
                  {groupedRooms.needs_attention.map((room) => (
                    <RoomQueueCard key={room.id} room={room} actionLabel={getRoomAction(room).label} onPress={() => openRoom(room)} />
                  ))}
                </View>
              </View>
            ) : null}

            {(["submitted", "ready", "blocked"] as const).map((bucket) =>
              groupedRooms[bucket].length > 0 ? (
                <View key={bucket} style={styles.section}>
                  <SectionHeader
                    title={SECTION_META.find((section) => section.bucket === bucket)!.title}
                    hint={String(groupedRooms[bucket].length)}
                  />
                  <View style={styles.sectionList}>
                    {groupedRooms[bucket].map((room) => (
                      <RoomQueueCard key={room.id} room={room} onPress={() => openRoom(room)} />
                    ))}
                  </View>
                </View>
              ) : null,
            )}
          </View>
        ) : (
          <>
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

            <View style={styles.sections}>
              {visibleSections.length === 0 ? (
                <View style={styles.emptyCard}>
                  <Text style={styles.emptyTitle}>Nothing in this filter</Text>
                  <Text style={styles.emptyText}>Switch filters to see the rest of your assignment sheet.</Text>
                </View>
              ) : (
                visibleSections.map((section) => (
                  <View key={section.bucket} style={styles.section}>
                    <SectionHeader title={section.title} hint={String(groupedRooms[section.bucket].length)} />
                    <View style={styles.sectionList}>
                      {groupedRooms[section.bucket].map((room) => (
                        <RoomQueueCard
                          key={room.id}
                          room={room}
                          actionLabel={getRoomAction(room).label}
                          onPress={() => openRoom(room)}
                        />
                      ))}
                    </View>
                  </View>
                ))
              )}
            </View>
          </>
        )}
      </ScrollView>
      <FloatingAIButton bottom={insets.bottom + 84} onPress={() => router.push("/(app)/copilot")} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.paper },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.paper },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 42 },

  offlineBanner: { backgroundColor: C.alert, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  offlineText: { flex: 1, color: "#fff", fontSize: 12 },

  shellHeader: {
    backgroundColor: C.paper,
    borderBottomWidth: 1,
    borderBottomColor: C.line2,
    paddingHorizontal: 18,
    paddingBottom: 14,
    gap: 12,
  },
  shellTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 14 },
  shellTitleBlock: { flex: 1, minWidth: 0 },
  shellTitle: { fontSize: 28, fontWeight: "700", color: C.ink, lineHeight: 33 },
  shellDate: { fontSize: 12.5, color: C.ink3, marginTop: 2 },
  shellCountBlock: { alignItems: "flex-end" },
  shellCountValue: { fontFamily: monoFont, fontSize: 22, fontWeight: "800", color: C.ink },
  shellCountTotal: { fontSize: 14, color: C.ink3 },
  shellCountLabel: { fontFamily: monoFont, fontSize: 11, fontWeight: "700", color: C.ink3, marginTop: 1 },
  shellProgress: { marginTop: -2 },

  modeToggle: {
    flexDirection: "row",
    gap: 4,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 12,
    padding: 3,
  },
  modeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    minHeight: 38,
    borderRadius: 9,
  },
  modeBtnActive: { backgroundColor: C.surface2 },
  modeText: { color: C.ink3, fontSize: 12.5, fontWeight: "700" },
  modeTextActive: { color: C.ink },

  filterRow: { gap: 7, paddingBottom: 14 },
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

  sections: { gap: 20 },
  section: { gap: 9 },
  sectionList: { gap: 10 },

  emptyCard: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 16 },
  emptyTitle: { color: C.ink, fontSize: 15, fontWeight: "700" },
  emptyText: { color: C.ink3, fontSize: 12, marginTop: 4 },
  errorText: { color: C.alert, fontSize: 11, marginTop: 6, fontFamily: monoFont },
});
