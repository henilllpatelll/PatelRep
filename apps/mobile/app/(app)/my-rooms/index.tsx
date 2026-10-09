import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { localDate } from "@/lib/utils/date";
import { useAppStore } from "@/stores/appStore";
import { useCleanSessionStore } from "@/stores/cleanSessionStore";
import { SectionHeader } from "@/components/shared/evening";
import { StateBlock } from "@/components/ui/StateBlock";
import { CompactRoomRow, CurrentRoomCard, MyRoomCard } from "@/components/housekeeping/MyRoomCards";
import { MyRoomsHeader, type SyncIndicator } from "@/components/housekeeping/MyRoomsHeader";
import { hasPendingSync } from "@/lib/housekeeping/cleanSession";
import {
  buildDashboard,
  buildFloorSections,
  getLastTab,
  parseShiftDate,
  resolveListState,
  setLastTab,
  type DashboardTab,
  type SessionMap,
} from "@/lib/housekeeping/myRoomsDashboard";
import {
  buildDoneItems,
  buildFloorItems,
  buildRouteItems,
  isRouteEmpty,
  type ListItem,
} from "@/lib/housekeeping/myRoomsItems";
import { dateLocale, formatClock } from "@/lib/housekeeping/myRoomsText";
import { useActiveSessionRestore, useMyRoomsData } from "@/lib/housekeeping/useMyRoomsData";

const NO_SESSIONS: SessionMap = {};

export default function MyRoomsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const { isOnline, myRooms, user, pendingActions } = useAppStore();
  const data = useMyRoomsData();

  const [tab, setTab] = useState<DashboardTab>(getLastTab);
  const [query, setQuery] = useState("");
  const [floorOverrides, setFloorOverrides] = useState<Record<string, boolean>>({});

  // Sessions belong to one signed-in user; ignore records from another scope.
  const sessionScope = useCleanSessionStore((state) => state.scope);
  const storedSessions = useCleanSessionStore((state) => state.sessions);
  const expectedScope = user ? `${user.tenant_id}:${user.id}` : null;
  const sessions = sessionScope && sessionScope === expectedScope ? storedSessions : NO_SESSIONS;

  useEffect(() => {
    void useCleanSessionStore.getState().hydrate();
  }, [expectedScope]);

  const model = useMemo(() => buildDashboard(myRooms, sessions, data.rankedAt), [myRooms, sessions, data.rankedAt]);

  const missingKey = useMemo(
    () =>
      model.current
        .filter((entry) => entry.session?.state === "missing")
        .map((entry) => entry.room.id)
        .sort()
        .join(","),
    [model.current],
  );
  const restore = useActiveSessionRestore(missingKey, isOnline);

  const floorSections = useMemo(() => buildFloorSections(model.all, query), [model.all, query]);
  const searching = query.trim().length > 0;

  const items: ListItem[] = useMemo(() => {
    if (tab === "route") return buildRouteItems(model);
    if (tab === "done") return buildDoneItems(model);
    return buildFloorItems(floorSections, floorOverrides, searching);
  }, [tab, model, floorSections, floorOverrides, searching]);

  const changeTab = useCallback((next: DashboardTab) => {
    setLastTab(next);
    setTab(next);
  }, []);

  const openRoom = useCallback((roomId: string) => {
    router.push(`/(app)/my-rooms/${roomId}`);
  }, []);

  const toggleFloor = useCallback((key: string, expanded: boolean) => {
    setFloorOverrides((prev) => ({ ...prev, [key]: !expanded }));
  }, []);

  const pendingCount =
    Object.values(sessions).filter((session) => session && hasPendingSync(session)).length +
    (pendingActions?.length ?? 0);

  const indicators: SyncIndicator[] = [];
  // Offline is announced by the banner above the header; the indicators cover the rest.
  if (isOnline && data.fetchError && data.usingCache) {
    indicators.push({ key: "stale", icon: "alert-circle-outline", text: t("rooms.dash.sync.refreshFailed"), tone: "warn" });
  } else if (isOnline && data.lastUpdated) {
    const time = formatClock(data.lastUpdated.toISOString(), language);
    indicators.push({
      key: "online",
      icon: "cloud-done-outline",
      text: time ? t("rooms.dash.sync.updated", { time }) : t("rooms.dash.sync.online"),
      tone: "ok",
    });
  }
  if (pendingCount > 0) {
    indicators.push({ key: "pending", icon: "sync-outline", text: t("rooms.dash.sync.pending", { count: pendingCount }), tone: "warn" });
  }

  // The server resolves the shift date (with the hotel-local fallback); use it
  // over the device clock so the header names the day the rooms belong to.
  const shiftDate = parseShiftDate(myRooms[0]?.assignment_date) ?? parseShiftDate(localDate()) ?? new Date();
  const dateLabel = shiftDate.toLocaleDateString(dateLocale(language), { weekday: "long", month: "long", day: "numeric" });

  const listState = resolveListState({ loading: data.loading, roomCount: myRooms.length, fetchError: data.fetchError });

  const header = (
    <View>
      {!isOnline ? (
        <View
          accessible
          accessibilityRole="alert"
          accessibilityLabel={t("common.offline")}
          style={[
            styles.offlineBanner,
            {
              backgroundColor: theme.banner.offline.background,
              borderBottomColor: theme.banner.offline.border,
              paddingTop: insets.top + 8,
            },
          ]}
        >
          <Ionicons name="cloud-offline-outline" size={14} color={theme.banner.offline.foreground} />
          <Text style={[styles.offlineText, { color: theme.banner.offline.foreground }]}>{t("common.offline")}</Text>
        </View>
      ) : null}
      <MyRoomsHeader
        dateLabel={dateLabel}
        progress={model.progress}
        indicators={indicators}
        tab={tab}
        onTabChange={changeTab}
        topInset={isOnline ? insets.top : 0}
      />
      {tab === "floors" ? (
        <View style={styles.searchWrap}>
          <View style={[styles.search, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Ionicons name="search" size={16} color={theme.textMuted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t("rooms.dash.floors.searchPlaceholder")}
              placeholderTextColor={theme.textMuted}
              accessibilityLabel={t("rooms.dash.floors.searchLabel")}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={[styles.searchInput, { color: theme.textPrimary }]}
              testID="my-rooms-search"
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery("")}
                accessibilityRole="button"
                accessibilityLabel={t("rooms.dash.floors.clearSearch")}
                hitSlop={8}
                style={styles.clear}
              >
                <Ionicons name="close-circle" size={18} color={theme.textMuted} />
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: ListItem }) => {
    switch (item.kind) {
      case "section":
        return (
          <View style={styles.sectionHeader}>
            <SectionHeader title={t(item.titleKey)} hint={`${item.count}`} />
            {item.note ? (
              <Text style={[styles.note, { color: theme.textMuted }]}>{t(item.note)}</Text>
            ) : null}
          </View>
        );
      case "current":
        return (
          <View style={styles.item}>
            <CurrentRoomCard
              entry={item.entry}
              isOnline={isOnline}
              reloading={restore.restoring}
              onReloadSession={restore.reload}
              onResume={() => openRoom(item.entry.room.id)}
            />
          </View>
        );
      case "card":
        return (
          <View style={styles.item}>
            <MyRoomCard entry={item.entry} position={item.position} onPress={() => openRoom(item.entry.room.id)} />
          </View>
        );
      case "row":
        return (
          <View style={styles.rowItem}>
            <CompactRoomRow entry={item.entry} onPress={() => openRoom(item.entry.room.id)} />
          </View>
        );
      case "text":
        return <Text style={[styles.note, styles.item, { color: theme.textMuted }]}>{t(item.textKey)}</Text>;
      case "building":
        return (
          <Text accessibilityRole="header" style={[styles.buildingTitle, { color: theme.textPrimary }]}>
            {item.label ?? t("rooms.dash.floors.noBuilding")}
          </Text>
        );
      case "floor": {
        const { section, expanded } = item;
        const name =
          section.floor === null ? t("rooms.dash.floors.floorUnknown") : t("rooms.sections.floor", { floor: section.floor });
        const count = t("rooms.dash.floors.count", { completed: section.completed, total: section.serviceable });
        return (
          <Pressable
            onPress={() => toggleFloor(section.key, expanded)}
            accessibilityRole="button"
            accessibilityLabel={t("rooms.dash.floors.floorA11y", {
              floor: name,
              completed: section.completed,
              total: section.serviceable,
            })}
            accessibilityState={{ expanded }}
            testID={`floor-${section.key}`}
            style={[styles.floorHeader, { backgroundColor: theme.surfaceMuted, borderColor: theme.borderSubtle }]}
          >
            <Ionicons name={expanded ? "chevron-down" : "chevron-forward"} size={16} color={theme.textMuted} />
            <Text style={[styles.floorName, { color: theme.textPrimary }]}>{name}</Text>
            {section.unavailable > 0 ? (
              <Text style={[styles.floorMeta, { color: theme.textMuted }]}>
                {t("rooms.dash.floors.unavailableCount", { count: section.unavailable })}
              </Text>
            ) : null}
            <Text style={[styles.floorCount, { color: theme.textSecondary }]}>{count}</Text>
          </Pressable>
        );
      }
      default:
        return null;
    }
  };

  const refreshControl = (
    <RefreshControl refreshing={data.refreshing} onRefresh={data.refresh} tintColor={theme.primaryAction} />
  );

  if (listState === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: theme.background }]}>
        <StateBlock status="loading" />
      </View>
    );
  }

  let empty: ReactNode = null;
  if (listState === "error") {
    empty = (
      <StateBlock
        status="error"
        errorMessage={`${t("rooms.dash.state.errorTitle")}\n${t("rooms.dash.state.errorBody")}`}
        onRetry={() => { void data.refresh(); }}
        retryLabel={t("rooms.dash.state.retry")}
      />
    );
  } else if (listState === "empty") {
    empty = isOnline ? (
      <StateBlock
        status="empty"
        emptyIcon="checkmark-done-outline"
        emptyTitle={t("rooms.noRooms")}
        emptyBody={t("rooms.pullToRefreshHint")}
      />
    ) : (
      <StateBlock
        status="empty"
        emptyIcon="cloud-offline-outline"
        emptyTitle={t("rooms.dash.sync.offline")}
        emptyBody={t("rooms.dash.state.offlineEmpty")}
      />
    );
  } else if (tab === "route" && isRouteEmpty(model)) {
    empty = (
      <StateBlock
        status="empty"
        emptyIcon="checkmark-done-outline"
        emptyTitle={t("rooms.dash.route.emptyTitle")}
        emptyBody={t("rooms.dash.route.emptyBody")}
      />
    );
  } else if (tab === "done" && model.progress.completed + model.progress.unavailable === 0) {
    empty = (
      <StateBlock
        status="empty"
        emptyIcon="hourglass-outline"
        emptyTitle={t("rooms.dash.done.emptyTitle")}
        emptyBody={t("rooms.dash.done.emptyBody")}
      />
    );
  } else if (tab === "floors" && searching && items.length === 0) {
    empty = (
      <StateBlock
        status="empty"
        emptyIcon="search-outline"
        emptyTitle={t("rooms.dash.floors.noMatches", { query: query.trim() })}
      />
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <FlatList
        data={listState === "ready" && !empty ? items : []}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty ? <View style={styles.emptyWrap}>{empty}</View> : null}
        refreshControl={refreshControl}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  offlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
  },
  offlineText: { flex: 1, fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { paddingBottom: 48 },
  emptyWrap: { paddingHorizontal: 18, paddingTop: 24 },
  sectionHeader: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 6 },
  note: { fontSize: 13, lineHeight: 18 },
  item: { paddingHorizontal: 18, paddingBottom: 12 },
  rowItem: { paddingHorizontal: 18, paddingBottom: 8 },
  buildingTitle: { paddingHorizontal: 18, paddingTop: 22, paddingBottom: 4, fontSize: 18, fontWeight: "800" },
  floorHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  floorName: { flex: 1, fontSize: 15, fontWeight: "800" },
  floorMeta: { fontSize: 12.5 },
  floorCount: { fontSize: 14, fontWeight: "700" },
  searchWrap: { paddingHorizontal: 18, paddingTop: 12 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 12,
  },
  searchInput: { flex: 1, fontSize: 16, paddingVertical: 8 },
  clear: { minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" },
});
