import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Pressable } from "react-native";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/lib/theme/useTheme";
import { useToast } from "@/lib/theme/useToast";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { StateBlock } from "@/components/ui/StateBlock";
import { AssetHistorySection } from "@/components/engineering/assets/AssetHistorySection";
import { AssetMaintenanceSection } from "@/components/engineering/assets/AssetMaintenanceSection";
import { AssetOverview, type AssetSection } from "@/components/engineering/assets/AssetOverview";
import { AssetReadingsSection } from "@/components/engineering/assets/AssetReadingsSection";
import { AssetReliabilityPanel } from "@/components/engineering/assets/AssetReliabilityPanel";
import { AssetWorkOrdersSection } from "@/components/engineering/assets/AssetWorkOrdersSection";
import { RecordReadingSheet } from "@/components/engineering/assets/RecordReadingSheet";
import { Pill, StaleNote, StatusBadge } from "@/components/engineering/assets/assetUi";
import {
  getAsset,
  getAssetMeters,
  getAssetPredictions,
  getAssetReliability,
  listAssetDocuments,
  listAssetDowntime,
  type AssetDetail,
} from "@/lib/api/assets";
import { listPmCompletions, type PmCompletionSummary } from "@/lib/api/pm";
import { buildAssetTimeline, type AssetServiceStatus } from "@/lib/engineering/assetModel";
import { classifyLoadFailure, type LoadFailure } from "@/lib/engineering/loadState";
import { adaptPmSchedules } from "@/lib/engineering/pmSchedules";
import { canActOnSignals, canRecordReadings } from "@/lib/engineering/roles";
import { markAssetListStale } from "@/lib/engineering/useAssetBrowse";
import { useAssetWorkOrders } from "@/lib/engineering/useAssetWorkOrders";
import { useAsyncResource } from "@/lib/engineering/useAsyncResource";
import { useHotelTimezone } from "@/lib/housekeeping/useHotelTimezone";
import { useAppStore } from "@/stores/appStore";
import type { PmScheduleRow } from "@/lib/api/assets";

const SECTIONS: readonly AssetSection[] = ["overview", "workOrders", "maintenance", "readings", "history"];

/** Falls back to downtime alone only for an older API that does not send the derived status. */
function statusOf(asset: AssetDetail): AssetServiceStatus {
  if (asset.service_status) return asset.service_status;
  const impact = asset.active_downtime?.impact_level;
  return impact === "out_of_service" ? "out_of_service" : impact === "degraded" ? "degraded" : "operational";
}

export default function AssetDetailScreen() {
  const { assetId } = useLocalSearchParams<{ assetId: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const user = useAppStore((s) => s.user);
  const isOnline = useAppStore((s) => s.isOnline);
  useHotelTimezone();
  const timezone = useAppStore((s) => s.hotelTimezone);
  const role = user?.effective_role ?? user?.role;
  const scope = user?.id && user?.tenant_id ? `${user.tenant_id}:${user.id}` : null;
  const id = typeof assetId === "string" ? assetId : "";
  const language = i18n.language;

  const asset = useAsyncResource((signal) => getAsset(id, signal), { scope, key: `asset:${id}`, enabled: !!id });
  const predictions = useAsyncResource((signal) => getAssetPredictions(id, signal), { scope, key: `asset-predictions:${id}`, enabled: !!id });
  const active = useAssetWorkOrders(scope, id, "active", !!id);
  const completed = useAssetWorkOrders(scope, id, "completed", !!id);
  const meters = useAsyncResource((signal) => getAssetMeters(id, signal), { scope, key: `asset-meters:${id}`, enabled: !!id });

  const [section, setSection] = useState<AssetSection>("overview");
  const [visited, setVisited] = useState<ReadonlySet<AssetSection>>(new Set(["overview"]));
  const [readingFor, setReadingFor] = useState<string | null>(null);
  const [readingToken, setReadingToken] = useState(0);
  const scroller = useRef<ScrollViewInstance>(null);

  // The tab screen is reused for another asset: start that one at the top, on Overview.
  useEffect(() => {
    setSection("overview");
    setVisited(new Set(["overview"]));
    setReadingFor(null);
    setPmHistory(null);
  }, [id]);

  // Report an issue for this equipment: the shared form opens with it linked and its room as the location.
  const openReport = useCallback(() => {
    const detail = asset.data;
    if (!detail) return;
    router.push({
      pathname: "/(app)/work-orders/new",
      params: {
        from: "asset",
        assetId: detail.id,
        assetName: detail.name,
        assetCategory: detail.asset_categories?.code ?? "",
        assetLocation: detail.location_text ?? "",
        assetRoomId: detail.room_id ?? "",
        assetRoomNumber: detail.rooms?.room_number ?? "",
      },
    } as never);
  }, [asset.data]);
  const openRoom = useCallback(() => {
    const roomId = asset.data?.room_id;
    if (roomId) router.push({ pathname: "/(app)/room-status/[roomId]", params: { roomId } } as never);
  }, [asset.data]);

  const go = useCallback((next: AssetSection) => {
    setSection(next);
    setVisited((v) => (v.has(next) ? v : new Set([...v, next])));
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, []);

  // History-tier reads happen only once their section is opened.
  const downtime = useAsyncResource((signal) => listAssetDowntime(id, signal), { scope, key: `asset-downtime:${id}`, enabled: !!id && visited.has("history") });
  const reliability = useAsyncResource((signal) => getAssetReliability(id, signal), { scope, key: `asset-reliability:${id}`, enabled: !!id && visited.has("history") });
  const documents = useAsyncResource((signal) => listAssetDocuments(id, signal), { scope, key: `asset-documents:${id}`, enabled: !!id && visited.has("history") });

  // PM inspection history pages with the Phase 5 endpoint, filtered to this asset.
  const [pmHistory, setPmHistory] = useState<{ rows: PmCompletionSummary[]; hasMore: boolean } | null>(null);
  const [pmFailure, setPmFailure] = useState<LoadFailure | null>(null);
  const pmBusy = useRef(false);
  const loadPmHistory = useCallback(async () => {
    if (pmBusy.current || !id) return;
    pmBusy.current = true;
    setPmFailure(null);
    try {
      const offset = pmHistory?.rows.length ?? 0;
      const page = await listPmCompletions({ assetId: id, offset, limit: 10 });
      setPmHistory((prev) => {
        const seen = new Set((prev?.rows ?? []).map((r) => r.id));
        return { rows: [...(prev?.rows ?? []), ...page.rows.filter((r) => !seen.has(r.id))], hasMore: page.hasMore };
      });
    } catch (err) {
      setPmFailure(classifyLoadFailure(err));
    } finally {
      pmBusy.current = false;
    }
  }, [id, pmHistory]);
  useEffect(() => {
    if (section === "maintenance" && pmHistory == null && !pmFailure) void loadPmHistory();
    if (section === "history" && pmHistory == null && !pmFailure) void loadPmHistory();
  }, [section, pmHistory, pmFailure, loadPmHistory]);

  // Hidden tab screens stay mounted: re-read when the person returns from a work order or PM record.
  const first = useRef(true);
  const reloadAll = useCallback(() => {
    void asset.reload();
    void active.reload();
    void completed.reload();
    void predictions.reload();
  }, [asset, active, completed, predictions]);
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reloadAll();
    }, [id]),
  );

  const data = asset.data;
  const pmViews = useMemo(() => {
    if (!data) return [];
    const rows: PmScheduleRow[] = (data.pm_schedules ?? []).map((s) => ({
      ...(s as unknown as PmScheduleRow),
      asset_id: data.id,
      assets: {
        name: data.name,
        room_id: data.room_id ?? null,
        asset_tag: data.asset_tag ?? null,
        location_text: data.location_text ?? null,
        manufacturer: data.manufacturer ?? null,
        asset_categories: data.asset_categories ?? null,
        rooms: data.rooms ?? null,
      },
    }));
    return adaptPmSchedules(rows, timezone);
  }, [data, timezone]);

  const events = useMemo(
    () =>
      buildAssetTimeline({
        downtime: downtime.data ?? [],
        workOrders: [...active.orders, ...completed.orders],
        pmCompletions: pmHistory?.rows ?? [],
        readings: (meters.data ?? []).flatMap((m) => (m.latest_reading ? [{ id: m.latest_reading.id, recorded_at: m.latest_reading.recorded_at, meter: m.name }] : [])),
      }),
    [downtime.data, active.orders, completed.orders, pmHistory, meters.data],
  );

  const onRecorded = useCallback(() => {
    toast.success(t("assets.readings.recorded.toast"));
    setReadingToken((n) => n + 1);
    void meters.reload();
  }, [meters, t, toast]);

  const back = () => (router.canGoBack() ? router.back() : router.replace("/(app)/assets"));

  // ── States that replace the screen ──
  if (!id || asset.status === 404 || (asset.failure === "failed" && asset.status === 422)) {
    return <Unavailable onBack={back} title={t("assets.detail.unavailableTitle")} body={t("assets.detail.unavailableBody")} insetsTop={insets.top} />;
  }
  if (!data) {
    return (
      <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insets.top + 8 }]} testID="asset-detail-state">
        <BackRow onBack={back} />
        {asset.failure === "forbidden" ? (
          <StateBlock status="error" errorIcon="lock-closed-outline" errorMessage={t("engineeringState.forbidden")} />
        ) : asset.failure ? (
          <StateBlock
            status="error"
            errorIcon={asset.failure === "offline" ? "cloud-offline-outline" : undefined}
            errorMessage={asset.failure === "offline" ? t("assets.detail.offlineUncached") : t("engineeringState.loadFailed")}
            onRetry={() => void asset.reload()}
            retryLabel={t("common.retry")}
          />
        ) : (
          <StateBlock status="loading" />
        )}
      </View>
    );
  }

  const status = statusOf(data);
  const subtitle = [data.asset_tag?.trim(), data.asset_categories?.name?.trim(), data.rooms?.room_number ? t("assets.roomLabel", { room: data.rooms.room_number }) : data.location_text?.trim()]
    .filter(Boolean)
    .join(" · ");
  const openSignals = predictions.data?.length ?? 0;
  const recordMeters = (meters.data ?? []).filter((m) => m.is_active !== false);
  const canRecord = canRecordReadings(role);
  const staleNote = asset.failure != null;

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]} testID="asset-detail">
      <View style={[styles.hero, { paddingTop: insets.top + 8, backgroundColor: theme.shell.bg }]}>
        <BackRow onBack={back} dark />
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.heroTitle, { color: theme.shell.ink }]} testID="asset-detail-title">
          {data.name}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heroSub, { color: theme.shell.ink2 }]}>
            {subtitle}
          </Text>
        ) : null}
        <StatusBadge status={status} testID="asset-detail-status" />
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {SECTIONS.map((key) => (
          <Pill
            key={key}
            label={t(`assets.sections.${key}`)}
            selected={section === key}
            onPress={() => go(key)}
            count={key === "workOrders" ? data.active_work_order_count : undefined}
            testID={`asset-section-${key}`}
          />
        ))}
      </View>

      <ScrollView
        ref={scroller}
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={<RefreshControl refreshing={asset.refreshing} onRefresh={() => reloadAll()} tintColor={theme.primaryAction} />}
        keyboardShouldPersistTaps="handled"
      >
        {staleNote ? (
          <StaleNote testID="asset-detail-stale">{asset.failure === "offline" || !isOnline ? t("assets.stale.detailOffline") : t("assets.stale.detailFailed")}</StaleNote>
        ) : null}

        {section === "overview" ? (
          <>
            <AssetOverview
              asset={data}
              status={status}
              summary={{
                activeCount: data.active_work_order_count ?? 0,
                lastCompleted: completed.orders[0] ?? null,
                completedFailed: completed.resource.failure != null && completed.resource.data == null,
              }}
              pm={pmViews}
              openSignals={openSignals}
              language={language}
              timezone={timezone}
              offline={!isOnline}
              canRecordReading={canRecord && recordMeters.length > 0}
              onCreateWorkOrder={openReport}
              onOpenRoom={data.room_id ? openRoom : undefined}
              onGoto={go}
            />
            <AssetReliabilityPanel
              predictions={predictions.data ?? []}
              canAct={canActOnSignals(role) && isOnline}
              language={language}
              timezone={timezone}
              onChanged={() => {
                markAssetListStale();
                reloadAll();
              }}
            />
          </>
        ) : null}

        {section === "workOrders" ? (
          <AssetWorkOrdersSection
            active={active}
            completed={completed}
            scoped={role === "engineer"}
            repeats90d={data.repeat_repairs_90d ?? null}
            language={language}
            timezone={timezone}
          />
        ) : null}

        {section === "maintenance" ? (
          <AssetMaintenanceSection
            schedules={pmViews}
            history={pmHistory?.rows ?? null}
            historyFailure={pmFailure}
            hasMoreHistory={pmHistory?.hasMore ?? false}
            onLoadHistory={() => void loadPmHistory()}
            language={language}
            timezone={timezone}
          />
        ) : null}

        {section === "readings" ? (
          <AssetReadingsSection
            scope={scope}
            meters={meters.data}
            metersFailed={meters.failure != null}
            onRetryMeters={() => void meters.reload()}
            canRecord={canRecord}
            refreshToken={readingToken}
            onRecord={(meterId) => setReadingFor(meterId)}
            language={language}
            timezone={timezone}
          />
        ) : null}

        {section === "history" ? (
          <AssetHistorySection
            events={events}
            downtime={{ data: downtime.data, loading: downtime.loading, failed: downtime.failure != null, reload: () => void downtime.reload() }}
            reliability={{ data: reliability.data, loading: reliability.loading, failed: reliability.failure != null, reload: () => void reliability.reload() }}
            documents={{ data: documents.data, loading: documents.loading, failed: documents.failure != null, reload: () => void documents.reload() }}
            language={language}
            timezone={timezone}
          />
        ) : null}
      </ScrollView>

      <RecordReadingSheet
        visible={readingFor != null}
        meters={recordMeters}
        initialMeterId={readingFor}
        isOnline={isOnline}
        onClose={() => setReadingFor(null)}
        onRecorded={onRecorded}
      />
    </View>
  );
}

function BackRow({ onBack, dark }: { onBack: () => void; dark?: boolean }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t("common.back")} hitSlop={10} style={styles.back} testID="asset-detail-back">
      <Ionicons name="chevron-back" size={24} color={dark ? theme.shell.ink : theme.textPrimary} />
    </Pressable>
  );
}

function Unavailable({ onBack, title, body, insetsTop }: { onBack: () => void; title: string; body: string; insetsTop: number }) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: insetsTop + 8 }]} testID="asset-unavailable">
      <BackRow onBack={onBack} />
      <StateBlock status="empty" emptyIcon="cube-outline" emptyTitle={title} emptyBody={body} />
      <View style={styles.unavailableAction}>
        <Button label={t("assets.detail.backToAssets")} variant="secondary" onPress={() => router.replace("/(app)/assets")} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  hero: { paddingHorizontal: 18, paddingBottom: 18, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, gap: 8 },
  back: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center", marginLeft: -4 },
  heroTitle: { fontSize: 25, lineHeight: 30, fontWeight: "600" },
  heroSub: { fontSize: 13.5 },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 18, paddingTop: 12 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 14, gap: 12 },
  unavailableAction: { paddingHorizontal: 24, marginTop: 8 },
});
