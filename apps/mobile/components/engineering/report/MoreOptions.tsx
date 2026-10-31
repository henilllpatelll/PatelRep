import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { StateBlock } from "@/components/ui/StateBlock";
import { useTheme } from "@/lib/theme/useTheme";
import { FieldLabel, Note } from "@/components/engineering/workorder/sheetKit";
import { RoomDownFields } from "@/components/engineering/rooms/RoomDownFields";
import { OptionSheet } from "@/components/engineering/report/OptionSheet";
import { listAssetRepairs } from "@/lib/api/workOrders";
import { listRoomAssets, listRoomRepairHistory } from "@/lib/api/engineeringRooms";
import { EMPTY_AVAILABILITY_DRAFT } from "@/lib/engineering/roomAvailability";
import { ASSET_IMPACTS, REPORT_SOURCES, type AssetImpact, type ReportAsset, type ReportSource } from "@/lib/engineering/reportIssue";
import { canManageAvailability } from "@/lib/engineering/roomModel";
import { canActOnWorkOrders } from "@/lib/engineering/roles";
import type { ReportIssue } from "@/lib/engineering/useReportIssue";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import type { WorkOrder } from "@/lib/engineering/workOrders";
import type { AssetRow } from "@/lib/engineering/assetModel";

interface Props {
  report: ReportIssue;
  role: string | null | undefined;
  isOnline: boolean;
  locale: string;
  disabled?: boolean;
}

function SwitchRow({ label, hint, value, onChange, disabled, testID }: { label: string; hint?: string; value: boolean; onChange: (next: boolean) => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.rowCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
      <View style={styles.rowBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]}>
          {label}
        </Text>
        {hint ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowHint, { color: theme.textMuted }]}>
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={label} testID={testID} trackColor={{ true: theme.primaryAction }} />
    </View>
  );
}

function PickRow({ label, value, onPress, disabled, testID }: { label: string; value: string; onPress: () => void; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
      style={[styles.rowCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle, opacity: disabled ? 0.5 : 1 }]}
    >
      <View style={styles.rowBody}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowHint, { color: theme.textMuted }]}>
          {label}
        </Text>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]} numberOfLines={2}>
          {value}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={theme.textMuted} />
    </Pressable>
  );
}

/** Everything beyond the five core fields, collapsed by default. Each option appears only when the API supports it and this role may use it. */
export function MoreOptions({ report, role, isOnline, locale, disabled }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { draft } = report;
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<"source" | "impact" | "equipment" | "repeat" | null>(null);

  const room = draft.location?.kind === "room" ? draft.location : null;
  const canAssign = canActOnWorkOrders(role);
  const canDown = canManageAvailability(role) && Boolean(room) && isOnline;
  const roomDownErrors = report.validation.roomDown;

  return (
    <View style={styles.stack}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={t("report.more.title")}
        style={[styles.toggle, { borderColor: theme.border }]}
        testID="report-more-toggle"
      >
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.toggleText, { color: theme.textPrimary }]}>
          {t("report.more.title")}
        </Text>
        <Ionicons name={open ? "chevron-up" : "chevron-down"} size={18} color={theme.textMuted} />
      </Pressable>

      {open ? (
        <View style={styles.stack} testID="report-more">
          {draft.asset ? (
            <View style={[styles.rowCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]} testID="report-linked-asset">
              <Ionicons name="cube-outline" size={18} color={theme.textMuted} />
              <View style={styles.rowBody}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowHint, { color: theme.textMuted }]}>
                  {t("report.more.equipment")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]} numberOfLines={2}>
                  {draft.asset.name}
                </Text>
              </View>
              <Pressable onPress={() => report.setAsset(null)} disabled={disabled} accessibilityRole="button" accessibilityLabel={t("report.more.removeEquipment")} hitSlop={8} style={styles.iconButton} testID="report-remove-asset">
                <Ionicons name="close-circle" size={22} color={theme.textMuted} />
              </Pressable>
            </View>
          ) : room ? (
            <PickRow label={t("report.more.equipment")} value={t("report.more.linkEquipment")} onPress={() => setSheet("equipment")} disabled={disabled} testID="report-link-asset" />
          ) : null}

          {draft.asset ? (
            <PickRow
              label={t("report.more.impact")}
              value={t(`report.more.impacts.${draft.assetImpact}`)}
              onPress={() => setSheet("impact")}
              disabled={disabled}
              testID="report-impact"
            />
          ) : null}

          <PickRow label={t("report.more.source")} value={t(`report.more.sources.${draft.source}`)} onPress={() => setSheet("source")} disabled={disabled} testID="report-source" />

          {canAssign ? (
            <SwitchRow label={t("report.more.assignMe")} hint={t("report.more.assignMeHint")} value={draft.assignToMe} onChange={(assignToMe) => report.update({ assignToMe })} disabled={disabled} testID="report-assign-me" />
          ) : null}

          {room || draft.asset ? (
            draft.repeatOf ? (
              <View style={[styles.rowCard, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]} testID="report-repeat-chosen">
                <View style={styles.rowBody}>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowHint, { color: theme.textMuted }]}>
                    {t("report.more.repeat")}
                  </Text>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textPrimary }]} numberOfLines={2}>
                    {draft.repeatOf.label}
                  </Text>
                </View>
                <Pressable onPress={() => report.update({ repeatOf: null })} disabled={disabled} accessibilityRole="button" accessibilityLabel={t("report.more.removeRepeat")} hitSlop={8} style={styles.iconButton} testID="report-remove-repeat">
                  <Ionicons name="close-circle" size={22} color={theme.textMuted} />
                </Pressable>
              </View>
            ) : (
              <PickRow label={t("report.more.repeat")} value={t("report.more.repeatPick")} onPress={() => setSheet("repeat")} disabled={disabled} testID="report-repeat" />
            )
          ) : null}

          {canDown ? (
            <View style={styles.stack}>
              <SwitchRow
                label={t("report.more.roomDown")}
                hint={t("report.more.roomDownHint")}
                value={draft.roomDown != null}
                onChange={(on) => report.setRoomDown(on ? { ...EMPTY_AVAILABILITY_DRAFT } : null)}
                disabled={disabled}
                testID="report-room-down"
              />
              {draft.roomDown ? (
                <View style={[styles.downBox, { borderColor: theme.status.pickup, backgroundColor: theme.surface }]} testID="report-room-down-fields">
                  <Note tone="warn">{t("report.more.roomDownWarning")}</Note>
                  <RoomDownFields
                    draft={draft.roomDown}
                    onChange={(patch) => report.setRoomDown({ ...(draft.roomDown ?? EMPTY_AVAILABILITY_DRAFT), ...patch })}
                    reasons={report.reasons}
                    reasonsFailed={report.reasonsFailed}
                    errors={roomDownErrors}
                    showErrors={report.showErrors}
                    locale={locale}
                    disabled={disabled}
                    testIDPrefix="report-down"
                  />
                </View>
              ) : null}
            </View>
          ) : room && canManageAvailability(role) && !isOnline ? (
            <Note tone="warn">{t("report.more.roomDownOffline")}</Note>
          ) : null}
        </View>
      ) : null}

      <OptionSheet
        visible={sheet === "source"}
        title={t("report.more.source")}
        options={REPORT_SOURCES.map((value: ReportSource) => ({ value, label: t(`report.more.sources.${value}`) }))}
        value={draft.source}
        onSelect={(source) => report.update({ source })}
        onClose={() => setSheet(null)}
        testID="report-source-sheet"
      />
      <OptionSheet
        visible={sheet === "impact"}
        title={t("report.more.impact")}
        options={ASSET_IMPACTS.map((value: AssetImpact) => ({ value, label: t(`report.more.impacts.${value}`), hint: t(`report.more.impactHints.${value}`) }))}
        value={draft.assetImpact}
        onSelect={(assetImpact) => report.update({ assetImpact })}
        onClose={() => setSheet(null)}
        testID="report-impact-sheet"
      />
      <EquipmentPickerSheet
        visible={sheet === "equipment"}
        roomId={room?.roomId ?? null}
        roomNumber={room?.roomNumber ?? ""}
        onPick={(asset) => report.setAsset(asset)}
        onClose={() => setSheet(null)}
      />
      <RepeatPickerSheet
        visible={sheet === "repeat"}
        roomId={room?.roomId ?? null}
        assetId={draft.asset?.id ?? null}
        onPick={(wo) => report.update({ repeatOf: { id: wo.id, label: [workOrderLabel(wo), wo.title].filter(Boolean).join(" · ") } })}
        onClose={() => setSheet(null)}
      />
    </View>
  );
}

function EquipmentPickerSheet({ visible, roomId, roomNumber, onPick, onClose }: { visible: boolean; roomId: string | null; roomNumber: string; onPick: (asset: ReportAsset) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [assets, setAssets] = useState<AssetRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible || !roomId) return;
    const abort = new AbortController();
    setAssets(null);
    setFailed(false);
    listRoomAssets(roomId, abort.signal)
      .then((result) => !abort.signal.aborted && setAssets(result.assets))
      .catch(() => !abort.signal.aborted && setFailed(true));
    return () => abort.abort();
  }, [visible, roomId]);
  return (
    <BottomSheet visible={visible} title={t("report.more.equipmentIn", { room: roomNumber })} onClose={onClose} testID="report-equipment-sheet">
      <View style={styles.stack}>
        {failed ? <StateBlock status="error" errorMessage={t("engRooms.detail.equipmentFailed")} /> : null}
        {!failed && assets == null ? <StateBlock status="loading" /> : null}
        {assets && assets.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5 }}>
            {t("engRooms.detail.noEquipment")}
          </Text>
        ) : null}
        {assets?.map((asset) => (
          <PickRow
            key={asset.id}
            label={asset.asset_categories?.name ?? t("report.more.equipment")}
            value={asset.name}
            testID={`report-equipment-${asset.id}`}
            onPress={() => {
              onPick({ id: asset.id, name: asset.name, categoryCode: asset.asset_categories?.code ?? null, roomId: asset.room_id ?? null, roomNumber: asset.rooms?.room_number ?? null, locationText: asset.location_text ?? null });
              onClose();
            }}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

function RepeatPickerSheet({ visible, roomId, assetId, onPick, onClose }: { visible: boolean; roomId: string | null; assetId: string | null; onPick: (wo: WorkOrder) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!visible) return;
    const abort = new AbortController();
    setOrders(null);
    setFailed(false);
    const load = assetId ? listAssetRepairs(assetId, abort.signal) : roomId ? listRoomRepairHistory(roomId, 1, abort.signal).then((page) => page.orders.filter((wo) => wo.status === "completed")) : Promise.resolve([]);
    load.then((list) => !abort.signal.aborted && setOrders(list)).catch(() => !abort.signal.aborted && setFailed(true));
    return () => abort.abort();
  }, [visible, roomId, assetId]);
  return (
    <BottomSheet visible={visible} title={t("report.more.repeat")} onClose={onClose} testID="report-repeat-sheet">
      <View style={styles.stack}>
        <FieldLabel>{t("report.more.repeatHint")}</FieldLabel>
        {failed ? <StateBlock status="error" errorMessage={t("engineeringState.loadFailed")} /> : null}
        {!failed && orders == null ? <StateBlock status="loading" /> : null}
        {orders && orders.length === 0 ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5 }}>
            {t("report.more.repeatNone")}
          </Text>
        ) : null}
        {orders?.map((wo) => (
          <PickRow
            key={wo.id}
            label={workOrderLabel(wo) ?? ""}
            value={wo.title}
            testID={`report-repeat-${wo.id}`}
            onPress={() => {
              onPick(wo);
              onClose();
            }}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 52, borderTopWidth: 1, paddingTop: 4 },
  toggleText: { fontSize: 15, fontWeight: "700" },
  rowCard: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 56, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  rowBody: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 14.5, fontWeight: "700" },
  rowHint: { fontSize: 12.5 },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  downBox: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
});
