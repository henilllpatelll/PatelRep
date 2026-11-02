import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { warrantyState } from "@/lib/engineering/scheduleForm";
import { useTheme } from "@/lib/theme/useTheme";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import type { AssetDetail } from "@/lib/api/assets";
import { formatDay, formatDayYear } from "@/lib/engineering/assetFormat";
import { hotelDateKey } from "@/lib/housekeeping/hotelTime";
import type { AssetServiceStatus } from "@/lib/engineering/assetModel";
import type { PmScheduleView } from "@/lib/engineering/pmSchedules";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import { DetailRow, Panel, PanelTitle, StatusBadge } from "./assetUi";

export type AssetSection = "overview" | "maintenance" | "readings" | "history";

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
  /** Administrative actions (server-enforced; these only decide what is offered). */
  canManage?: boolean;
  canRetire?: boolean;
  /** Set the equipment's criticality - the same managers who may retire it. */
  onCriticality?: () => void;
  /** Record or end downtime (engineers, chief engineer, GM - the same people the API allows). */
  onDowntime?: () => void;
  onEdit?: () => void;
  onLabel?: () => void;
  onScan?: () => void;
  onRetire?: () => void;
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
export function AssetOverview({ asset, status, summary, pm, openSignals, language, timezone, offline, canRecordReading, canManage, canRetire, onCriticality, onDowntime, onEdit, onLabel, onScan, onRetire, onCreateWorkOrder, onOpenRoom, onGoto }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const location = asset.rooms?.room_number ? t("assets.roomLabel", { room: asset.rooms.room_number }) : asset.location_text?.trim() || null;
  const nextPm = pm.find((p) => p.nextDueAt != null) ?? null;
  const overduePm = pm.filter((p) => p.state === "overdue").length;
  const lastPm = pm.map((p) => p.lastCompletedAt).filter((v): v is string => !!v).sort().pop() ?? null;
  const downtime = asset.active_downtime ?? null;
  const warranty = asset.warranty_expires ? formatDayYear(asset.warranty_expires, timezone, language) : null;
  const warrantyKind = warrantyState(asset.warranty_expires, timezone);

  const retired = asset.is_active === false;
  const specs: Array<[string, string | null]> = [
    [t("assets.detail.name"), asset.name],
    [t("assets.detail.tag"), asset.asset_tag?.trim() || null],
    [t("assets.detail.type"), asset.asset_categories?.name?.trim() || null],
    [t("assets.detail.manufacturer"), asset.manufacturer?.trim() || null],
    [t("assets.detail.model"), asset.model?.trim() || null],
    [t("assets.detail.serial"), asset.serial_number?.trim() || null],
    [t("assets.detail.location"), location],
    [t("assets.detail.criticality"), asset.criticality ? t(`assets.criticality.${asset.criticality}`) : null],
    [t("assets.detail.installed"), asset.installation_date ? formatDayYear(asset.installation_date, timezone, language) : null],
    [t("assets.detail.warranty"), warranty ? t(`assets.detail.warrantyState.${warrantyKind === "unknown" ? "active" : warrantyKind}`, { date: warranty }) : null],
  ];
  const shown = specs.filter((row): row is [string, string] => !!row[1]);

  return (
    <View style={styles.stack} testID="asset-overview">
      {retired ? (
        <View style={[styles.retired, { backgroundColor: theme.status.pickupSoft }]} accessibilityRole="alert" testID="asset-retired-banner">
          <Ionicons name="archive-outline" size={18} color={theme.status.pickup} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.retiredText, { color: theme.textPrimary }]}>
            {t("assets.detail.retiredBanner")}
          </Text>
        </View>
      ) : null}
      <Panel>
        <Button label={t("assets.detail.createWo")} icon="construct-outline" onPress={onCreateWorkOrder} disabled={offline || retired} testID="asset-create-wo" />
        {offline ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notes, { color: theme.textMuted }]} testID="asset-create-offline">
            {t("assets.detail.createOffline")}
          </Text>
        ) : null}
        <View style={styles.actions}>
          {canRecordReading && !retired ? (
            <Button label={t("assets.detail.recordReading")} variant="secondary" size="sm" onPress={() => onGoto("readings")} style={styles.action} testID="asset-action-reading" />
          ) : null}
          <Button label={t("assets.detail.more")} icon="ellipsis-horizontal" variant="secondary" size="sm" onPress={() => setMoreOpen(true)} style={styles.action} testID="asset-action-more" />
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
        {asset.rooms?.room_number && status !== "operational" ? (
          <DetailRow label={t("assets.detail.roomImpact")} value={t("assets.detail.roomAffected", { room: asset.rooms.room_number })} />
        ) : null}
        <DetailRow label={t("assets.detail.reliability")} value={openSignals > 0 ? t("assets.detail.signalsOpen", { count: openSignals }) : t("assets.detail.noSignal")} />
      </Panel>

      <Panel testID="asset-maintenance-summary">
        <PanelTitle>{t("assets.detail.recentTitle")}</PanelTitle>
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
        <Button label={t("assets.detail.viewHistory")} variant="ghost" size="sm" onPress={() => onGoto("history")} testID="asset-action-history" />
      </Panel>

      <Panel testID="asset-specs">
        <PanelTitle>{t("assets.detail.equipmentTitle")}</PanelTitle>
        {asset.photo_url ? (
          <Image source={{ uri: asset.photo_url }} style={[styles.photo, { backgroundColor: theme.surfaceMuted }]} accessibilityLabel={t("assets.photo.previewLabel")} testID="asset-photo" />
        ) : null}
        {shown.map(([label, value]) => (
          <DetailRow key={label} label={label} value={value} />
        ))}
        {asset.notes?.trim() ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.notes, { color: theme.textSecondary }]}>
            {asset.notes.trim()}
          </Text>
        ) : null}
      </Panel>
      <BottomSheet visible={moreOpen} title={t("assets.detail.more")} onClose={() => setMoreOpen(false)} testID="asset-more-sheet">
        <MoreRow
          icon="construct-outline"
          label={t("assets.detail.repairHistory")}
          onPress={() => {
            setMoreOpen(false);
            onGoto("maintenance");
          }}
          testID="asset-more-repairs"
        />
        <MoreRow
          icon="calendar-outline"
          label={t("assets.detail.viewPm")}
          disabled={pm.length === 0}
          onPress={() => {
            setMoreOpen(false);
            onGoto("maintenance");
          }}
          testID="asset-action-pm"
        />
        {canManage && onEdit ? (
          <MoreRow
            icon="create-outline"
            label={t("assets.detail.edit")}
            onPress={() => {
              setMoreOpen(false);
              onEdit();
            }}
            testID="asset-action-edit"
          />
        ) : null}
        {onLabel ? (
          <MoreRow
            icon="qr-code-outline"
            label={t("assets.detail.qrLabel")}
            onPress={() => {
              setMoreOpen(false);
              onLabel();
            }}
            testID="asset-action-label"
          />
        ) : null}
        {onScan ? (
          <MoreRow
            icon="scan-outline"
            label={t("assets.detail.scanAnother")}
            onPress={() => {
              setMoreOpen(false);
              onScan();
            }}
            testID="asset-action-scan"
          />
        ) : null}
        {onOpenRoom && asset.rooms?.room_number ? (
          <MoreRow
            icon="bed-outline"
            label={t("assets.detail.viewRoom", { room: asset.rooms.room_number })}
            onPress={() => {
              setMoreOpen(false);
              onOpenRoom();
            }}
            testID="asset-action-room"
          />
        ) : null}
        {onDowntime && !retired ? (
          <MoreRow
            icon={downtime ? "refresh-circle-outline" : "ban-outline"}
            label={downtime ? t("assets.downtime.endAction") : t("assets.downtime.startAction")}
            onPress={() => {
              setMoreOpen(false);
              onDowntime();
            }}
            testID="asset-action-downtime"
          />
        ) : null}
        {canRetire && onCriticality && !retired ? (
          <MoreRow
            icon="shield-checkmark-outline"
            label={t("assets.criticality.action")}
            onPress={() => {
              setMoreOpen(false);
              onCriticality();
            }}
            testID="asset-action-criticality"
          />
        ) : null}
        {canRetire && onRetire && !retired ? (
          <MoreRow
            icon="archive-outline"
            label={t("assets.detail.retire")}
            onPress={() => {
              setMoreOpen(false);
              onRetire();
            }}
            testID="asset-action-retire"
          />
        ) : null}
      </BottomSheet>
    </View>
  );
}

function MoreRow({ icon, label, onPress, disabled, testID }: { icon: React.ComponentProps<typeof Ionicons>["name"]; label: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={[styles.moreRow, { borderColor: theme.borderSubtle, opacity: disabled ? 0.45 : 1 }]}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={theme.textSecondary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.moreLabel, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  action: { flexGrow: 1, flexBasis: "46%" },
  moreRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, borderBottomWidth: 1 },
  moreLabel: { flex: 1, fontSize: 15, fontWeight: "600" },
  retired: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 12 },
  retiredText: { flex: 1, fontSize: 14, lineHeight: 20 },
  photo: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12, marginBottom: 4 },
  chunk: { gap: 6 },
  chunkLabel: { fontSize: 13 },
  notes: { fontSize: 13.5, lineHeight: 19, marginTop: 2 },
});
