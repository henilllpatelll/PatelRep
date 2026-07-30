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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { api } from "@/lib/api/client";
import { getRoomsByDate, upsertRooms } from "@/lib/offline/db";
import { useAppStore, type Room } from "@/stores/appStore";
import { monoFont } from "@/components/shared/tokens";
import { ProgressBar, RoomQueueCard, SectionHeader } from "@/components/shared/evening";
import { StateBlock } from "@/components/ui/StateBlock";
import { localDate } from "@/lib/utils/date";
import {
  buildBuildingGroups,
  getRoomAction,
  isFloorException,
} from "@/lib/housekeeping/roomWorkflow";

type ViewMode = "remaining" | "done";

const DONE_STATUSES = new Set<Room["status"]>(["CLEAN", "INSPECTED", "OOO", "OUT_OF_ORDER", "OUT_OF_SERVICE"]);

function dateLocale(language?: string) {
  return language?.toLowerCase().startsWith("es") ? "es-US" : "en-US";
}

function dayLabel(language?: string) {
  return new Date().toLocaleDateString(dateLocale(language), { weekday: "long", month: "long", day: "numeric" });
}

function getRoomActionLabelKey(room: Room): string {
  const action = getRoomAction(room);
  switch (action.kind) {
    case "start":
      return "rooms.card.action.start";
    case "done":
      return "rooms.card.action.done";
    case "review":
    case "guest_checkout":
      return "rooms.card.action.review";
    case "submitted":
      return "rooms.card.action.waiting";
    case "ready":
      return "rooms.card.action.ready";
    case "blocked":
      return "rooms.card.action.blocked";
    case "view":
    default:
      return "rooms.card.action.view";
  }
}

export default function MyRoomsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { isOnline, myRooms, setMyRooms } = useAppStore();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("remaining");
  const [collapsedBuildings, setCollapsedBuildings] = useState<Set<string>>(new Set());

  const toggleBuilding = useCallback((building: string) => {
    setCollapsedBuildings((prev) => {
      const next = new Set(prev);
      if (next.has(building)) next.delete(building);
      else next.add(building);
      return next;
    });
  }, []);

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
    void loadRooms();
    const interval = setInterval(() => { void loadRooms(); }, 45_000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void loadRooms();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [loadRooms]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadRooms();
    setRefreshing(false);
  }, [loadRooms]);

  const inProgressRooms = useMemo(() => myRooms.filter((r) => r.status === "IN_PROGRESS"), [myRooms]);
  const buildingGroups = useMemo(() => buildBuildingGroups(myRooms.filter((r) => r.status !== "IN_PROGRESS")), [myRooms]);

  const doneGroups = useMemo(() => {
    const submitted: Room[] = [];
    const ready: Room[] = [];
    const blocked: Room[] = [];
    for (const room of myRooms) {
      if (room.status === "CLEAN") submitted.push(room);
      else if (room.status === "INSPECTED") ready.push(room);
      else if (room.status === "OOO" || room.status === "OUT_OF_ORDER" || room.status === "OUT_OF_SERVICE") blocked.push(room);
    }
    return { submitted, ready, blocked };
  }, [myRooms]);

  const counts = useMemo(() => {
    const completed = myRooms.filter((r) => r.status === "CLEAN" || r.status === "INSPECTED").length;
    const remaining = buildingGroups.reduce(
      (sum, bg) => sum + bg.floors.reduce((s, f) => s + f.rooms.length, 0),
      0,
    );
    return { remaining, completed, blocked: doneGroups.blocked.length, total: myRooms.length };
  }, [myRooms, buildingGroups, doneGroups.blocked.length]);

  const openRoom = useCallback((room: Room) => {
    router.push(`/(app)/my-rooms/${room.id}`);
  }, []);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  const progressPercent = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;

  const DONE_SECTION_LIST = [
    { key: "submitted" as const, titleKey: "rooms.sections.submitted", rooms: doneGroups.submitted },
    { key: "ready" as const, titleKey: "rooms.sections.ready", rooms: doneGroups.ready },
    { key: "blocked" as const, titleKey: "rooms.sections.blocked", rooms: doneGroups.blocked },
  ];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {!isOnline ? (
        <View style={[styles.offlineBanner, { backgroundColor: theme.status.dirty, paddingTop: insets.top + 8 }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#fff" />
          <Text style={styles.offlineText}>{t("common.offline")}</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.shellHeader,
          { backgroundColor: theme.shell.bg, borderBottomColor: theme.shell.line, paddingTop: (isOnline ? insets.top : 0) + 12 },
        ]}
      >
        <View style={styles.shellTopRow}>
          <View style={styles.shellTitleBlock}>
            <Text style={[styles.shellTitle, { color: theme.shell.ink }]}>{t("rooms.title")}</Text>
            <Text style={[styles.shellDate, { color: theme.shell.ink3 }]}>{dayLabel(i18n.resolvedLanguage ?? i18n.language)}</Text>
          </View>
          <View style={styles.shellCountBlock}>
            <Text style={[styles.shellCountValue, { color: theme.shell.ink }]}>
              {counts.completed}
              <Text style={[styles.shellCountTotal, { color: theme.shell.ink3 }]}>/{counts.total}</Text>
            </Text>
            <Text style={[styles.shellCountLabel, { color: theme.shell.ink3 }]}>{progressPercent}%</Text>
          </View>
        </View>
        {counts.total > 0 ? (
          <View style={styles.shellProgress}>
            <ProgressBar value={counts.completed} total={counts.total} color={theme.status.ready} />
          </View>
        ) : null}

        <View style={[styles.modeToggle, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
          {(
            [
              {
                key: "remaining" as const,
                label: t("rooms.remaining"),
                icon: "sparkles" as const,
                count: counts.remaining,
              },
              {
                key: "done" as const,
                label: t("rooms.doneTab"),
                icon: "checkmark-done-outline" as const,
                count: counts.completed + counts.blocked,
              },
            ]
          ).map((mode) => {
            const active = viewMode === mode.key;
            return (
              <TouchableOpacity
                key={mode.key}
                onPress={() => setViewMode(mode.key)}
                style={[styles.modeBtn, active && { backgroundColor: theme.shell.raised }]}
                activeOpacity={0.85}
              >
                <Ionicons name={mode.icon} size={13} color={active ? theme.shell.ink : theme.shell.ink3} />
                <Text style={[styles.modeText, { color: active ? theme.shell.ink : theme.shell.ink3 }]}>
                  {mode.label} {mode.count}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
      >
        {counts.total === 0 ? (
          <StateBlock
            status="empty"
            emptyIcon="checkmark-done-outline"
            emptyTitle={t("rooms.noRooms")}
            emptyBody={apiError ? t("rooms.apiError", { error: apiError }) : t("rooms.pullToRefreshHint")}
          />
        ) : viewMode === "remaining" ? (
          <View style={styles.sections}>
            {inProgressRooms.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader title={t("rooms.sections.nowCleaning")} hint={String(inProgressRooms.length)} />
                <View style={[styles.sectionList, styles.activeSection, { borderLeftColor: theme.status.pickup }]}>
                  {inProgressRooms.map((room) => (
                    <RoomQueueCard
                      key={room.id}
                      room={room}
                      actionLabel={t("rooms.card.action.done")}
                      onPress={() => openRoom(room)}
                    />
                  ))}
                </View>
              </View>
            ) : null}
            {buildingGroups.length > 0 ? (
              buildingGroups.map((buildingGroup) => {
                const collapsed = collapsedBuildings.has(buildingGroup.building);
                return (
                <View key={buildingGroup.building} style={styles.buildingSection}>
                  <TouchableOpacity onPress={() => toggleBuilding(buildingGroup.building)} activeOpacity={0.75}>
                    <SectionHeader
                      title={t(`rooms.sections.building.${buildingGroup.building}`)}
                      hint={String(buildingGroup.floors.reduce((s, f) => s + f.rooms.length, 0))}
                      action={<Ionicons name={collapsed ? "chevron-forward" : "chevron-down"} size={15} color={theme.shell.ink3} />}
                    />
                  </TouchableOpacity>
                  {!collapsed && buildingGroup.floors.map((floorGroup) => (
                    <View key={floorGroup.floor} style={styles.section}>
                      <Text style={[styles.floorLabel, { color: theme.shell.ink3 }]}>
                        {t("rooms.sections.floor", { floor: floorGroup.floor })}
                      </Text>
                      <View style={styles.sectionList}>
                        {floorGroup.rooms.map((room) => {
                          const exception = isFloorException(room);
                          return (
                            <RoomQueueCard
                              key={room.id}
                              room={room}
                              actionLabel={exception ? undefined : t(getRoomActionLabelKey(room))}
                              onPress={() => openRoom(room)}
                              dimmed={exception}
                            />
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </View>
                );
              })
            ) : inProgressRooms.length === 0 ? (
              <StateBlock
                status="empty"
                emptyIcon="checkmark-done-outline"
                emptyTitle={t("rooms.allRoomsDone")}
                emptyBody={t("rooms.allRoomsDoneHint")}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.sections}>
            {DONE_SECTION_LIST.filter((s) => s.rooms.length > 0).map((section) => (
              <View key={section.key} style={styles.section}>
                <SectionHeader title={t(section.titleKey)} hint={String(section.rooms.length)} />
                <View style={styles.sectionList}>
                  {section.rooms.map((room) => (
                    <RoomQueueCard key={room.id} room={room} onPress={() => openRoom(room)} />
                  ))}
                </View>
              </View>
            ))}
            {counts.completed + counts.blocked === 0 ? (
              <StateBlock
                status="empty"
                emptyIcon="checkmark-done-outline"
                emptyTitle={t("rooms.nothingDoneYet")}
                emptyBody={t("rooms.nothingDoneYetHint")}
              />
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 16, paddingBottom: 42 },

  offlineBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  offlineText: { flex: 1, color: "#fff", fontSize: 12 },

  shellHeader: {
    borderBottomWidth: 1,
    paddingHorizontal: 18,
    paddingBottom: 14,
    gap: 10,
  },
  shellTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 14 },
  shellTitleBlock: { flex: 1, minWidth: 0 },
  shellTitle: { fontSize: 28, fontWeight: "700", lineHeight: 33 },
  shellDate: { fontSize: 12.5, marginTop: 2 },
  shellCountBlock: { alignItems: "flex-end" },
  shellCountValue: { fontFamily: monoFont, fontSize: 22, fontWeight: "800" },
  shellCountTotal: { fontSize: 14 },
  shellCountLabel: { fontFamily: monoFont, fontSize: 11, fontWeight: "700", marginTop: 1 },
  shellProgress: {},

  modeToggle: {
    flexDirection: "row",
    gap: 4,
    borderWidth: 1,
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
  modeText: { fontSize: 12.5, fontWeight: "700" },

  sections: { gap: 20 },
  buildingSection: { gap: 10 },
  section: { gap: 6, paddingLeft: 4 },
  floorLabel: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    paddingTop: 4,
    paddingBottom: 2,
  },
  sectionList: { gap: 12 },
  activeSection: { borderLeftWidth: 3, paddingLeft: 8, borderRadius: 4 },
});
