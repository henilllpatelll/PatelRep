import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { DetailRow, Panel, PanelTitle, StatusBadge as AssetStatusBadge } from "@/components/engineering/assets/assetUi";
import { StateBlock } from "@/components/ui/StateBlock";
import type { RoomAssets, RoomPeriod } from "@/lib/api/engineeringRooms";
import type { AsyncResource } from "@/lib/engineering/useAsyncResource";
import type { RoomHistory } from "@/lib/engineering/useRoomDetail";
import type { RoomBoardRow } from "@/lib/engineering/roomModel";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import { AvailabilityBadge, formatDay, formatWhen, priorityColor } from "./roomUi";

function Row({ onPress, children, label, testID }: { onPress: () => void; children: React.ReactNode; label: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => [styles.row, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.rowBody}>{children}</View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.textMuted }]}>
      {children}
    </Text>
  );
}

function Failed({ onRetry, text }: { onRetry: () => void; text: string }) {
  const { t } = useTranslation();
  return <StateBlock status="error" errorMessage={text} onRetry={onRetry} retryLabel={t("common.retry")} />;
}

export function RoomOverviewPanel({ row, locale }: { row: RoomBoardRow; locale: string }) {
  const { t } = useTranslation();
  const hk = row.housekeeping_status
    ? t(`roomStatus.statusLabels.${row.housekeeping_status}`, { defaultValue: row.housekeeping_status })
    : t("engRooms.detail.notReported");
  return (
    <Panel testID="room-overview">
      <PanelTitle>{t("engRooms.detail.overview")}</PanelTitle>
      <DetailRow label={t("engRooms.detail.occupancy")} value={t(`engRooms.occupancy.${row.occupancy}`)} />
      <DetailRow label={t("engRooms.detail.housekeeping")} value={hk} />
      <DetailRow
        label={t("engRooms.detail.availabilityRecord")}
        value={row.availability ? t(`engRooms.availability.${row.availability}`) : t("engRooms.detail.noDownRecord")}
      />
      <DetailRow label={t("engRooms.detail.activeRepairs")} value={String(row.active_repair_count + row.others_active_count)} />
      {row.last_activity_at ? <DetailRow label={t("engRooms.detail.lastActivity")} value={formatWhen(row.last_activity_at, locale)} /> : null}
      <Hint>
        {t("engRooms.detail.separateNote")}
      </Hint>
    </Panel>
  );
}

interface AvailabilityProps {
  row: RoomBoardRow;
  period: AsyncResource<RoomPeriod | null>;
  canManage: boolean;
  isOnline: boolean;
  locale: string;
  onManage: () => void;
  onEta: () => void;
  onRelease: () => void;
}

export function RoomAvailabilityPanel({ row, period, canManage, isOnline, locale, onManage, onEta, onRelease }: AvailabilityProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const active = period.data ?? row.unavailability;
  return (
    <Panel testID="room-availability">
      <PanelTitle>{t("engRooms.detail.availability")}</PanelTitle>
      {row.availability ? <AvailabilityBadge availability={row.availability} testID="room-availability-badge" /> : null}
      {period.failure && !period.data ? <Failed onRetry={() => void period.reload()} text={t("engRooms.detail.availabilityFailed")} /> : null}
      {active ? (
        <View style={styles.stack}>
          {active.reason_label ? <DetailRow label={t("engRooms.down.reason")} value={active.reason_label} /> : null}
          {active.started_at ? <DetailRow label={t("engRooms.detail.since")} value={formatWhen(active.started_at, locale)} /> : null}
          {active.expected_return_at ? (
            <DetailRow
              label={t("engRooms.detail.expectedBack")}
              value={`${formatWhen(active.expected_return_at, locale)}${active.is_past_eta ? ` · ${t("engRooms.detail.overdue")}` : ""}`}
            />
          ) : null}
          <Hint>
            {t("engRooms.down.estimateNote")}
          </Hint>
          {canManage ? (
            <View style={styles.actions}>
              <Button label={t("engRooms.detail.updateReturn")} variant="secondary" onPress={onEta} disabled={!isOnline} testID="room-update-eta" />
              <Button label={t("engRooms.detail.returnToService")} onPress={onRelease} disabled={!isOnline} testID="room-release" />
            </View>
          ) : null}
        </View>
      ) : row.availability === "unrecorded_down" ? (
        <View style={styles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textPrimary }]}>
            {t("engRooms.detail.unrecorded")}
          </Text>
          {canManage ? <Button label={t("engRooms.detail.recordDown")} variant="secondary" onPress={onManage} disabled={!isOnline} testID="room-record-down" /> : null}
        </View>
      ) : (
        <View style={styles.stack}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textSecondary }]}>
            {t("engRooms.detail.noDownBody")}
          </Text>
          {canManage ? <Button label={t("engRooms.manage.open")} variant="secondary" icon="swap-vertical-outline" onPress={onManage} disabled={!isOnline} testID="room-manage-availability" /> : null}
        </View>
      )}
      {!canManage ? <Hint>{t("engRooms.detail.readOnly")}</Hint> : null}
      {canManage && !isOnline ? <Hint>{t("engRooms.manage.offline")}</Hint> : null}
      <Hint>
        {t("engRooms.pmsNote")}
      </Hint>
    </Panel>
  );
}

interface RepairsProps {
  row: RoomBoardRow;
  repairs: AsyncResource<WorkOrder[]>;
  locale: string;
  onOpen: (woId: string) => void;
  onReport: () => void;
}

export function ActiveRepairsPanel({ row, repairs, locale, onOpen, onReport }: RepairsProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const list = repairs.data ?? [];
  return (
    <Panel testID="room-repairs">
      <PanelTitle>{t("engRooms.detail.repairs")}</PanelTitle>
      {repairs.failure && !repairs.data ? (
        <Failed onRetry={() => void repairs.reload()} text={t("engRooms.detail.repairsFailed")} />
      ) : repairs.loading && !repairs.data ? (
        <StateBlock status="loading" />
      ) : list.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("engRooms.detail.noRepairs")}
        </Text>
      ) : (
        <View style={styles.stack}>
          {list.map((wo) => (
            <Row key={wo.id} onPress={() => onOpen(wo.id)} label={t("engRooms.detail.openRepairLabel", { title: wo.title })} testID={`room-repair-${wo.id}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
                {workOrderLabel(wo) ?? ""}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                {wo.title}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: priorityColor(wo.priority, theme) }]}>
                {t(`workQueue.priority.${wo.priority}`)} · {t(`workOrders.status.${wo.status}`)}
                {wo.created_at ? ` · ${formatWhen(wo.created_at, locale)}` : ""}
              </Text>
            </Row>
          ))}
        </View>
      )}
      {row.others_active_count > 0 ? (
        <Hint>
          {t("engRooms.withColleagues", { count: row.others_active_count })}
        </Hint>
      ) : null}
      <Button label={t("engRooms.detail.reportHere")} variant="secondary" icon="add-circle-outline" onPress={onReport} testID="room-report-here" />
    </Panel>
  );
}

export function LinkedEquipmentPanel({ equipment, onOpen }: { equipment: AsyncResource<RoomAssets>; onOpen: (assetId: string) => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const list = equipment.data?.assets ?? [];
  return (
    <Panel testID="room-equipment">
      <PanelTitle>{t("engRooms.detail.equipment")}</PanelTitle>
      {equipment.failure && !equipment.data ? (
        <Failed onRetry={() => void equipment.reload()} text={t("engRooms.detail.equipmentFailed")} />
      ) : equipment.loading && !equipment.data ? (
        <StateBlock status="loading" />
      ) : list.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("engRooms.detail.noEquipment")}
        </Text>
      ) : (
        <View style={styles.stack}>
          {list.map((asset) => (
            <Row key={asset.id} onPress={() => onOpen(asset.id)} label={t("engRooms.detail.viewAssetLabel", { name: asset.name })} testID={`room-asset-${asset.id}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                {asset.name}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]} numberOfLines={1}>
                {[asset.asset_tag, asset.asset_categories?.name].filter(Boolean).join(" · ")}
              </Text>
              <View style={styles.inline}>
                <AssetStatusBadge status={asset.service_status} />
                {asset.active_work_order_count > 0 ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
                    {t("engRooms.detail.assetRepairs", { count: asset.active_work_order_count })}
                  </Text>
                ) : null}
              </View>
            </Row>
          ))}
          {equipment.data?.truncated ? (
            <Hint>
              {t("engRooms.detail.equipmentTruncated", { count: list.length })}
            </Hint>
          ) : null}
        </View>
      )}
    </Panel>
  );
}

interface HistoryProps {
  history: RoomHistory;
  periods: AsyncResource<RoomPeriod[]>;
  locale: string;
  onOpen: (woId: string) => void;
}

export function MaintenanceHistoryPanel({ history, periods, locale, onOpen }: HistoryProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const past = (periods.data ?? []).filter((p) => p.status !== "ACTIVE");
  return (
    <Panel testID="room-history">
      <PanelTitle>{t("engRooms.detail.history")}</PanelTitle>
      {history.failure && !history.loaded ? (
        <Failed onRetry={() => void history.reload()} text={t("engRooms.detail.historyFailed")} />
      ) : history.loading && !history.loaded ? (
        <StateBlock status="loading" />
      ) : history.orders.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("engRooms.detail.noHistory")}
        </Text>
      ) : (
        <View style={styles.stack}>
          {history.orders.map((wo) => (
            <Row key={wo.id} onPress={() => onOpen(wo.id)} label={t("engRooms.detail.openRepairLabel", { title: wo.title })} testID={`room-history-${wo.id}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
                {formatDay((wo as { completed_at?: string | null }).completed_at ?? wo.updated_at ?? wo.created_at, locale)} · {t(`workOrders.status.${wo.status}`)}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]} numberOfLines={2}>
                {wo.title}
              </Text>
            </Row>
          ))}
          {history.hasMore ? (
            <Button label={t("engRooms.detail.showMore")} variant="secondary" onPress={history.loadMore} loading={history.loadingMore} testID="room-history-more" />
          ) : null}
          {history.failure && history.loaded ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.note, { color: theme.status.dirty }]}>
              {t("engRooms.detail.historyMoreFailed")}
            </Text>
          ) : null}
        </View>
      )}

      <PanelTitle>{t("engRooms.detail.downHistory")}</PanelTitle>
      {periods.failure && !periods.data ? (
        <Failed onRetry={() => void periods.reload()} text={t("engRooms.detail.downHistoryFailed")} />
      ) : past.length === 0 ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.body, { color: theme.textMuted }]}>
          {t("engRooms.detail.noDownHistory")}
        </Text>
      ) : (
        <View style={styles.stack}>
          {past.slice(0, 5).map((p) => (
            <View key={p.id} style={[styles.period, { borderColor: theme.border }]} testID={`room-period-${p.id}`}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowTitle, { color: theme.textPrimary }]}>
                {t(`engRooms.down.types.${p.type}`)}
                {p.reason_label ? ` — ${p.reason_label}` : ""}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.small, { color: theme.textMuted }]}>
                {formatDay(p.started_at, locale)} → {p.actual_return_at ? formatDay(p.actual_return_at, locale) : t(`engRooms.periodStatus.${p.status ?? "CANCELLED"}`)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Panel>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 8 },
  actions: { gap: 8, marginTop: 4 },
  inline: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontSize: 14.5, fontWeight: "700" },
  small: { fontSize: 12.5 },
  body: { fontSize: 14, lineHeight: 20 },
  note: { fontSize: 12.5, lineHeight: 17 },
  period: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 2 },
});
