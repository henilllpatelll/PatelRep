import { StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/lib/theme/useTheme";
import type { Room } from "@/stores/appStore";
import type { LocalCleanSession } from "@/lib/housekeeping/cleanSession";
import { cleanTypeLabel, formatClock, locationLabel, statusLabel, type TextContext, type Translate } from "@/lib/housekeeping/myRoomsText";
import { BottomSheet, MAX_FONT_SCALE } from "./BottomSheet";

interface Props {
  visible: boolean;
  room: Room;
  session: LocalCleanSession | undefined;
  /** "Started by you at 9:10 AM" — the room history's most recent line, when loaded. */
  lastAction: string | null;
  ctx: TextContext;
  onClose: () => void;
}

interface Row {
  label: string;
  value: string;
}

/**
 * Everything that is useful but not needed to do the work: room, front desk,
 * instructions, history and the inspection that sent a room back. Guest names are
 * deliberately not shown — housekeeping does not need them to clean a room.
 */
export function RoomInformationSheet({ visible, room, session, lastAction, ctx, onClose }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const tr = t as Translate;

  const roomRows: Row[] = [];
  const typeName = room.room_type_name ?? room.rooms?.room_types?.name ?? null;
  const typeCode = room.room_type_code ?? room.rooms?.room_types?.code ?? null;
  if (typeName || typeCode) roomRows.push({ label: t("rooms.work.roomInfo.roomType"), value: [typeName, typeCode && typeName !== typeCode ? typeCode : null].filter(Boolean).join(" · ") });
  const clean = cleanTypeLabel(room, tr);
  if (clean) roomRows.push({ label: t("rooms.work.roomInfo.cleanType"), value: clean });
  const location = locationLabel(room, tr);
  if (location) roomRows.push({ label: t("rooms.work.roomInfo.location"), value: location });
  roomRows.push({ label: t("rooms.work.roomInfo.status"), value: statusLabel(room.status, tr) });

  const deskRows: Row[] = [];
  if (room.fo_status) deskRows.push({ label: t("rooms.work.roomInfo.frontDesk"), value: room.fo_status === "OCC" ? t("rooms.work.roomInfo.occupied") : t("rooms.work.roomInfo.vacant") });
  const scheduled = formatClock(room.checkout_time, ctx);
  if (scheduled) deskRows.push({ label: t("rooms.work.roomInfo.scheduledCheckout"), value: scheduled });
  const actual = formatClock(room.actual_checkout_at, ctx);
  deskRows.push({ label: t("rooms.work.roomInfo.confirmedCheckout"), value: actual ?? t("rooms.work.roomInfo.notConfirmed") });
  const arrival = formatClock(room.checkin_time, ctx);
  if (arrival) deskRows.push({ label: t("rooms.work.roomInfo.nextArrival"), value: arrival });
  const predicted = formatClock(room.predicted_ready_at, ctx);
  if (predicted) deskRows.push({ label: t("rooms.work.roomInfo.predictedReady"), value: predicted });

  const historyRows: Row[] = [];
  if (lastAction) historyRows.push({ label: t("rooms.work.roomInfo.lastAction"), value: lastAction });
  const started = formatClock(session?.startedAt, ctx);
  if (started && session && !session.completionConfirmed) historyRows.push({ label: t("rooms.work.roomInfo.cleaningStarted"), value: started });
  const lastCleaned = formatClock(room.last_cleaned_at, ctx);
  if (lastCleaned) historyRows.push({ label: t("rooms.work.roomInfo.lastCleaned"), value: lastCleaned });
  const lastInspected = formatClock(room.last_inspected_at, ctx);
  if (lastInspected) historyRows.push({ label: t("rooms.work.roomInfo.lastInspected"), value: lastInspected });

  const notes: Row[] = [];
  if (room.priority_note?.trim()) notes.push({ label: t("rooms.dash.rush.noteLabel"), value: room.priority_note.trim() });
  if (room.latest_note?.trim()) notes.push({ label: t("rooms.detail.warnings.note.label"), value: room.latest_note.trim() });
  if (room.open_work_order_title || room.open_work_order_number) {
    const number = room.open_work_order_number ? ` #${room.open_work_order_number}` : "";
    notes.push({ label: t("rooms.detail.warnings.workOrder.label"), value: `${room.open_work_order_title ?? ""}${number}`.trim() });
  }

  const inspection = room.reclean_details;
  const inspectionRows: Row[] = [];
  if (inspection) {
    const when = formatClock(inspection.inspected_at, ctx);
    if (when) inspectionRows.push({ label: t("rooms.work.roomInfo.inspectedAt"), value: when });
    for (const item of inspection.items ?? []) {
      inspectionRows.push({ label: item.label, value: item.note?.trim() || t("rooms.dash.detail.reclean.toFix") });
    }
    if (inspection.notes?.trim()) inspectionRows.push({ label: t("rooms.dash.detail.reclean.inspectorNotes"), value: inspection.notes.trim() });
  }

  function Section({ title, rows }: { title: string; rows: Row[] }) {
    if (rows.length === 0) return null;
    return (
      <View style={[styles.section, { backgroundColor: theme.surfaceSubtle, borderColor: theme.borderSubtle }]}>
        <Text accessibilityRole="header" maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.sectionTitle, { color: theme.textMuted }]}>
          {title}
        </Text>
        {rows.map((row, index) => (
          <View key={`${row.label}-${index}`} style={styles.row} accessible accessibilityLabel={`${row.label}: ${row.value}`}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowLabel, { color: theme.textMuted }]}>
              {row.label}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.rowValue, { color: theme.textPrimary }]}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <BottomSheet visible={visible} title={t("rooms.work.roomInfo.title", { room: room.room_number })} onClose={onClose} testID="room-info-sheet">
      <Section title={t("rooms.work.roomInfo.sections.room")} rows={roomRows} />
      <Section title={t("rooms.work.roomInfo.sections.frontDesk")} rows={deskRows} />
      <Section title={t("rooms.work.roomInfo.sections.instructions")} rows={notes} />
      <Section title={t("rooms.work.roomInfo.sections.inspection")} rows={inspectionRows} />
      <Section title={t("rooms.work.roomInfo.sections.history")} rows={historyRows} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  sectionTitle: { fontSize: 11, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12, minHeight: 28 },
  rowLabel: { flexShrink: 0, maxWidth: "45%", fontSize: 13, fontWeight: "700" },
  rowValue: { flex: 1, fontSize: 14, fontWeight: "700", textAlign: "right", lineHeight: 20 },
});
