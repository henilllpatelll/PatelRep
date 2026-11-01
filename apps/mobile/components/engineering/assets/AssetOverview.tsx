import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import { MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import type { AssetDetail } from "@/lib/api/assets";
import { formatDay, formatDayYear } from "@/lib/engineering/assetFormat";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import type { AssetServiceStatus } from "@/lib/engineering/assetModel";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { DetailRow, Panel, PanelTitle, StatusBadge } from "./assetUi";

export type AssetSection = "overview" | "workOrders" | "maintenance" | "readings" | "history";

export interface OverviewSummary {
  /** Property-wide count from the API (counts only). */
  activeCount: number;
  /** Most recent completed repair the signed-in person can see. */
  lastCompleted: WorkOrder | null;
  completedFailed: boolean;
}

interface Props {
  asset: AssetDetail;
  status: AssetServiceStatus;
  summary: OverviewSummary;
  /** Active PM schedules for this asset, adapted with the Phase 5 hotel-day rules. */
  pm: readonly PmScheduleView[];
  openSignals: number;
  language: string;
  timezone: string | null | undefined;
  /** Creating an order needs the network (nothing is queued for equipment), so the button says why it is off. */
  offline: boolean;
  canRecordReading: boolean;
  onCreateWorkOrder: () => void;
  /** Opens the room this equipment is registered to (absent when it is not in a guest room). */
  onOpenRoom?: () => void;
  onGoto: (section: AssetSection) => void;
}

function Chunk({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.chunk}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.chunkLabel, { color: theme.textMuted }]}>
        {label}
      </Text>
      {children}
    </View>
  );
}

/** Equipment identity, what is happening to it right now, and the actions an engineer takes from here. */
export function AssetOverview({ asset, status, summary, pm, openSignals, language, timezone, offline, canRecordReading, onCreateWorkOrder, onOpenRoom, onGoto }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const location = asset.rooms?.room_number ? t("assets.roomLabel", { room: asset.rooms.room_number }) : asset.location_text?.trim() || null;
  const nextPm = pm.find((p) => p.nextDueAt != null) ?? null;
  const overduePm = pm.filter((p) => p.state === "overdue").length;
  const lastPm = pm.map((p) => p.lastCompletedAt).filter((v): v is string => !!v).sort().pop() ?? null;
  const downtime = asset.active_downtime ?? null;
  const warranty = asset.warranty_expires ? formatDayYear(asset.warranty_expires, timezone, language) : null;
  const warrantyExpired = !!asset.warranty_expires && asset.warranty_expires < (hotelDateKey(new Date(), timezone) ?? "");

  const specs: Array<[string, string | null]> = [
    [t("assets.detail.name"), asset.name],
    [t("assets.detail.tag"), asset.asset_tag?.trim() || null],
    [t("assets.detail.type"), asset.asset_categories?.name?.trim() || null],
    [t("assets.detail.manufacturer"), asset.manufacturer?.trim() || null],
    [t("assets.detail.model"), asset.model?.trim() || null],
    [t("assets.detail.serial"), asset.serial_number?.trim() || null],
    [t("assets.detail.location"), location],
    [t("assets.detail.installed"), asset.installation_date ? formatDayYear(asset.installation_date, timezone, language) : null],
    [t("assets.detail.warranty"), warranty ? (warrantyExpired ? t("assets.detail.warrantyExpired", { date: warranty }) : t("assets.detail.warrantyUntil", { date: warranty })) : null],
  ];
  const shown = specs.filter((row): row is [string, string] => !!row[1]);

  return (
    <View style={styles.stack} testID="asset-overview">
      <Panel>
        <Button label={t("assets.detail.createWo")} icon="construct-outline" onPress={onCreateWorkOrder} disabled={offline} testID="asset-create-wo" />
        {offline ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notes, { color: theme.textMuted }]} testID="asset-create-offline">
            {t("assets.detail.createOffline")}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <Button label={t("assets.detail.viewPm")} variant="secondary" size="sm" onPress={() => onGoto("maintenance")} style={styles.action} testID="asset-action-pm" disabled={pm.length === 0} />
          <Button label={t("assets.detail.repairHistory")} variant="secondary" size="sm" onPress={() => onGoto("workOrders")} style={styles.action} testID="asset-action-history" />
          {onOpenRoom && asset.rooms?.room_number ? (
            <Button label={t("assets.detail.viewRoom", { room: asset.rooms.room_number })} variant="secondary" size="sm" onPress={onOpenRoom} style={styles.action} testID="asset-action-room" />
          ) : null}
          {canRecordReading ? (
            <Button label={t("assets.detail.recordReading")} variant="secondary" size="sm" onPress={() => onGoto("readings")} style={styles.action} testID="asset-action-reading" />
          ) : null}
        </View>
      </Panel>

      <Panel testID="asset-status-panel">
        <PanelTitle>{t("assets.detail.statusTitle")}</PanelTitle>
        <Chunk label={t("assets.detail.operational")}>
          <StatusBadge status={status} />
        </Chunk>
        <DetailRow
          label={t("assets.detail.activeRepairs")}
          value={summary.activeCount > 0 ? t("assets.detail.activeRepairsCount", { count: summary.activeCount }) : t("assets.detail.noneActive")}
        />
        <DetailRow
          label={t("assets.detail.plannedMaintenance")}
          value={
            pm.length === 0
              ? t("assets.detail.noPm")
              : overduePm > 0
                ? t("assets.detail.pmOverdue", { count: overduePm })
                : nextPm
                  ? t("assets.detail.pmNext", { date: formatDay(nextPm.nextDueAt, timezone, language) ?? "" })
                  : t("assets.detail.pmUnscheduled")
          }
        />
        <DetailRow
          label={t("assets.detail.downtime")}
          value={downtime ? t("assets.detail.downtimeSince", { date: formatDay(downtime.started_at, timezone, language) ?? "" }) : t("assets.detail.noDowntime")}
        />
        <DetailRow label={t("assets.detail.reliability")} value={openSignals > 0 ? t("assets.detail.signalsOpen", { count: openSignals }) : t("assets.detail.noSignal")} />
      </Panel>

      <Panel testID="asset-maintenance-summary">
        <PanelTitle>{t("assets.detail.summaryTitle")}</PanelTitle>
        <DetailRow label={t("assets.detail.activeRepairs")} value={String(summary.activeCount)} />
        <DetailRow
          label={t("assets.detail.lastRepair")}
          value={
            summary.completedFailed
              ? t("assets.detail.unavailable")
              : summary.lastCompleted
                ? formatDayYear(summary.lastCompleted.completed_at ?? summary.lastCompleted.updated_at, timezone, language) ?? t("assets.detail.notRecorded")
                : t("assets.detail.noneRecorded")
          }
        />
        <DetailRow label={t("assets.detail.lastPm")} value={lastPm ? formatDayYear(lastPm, timezone, language) ?? "" : t("assets.detail.noneRecorded")} />
        <DetailRow label={t("assets.detail.nextPm")} value={nextPm ? formatDayYear(nextPm.nextDueAt, timezone, language) ?? "" : t("assets.detail.noPm")} />
      </Panel>

      <Panel testID="asset-specs">
        <PanelTitle>{t("assets.detail.equipmentTitle")}</PanelTitle>
        {shown.map(([label, value]) => (
          <DetailRow key={label} label={label} value={value} />
        ))}
        {asset.notes?.trim() ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notes, { color: theme.textSecondary }]}>
            {asset.notes.trim()}
          </Text>
        ) : null}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flexGrow: 1, flexBasis: "46%" },
  chunk: { gap: 6 },
  chunkLabel: { fontSize: 13 },
  notes: { fontSize: 13.5, lineHeight: 19, marginTop: 2 },
});
