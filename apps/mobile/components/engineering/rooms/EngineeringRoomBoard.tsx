import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { EngineeringState } from "@/components/engineering/EngineeringState";
import { Pill, StaleNote } from "@/components/engineering/assets/assetUi";
import { RoomCard } from "@/components/engineering/rooms/RoomCard";
import { RoomFilterSheet } from "@/components/engineering/rooms/RoomFilterSheet";
import { resolveLoadState } from "@/lib/engineering/loadState";
import {
  EMPTY_ROOM_FILTERS,
  ROOM_QUICK_FILTERS,
  activeRoomFilterCount,
  applyQuickFilter,
  groupRoomsByFloor,
  hasAnyRoomFilter,
  quickFilterOf,
  type RoomBoardRow,
  type RoomFilters,
  type RoomQuickFilter,
} from "@/lib/engineering/roomModel";
import { recallRoomView, rememberRoomView, takeRoomBoardStale, useRoomBoard } from "@/lib/engineering/useRoomBoard";
import { useAppStore } from "@/stores/appStore";

const SEARCH_DEBOUNCE_MS = 350;

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

type Item = { type: "floor"; key: string; floor: number | null; count: number } | { type: "room"; key: string; room: RoomBoardRow };

function formatTime(at: Date | null): string {
  return at ? at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
}

/** Engineering Rooms: every room in the hotel, searched and filtered on the server, grouped by floor. */
export function EngineeringRoomBoard() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const locale = i18n.resolvedLanguage ?? "en";

  const [filters, setFilters] = useState<RoomFilters>(() => recallRoomView(scope)?.filters ?? EMPTY_ROOM_FILTERS);
  const [text, setText] = useState(() => recallRoomView(scope)?.text ?? "");
  const [sheetOpen, setSheetOpen] = useState(false);
  const query = useDebounced(text.trim(), SEARCH_DEBOUNCE_MS);

  useEffect(() => {
    rememberRoomView(scope, { filters, text });
  }, [scope, filters, text]);

  const board = useRoomBoard({ scope, filters, query });
  const refreshBoard = board.refresh;
  // Hidden tab screens stay mounted: a repair or availability change made elsewhere is picked up on return.
  useFocusEffect(
    useCallback(() => {
      if (takeRoomBoardStale()) void refreshBoard();
    }, [refreshBoard]),
  );

  const openRoom = useCallback((roomId: string) => router.push({ pathname: "/(app)/room-status/[roomId]", params: { roomId } } as never), []);
  const report = useCallback(() => router.push("/(app)/work-orders/new" as never), []);
  const clearAll = useCallback(() => {
    setFilters((f) => ({ ...EMPTY_ROOM_FILTERS, sort: f.sort }));
    setText("");
  }, []);

  const filtered = hasAnyRoomFilter(filters, query);
  const sheetCount = activeRoomFilterCount(filters);
  const quick = quickFilterOf(filters);
  const state = resolveLoadState({ loading: board.loading, failure: board.failure, count: board.rows.length, offline: !isOnline && !board.loaded });
  // A finished read with no rows is "empty"; a failed one never is.
  const emptyStatus = state.status === "ready" || !board.loaded ? state.status : "empty";

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const group of groupRoomsByFloor(board.rows, filters.sort)) {
      if (filters.sort === "room" || filters.sort === "floor") out.push({ type: "floor", key: `floor-${group.floor ?? "none"}`, floor: group.floor, count: group.rooms.length });
      for (const room of group.rooms) out.push({ type: "room", key: room.id, room });
    }
    return out;
  }, [board.rows, filters.sort]);

  const counts = board.counts;
  const countFor = (key: RoomQuickFilter): number | undefined =>
    !counts ? undefined : key === "all" ? counts.total : key === "active" ? counts.active_repairs : key === "unavailable" ? counts.unavailable : counts.occupied;

  const renderItem = useCallback(
    ({ item }: { item: Item }) =>
      item.type === "floor" ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.floorHeader, { color: theme.textMuted }]}>
          {item.floor != null ? t("engRooms.floorHeader", { floor: item.floor }) : t("engRooms.floorUnknown")}
        </Text>
      ) : (
        <RoomCard room={item.room} locale={locale} onPress={openRoom} />
      ),
    [locale, openRoom, t, theme.textMuted],
  );

  const header = (
    <View style={styles.listHeader}>
      <View style={styles.chipRow}>
        <View style={styles.chips} accessibilityRole="tablist">
          {ROOM_QUICK_FILTERS.map((key) => (
            <Pill key={key} label={t(`engRooms.quick.${key}`)} selected={quick === key} count={countFor(key)} onPress={() => setFilters((f) => applyQuickFilter(f, key))} testID={`room-quick-${key}`} />
          ))}
        </View>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={sheetCount > 0 ? t("engRooms.filter.openActive", { count: sheetCount }) : t("engRooms.filter.open")}
          style={[styles.filterButton, { borderColor: sheetCount > 0 ? theme.primaryAction : theme.border, backgroundColor: sheetCount > 0 ? theme.primarySoft : theme.surface }]}
          testID="room-filter-open"
        >
          <Ionicons name="options-outline" size={18} color={sheetCount > 0 ? theme.primary : theme.textSecondary} />
          {sheetCount > 0 ? (
            <Text style={[styles.filterCount, { color: theme.primary }]} maxFontSizeMultiplier={1.3}>
              {sheetCount}
            </Text>
          ) : null}
        </Pressable>
      </View>
      {state.status === "ready" && filtered ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.count, { color: theme.textMuted }]} accessibilityLiveRegion="polite" testID="room-result-count">
          {t("engRooms.resultCount", { count: board.total })}
        </Text>
      ) : null}
      {state.stale ? (
        <StaleNote testID="room-stale">
          {board.failure === "offline" || !isOnline ? t("engRooms.stale.offline", { time: formatTime(board.syncedAt) }) : t("engRooms.stale.failed", { time: formatTime(board.syncedAt) })}
        </StaleNote>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="engineering-rooms-screen">
      <View style={[styles.hero, { paddingTop: insets.top + 12, backgroundColor: theme.shell.bg }]}>
        <View style={styles.heroRow}>
          <View style={styles.heroText}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heroTitle, { color: theme.shell.ink }]}>
              {t("engRooms.title")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroSub, { color: theme.shell.ink2 }]}>
              {t("engRooms.subtitle")}
            </Text>
          </View>
          <Pressable
            onPress={report}
            accessibilityRole="button"
            accessibilityLabel={t("report.open")}
            style={[styles.iconButton, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}
            testID="room-report-issue"
          >
            <Ionicons name="add" size={24} color={theme.shell.ink} />
          </Pressable>
        </View>
        <View style={[styles.search, { backgroundColor: theme.shell.surface, borderColor: theme.shell.line }]}>
          <Ionicons name="search-outline" size={18} color={theme.shell.ink3} />
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t("engRooms.searchPlaceholder")}
            placeholderTextColor={theme.shell.ink3}
            style={[styles.searchInput, { color: theme.shell.ink }]}
            returnKeyType="search"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={100}
            accessibilityLabel={t("engRooms.searchPlaceholder")}
            testID="room-search"
          />
          {text.length > 0 ? (
            <Pressable onPress={() => setText("")} accessibilityRole="button" accessibilityLabel={t("engRooms.clearSearch")} hitSlop={12} testID="room-search-clear">
              <Ionicons name="close-circle" size={18} color={theme.shell.ink3} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <FlatList
        testID="room-list"
        data={state.status === "ready" ? items : []}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={
          state.status === "ready" ? undefined : (
            <EngineeringState
              status={emptyStatus}
              onRetry={board.retry}
              emptyIcon="bed-outline"
              emptyTitle={filtered ? t("engRooms.noMatches") : t("engRooms.empty")}
              emptyBody={filtered ? t("engRooms.noMatchesHint") : t("engRooms.emptyHint")}
              style={styles.empty}
            />
          )
        }
        ListFooterComponent={
          board.loadingMore ? (
            <ActivityIndicator style={styles.footer} color={theme.primaryAction} accessibilityLabel={t("common.loading")} />
          ) : emptyStatus === "empty" && filtered ? (
            <Button label={t("engRooms.clearFilters")} variant="secondary" onPress={clearAll} style={styles.clear} testID="room-clear-filters" />
          ) : undefined
        }
        onEndReached={board.loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={board.refreshing} onRefresh={board.refresh} tintColor={theme.primaryAction} />}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        initialNumToRender={8}
        windowSize={7}
      />

      <RoomFilterSheet
        visible={sheetOpen}
        filters={filters}
        floors={board.floors}
        buildings={board.buildings}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingHorizontal: 18, paddingBottom: 16, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 14 },
  heroRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  heroText: { flex: 1 },
  heroTitle: { fontSize: 27, lineHeight: 32, fontWeight: "600" },
  heroSub: { fontSize: 13, marginTop: 2 },
  iconButton: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  search: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, borderRadius: 14, borderWidth: 1, paddingHorizontal: 12 },
  searchInput: { flex: 1, fontSize: 15, minHeight: 44 },
  content: { paddingHorizontal: 18 },
  listHeader: { paddingTop: 14, paddingBottom: 6, gap: 10 },
  chipRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filterButton: { minWidth: 44, minHeight: 44, borderRadius: 22, borderWidth: 1, flexDirection: "row", gap: 4, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  filterCount: { fontSize: 13, fontWeight: "800" },
  count: { fontSize: 12.5 },
  floorHeader: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase", paddingTop: 10 },
  separator: { height: 8 },
  empty: { marginTop: 24 },
  footer: { paddingVertical: 16 },
  clear: { marginTop: 14 },
});
