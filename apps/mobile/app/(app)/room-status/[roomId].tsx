import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { StaleNote } from "@/components/engineering/assets/assetUi";
import { RoomAvailabilitySheet } from "@/components/engineering/rooms/RoomAvailabilitySheet";
import { RoomReleaseSheet } from "@/components/engineering/rooms/RoomReleaseSheet";
import {
  ActiveRepairsPanel,
  LinkedEquipmentPanel,
  MaintenanceHistoryPanel,
  RoomAvailabilityPanel,
  RoomOverviewPanel,
} from "@/components/engineering/rooms/RoomDetailSections";
import { AvailabilityBadge, MaintenanceBadge, OccupancyBadge } from "@/components/engineering/rooms/roomUi";
import { canManageAvailability } from "@/lib/engineering/roomModel";
import { useRoomDetail } from "@/lib/engineering/useRoomDetail";
import { useAppStore } from "@/stores/appStore";

type Sheet = "create" | "eta" | "release" | null;

export default function EngineeringRoomDetailScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  const id = typeof roomId === "string" ? roomId : "";
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const canManage = canManageAvailability(user?.role);
  const locale = i18n.resolvedLanguage ?? "en";
  const detail = useRoomDetail(scope, id);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Coming back from a repair or the report form: whatever changed there is shown here.
  const away = useRef(false);
  const reloadAll = detail.reloadAll;
  useFocusEffect(
    useCallback(() => {
      if (away.current) void reloadAll();
      return () => {
        away.current = true;
      };
    }, [reloadAll]),
  );

  const row = detail.row.data;
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/room-status" as never);
  }, []);
  const openRepair = useCallback((woId: string) => router.push({ pathname: "/(app)/work-orders/[woId]", params: { woId } } as never), []);
  const openAsset = useCallback((assetId: string) => router.push({ pathname: "/(app)/assets/[assetId]", params: { assetId } } as never), []);
  const report = useCallback(() => {
    if (!row) return;
    router.push({ pathname: "/(app)/work-orders/new", params: { roomId: row.id, roomNumber: row.room_number, floor: row.floor != null ? String(row.floor) : "" } } as never);
  }, [row]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await reloadAll();
    setRefreshing(false);
  }, [reloadAll]);

  const missing = detail.row.status === 404 || (detail.row.syncedAt != null && detail.row.data == null);
  const context = row ? [row.floor != null ? t("engRooms.floorHeader", { floor: row.floor }) : null, row.building, row.room_type?.name].filter(Boolean).join(" · ") : "";

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="engineering-room-detail">
      <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
        <Pressable onPress={back} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={8} style={styles.back} testID="room-detail-back">
          <Ionicons name="chevron-back" size={24} color={theme.shell.ink} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.shell.ink, fontSize: 15 }}>
            {t("engRooms.title")}
          </Text>
        </Pressable>
        {row ? (
          <View style={styles.heroBody}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.kicker, { color: theme.shell.ink3 }]}>
              {t("engRooms.roomKicker")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.number, { color: theme.shell.ink }]} testID="room-detail-number">
              {row.room_number}
            </Text>
            {context ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.shell.ink2, fontSize: 13.5 }}>
                {context}
              </Text>
            ) : null}
            <View style={styles.badges}>
              <OccupancyBadge occupancy={row.occupancy} />
              {row.availability ? <AvailabilityBadge availability={row.availability} /> : null}
              {row.active_repair_count > 0 ? <MaintenanceBadge count={row.active_repair_count} priority={row.top_priority} /> : null}
            </View>
          </View>
        ) : null}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryAction} />}
        keyboardShouldPersistTaps="handled"
      >
        {!row && detail.row.loading ? <StateBlock status="loading" /> : null}
        {!row && !detail.row.loading && missing ? (
          <StateBlock status="empty" emptyIcon="bed-outline" emptyTitle={t("engRooms.detail.notFound")} emptyBody={t("engRooms.detail.notFoundHint")} />
        ) : null}
        {!row && !detail.row.loading && !missing && detail.row.failure ? (
          <StateBlock
            status="error"
            errorIcon={detail.row.failure === "forbidden" ? "lock-closed-outline" : undefined}
            errorMessage={detail.row.failure === "forbidden" ? t("engineeringState.forbidden") : t("engRooms.detail.loadFailed")}
            onRetry={detail.row.failure === "forbidden" ? undefined : () => void detail.row.reload()}
            retryLabel={t("common.retry")}
          />
        ) : null}

        {row ? (
          <>
            {detail.row.failure ? <StaleNote testID="room-detail-stale">{t("engRooms.stale.failed", { time: detail.row.syncedAt?.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) ?? "" })}</StaleNote> : null}
            <Button label={t("engRooms.detail.reportHere")} icon="add-circle-outline" onPress={report} testID="room-quick-report" />
            <RoomOverviewPanel row={row} locale={locale} />
            <RoomAvailabilityPanel
              row={row}
              period={detail.period}
              canManage={canManage}
              isOnline={isOnline}
              locale={locale}
              onManage={() => setSheet("create")}
              onEta={() => setSheet("eta")}
              onRelease={() => setSheet("release")}
            />
            <ActiveRepairsPanel row={row} repairs={detail.repairs} locale={locale} onOpen={openRepair} onReport={report} />
            <LinkedEquipmentPanel equipment={detail.equipment} onOpen={openAsset} />
            <MaintenanceHistoryPanel history={detail.history} periods={detail.periods} locale={locale} onOpen={openRepair} />
          </>
        ) : null}
      </ScrollView>

      {row ? (
        <>
          <RoomAvailabilitySheet
            visible={sheet === "create" || sheet === "eta"}
            mode={sheet === "eta" ? "eta" : "create"}
            roomId={row.id}
            roomNumber={row.room_number}
            isOnline={isOnline}
            locale={locale}
            period={detail.period.data ?? row.unavailability}
            repairs={detail.repairs.data ?? []}
            onClose={() => setSheet(null)}
            onChanged={() => void reloadAll()}
          />
          <RoomReleaseSheet
            visible={sheet === "release"}
            roomId={row.id}
            roomNumber={row.room_number}
            isOnline={isOnline}
            locale={locale}
            period={detail.period.data}
            repairs={detail.repairs.data ?? []}
            hiddenActiveCount={row.others_active_count}
            onClose={() => setSheet(null)}
            onChanged={() => void reloadAll()}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 8 },
  back: { flexDirection: "row", alignItems: "center", minHeight: 44, alignSelf: "flex-start" },
  heroBody: { gap: 3 },
  kicker: { fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  number: { fontSize: 36, lineHeight: 40, fontWeight: "700" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  content: { padding: 18, gap: 14 },
});
