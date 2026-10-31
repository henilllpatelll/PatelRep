import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import { BottomSheet, MAX_FONT_SCALE } from "@/components/housekeeping/roomDetail/BottomSheet";
import { Button } from "@/components/ui/Button";
import { useTheme } from "@/lib/theme/useTheme";
import { FieldLabel, InlineError, Note, TextArea, sheetStyles } from "@/components/engineering/workorder/sheetKit";
import { useSheetSubmit } from "@/components/engineering/workorder/useSheetSubmit";
import { getActiveRoomPeriod, releaseRoomUnavailability, type RoomPeriod } from "@/lib/api/engineeringRooms";
import {
  NOTE_MAX,
  buildReleaseBody,
  canConfirmRelease,
  interpretRelease,
  needsOpenRepairAcknowledgement,
  releaseBlock,
  type ReleaseFacts,
} from "@/lib/engineering/roomAvailability";
import { workOrderLabel } from "@/lib/engineering/workQueue";
import type { WorkOrder, WorkOrderStatus } from "@/lib/engineering/workOrders";
import { formatWhen } from "./roomUi";

interface Props {
  visible: boolean;
  roomId: string;
  roomNumber: string;
  isOnline: boolean;
  locale: string;
  period: RoomPeriod | null;
  /** Active repairs in the room the viewer can open. */
  repairs: readonly WorkOrder[];
  /** Active repairs a colleague holds that the viewer cannot open. */
  hiddenActiveCount: number;
  onClose: () => void;
  onChanged: () => void;
}

type Result = { kind: "released"; roomStatus: string | null } | { kind: "already_returned" };

/**
 * Review Room Restoration. Returning a room is a deliberate, recorded step: the repair it was opened for must be
 * finished, the person confirms they checked the room, and any other open repair is acknowledged. The server then
 * ends the period and hands the room to housekeeping as DIRTY; this sheet reports exactly that, never "clean" or
 * "ready to sell", and never claims the PMS was updated.
 */
export function RoomReleaseSheet({ visible, roomId, roomNumber, isOnline, locale, period, repairs, hiddenActiveCount, onClose, onChanged }: Props) {
  const { t } = useTranslation();
  const theme = useTheme();
  const [verified, setVerified] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const { busy, error, setError, run } = useSheetSubmit();
  const wasVisible = useRef(false);

  useEffect(() => {
    if (visible && !wasVisible.current) {
      setVerified(false);
      setAcknowledged(false);
      setNotes("");
      setResult(null);
      setError(null);
    }
    wasVisible.current = visible;
  }, [visible, setError]);

  const primary = period?.work_orders ?? null;
  const primaryId = period?.primary_work_order_id ?? primary?.id ?? null;
  const others = repairs.filter((wo) => wo.id !== primaryId);
  const facts: ReleaseFacts = {
    primaryStatus: (primary?.status as WorkOrderStatus | null | undefined) ?? null,
    primaryHidden: Boolean(primaryId && !primary),
    otherActiveCount: others.length,
    hiddenActiveCount,
  };
  const blocked = releaseBlock(facts);
  const needsAck = needsOpenRepairAcknowledgement(facts);
  const ready = canConfirmRelease(facts, { verified, acknowledgedOpenRepairs: acknowledged }) && Boolean(period?.id) && isOnline;

  async function confirm() {
    if (!period?.id || !ready) return;
    const periodId = period.id;
    await run(async () => {
      try {
        const answer = await releaseRoomUnavailability(periodId, buildReleaseBody(notes));
        const outcome = interpretRelease(answer);
        if (!outcome) throw new Error(t("engRooms.release.noAnswer"));
        setResult(outcome);
        onChanged();
      } catch (err) {
        const status = (err as { status?: unknown } | null)?.status;
        // The server may have released it before the answer was lost, or someone else did: ask the room.
        let active: RoomPeriod | null | undefined;
        try {
          active = await getActiveRoomPeriod(roomId);
        } catch {
          throw typeof status === "number" && status < 500 ? err : new Error(t("engRooms.release.unconfirmed"));
        }
        if (active && active.id === periodId) throw err; // still down: nothing was released
        setResult({ kind: "already_returned" });
        onChanged();
      }
    });
  }

  const footer = result ? (
    <Button label={t("common.done")} onPress={onClose} size="lg" testID="release-done" />
  ) : (
    <View style={sheetStyles.stack}>
      <Button label={t("engRooms.release.confirm")} onPress={confirm} loading={busy} disabled={busy || !ready} size="lg" testID="release-confirm" />
      <Button label={t("common.cancel")} variant="ghost" onPress={onClose} disabled={busy} testID="release-cancel" />
    </View>
  );

  return (
    <BottomSheet visible={visible} title={t("engRooms.release.title")} onClose={onClose} tall footer={footer} scrollKey={`${result ? "done" : "form"}:${error ?? ""}`} testID="release-sheet">
      <View style={sheetStyles.stack}>
        {result ? (
          <View style={sheetStyles.stack} accessibilityLiveRegion="polite" testID="release-result">
            <View style={styles.row}>
              <Ionicons name="checkmark-circle" size={22} color={theme.status.ready} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} accessibilityRole="header" style={[styles.doneTitle, { color: theme.textPrimary }]}>
                {result.kind === "released" ? t("engRooms.release.doneTitle", { room: roomNumber }) : t("engRooms.release.alreadyTitle", { room: roomNumber })}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20 }}>
              {result.kind === "released"
                ? t("engRooms.release.doneBody", { status: t(`roomStatus.statusLabels.${result.roomStatus ?? "DIRTY"}`, { defaultValue: result.roomStatus ?? "" }) })
                : t("engRooms.release.alreadyBody")}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }}>
              {t("engRooms.pmsNote")}
            </Text>
          </View>
        ) : (
          <>
            {!isOnline ? <Note tone="warn" testID="release-offline">{t("engRooms.release.offline")}</Note> : null}
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.heading, { color: theme.textPrimary }]}>
              {t("engRooms.release.record", { room: roomNumber })}
            </Text>
            {period ? (
              <View style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surfaceSubtle }]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
                  {t(`engRooms.down.types.${period.type}`)}
                  {period.reason_label ? ` — ${period.reason_label}` : ""}
                </Text>
                {period.started_at ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13 }}>
                    {t("engRooms.release.since", { time: formatWhen(period.started_at, locale) })}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <FieldLabel>{t("engRooms.release.linkedRepair")}</FieldLabel>
            {primary ? (
              <View style={[styles.card, { borderColor: blocked ? theme.status.dirty : theme.border, backgroundColor: theme.surfaceSubtle }]}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.cardTitle, { color: theme.textPrimary }]}>
                  {[primary.work_order_number ? `WO-${String(primary.work_order_number).replace(/^WO-/i, "")}` : null, primary.title].filter(Boolean).join(" · ")}
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: blocked ? theme.status.dirty : theme.textMuted, fontSize: 13, fontWeight: blocked ? "700" : "400" }}>
                  {t(`workOrders.status.${primary.status}`, { defaultValue: String(primary.status ?? "") })}
                </Text>
              </View>
            ) : (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13.5 }}>
                {t("engRooms.release.noLinkedRepair")}
              </Text>
            )}
            {blocked ? <InlineError testID="release-blocked">{t("engRooms.release.blocked")}</InlineError> : null}

            {others.length > 0 || hiddenActiveCount > 0 ? (
              <View style={sheetStyles.stack}>
                <FieldLabel>{t("engRooms.release.otherOpen")}</FieldLabel>
                {others.map((wo) => (
                  <Text key={wo.id} maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textPrimary, fontSize: 13.5 }}>
                    {[workOrderLabel(wo), wo.title].filter(Boolean).join(" · ")}
                  </Text>
                ))}
                {hiddenActiveCount > 0 ? (
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 13 }}>
                    {t("engRooms.withColleagues", { count: hiddenActiveCount })}
                  </Text>
                ) : null}
              </View>
            ) : null}

            <Check checked={verified} onToggle={() => setVerified((v) => !v)} label={t("engRooms.release.verify")} disabled={busy || Boolean(blocked)} testID="release-verify" />
            {needsAck ? (
              <Check checked={acknowledged} onToggle={() => setAcknowledged((v) => !v)} label={t("engRooms.release.acknowledge")} disabled={busy || Boolean(blocked)} testID="release-acknowledge" />
            ) : null}

            <FieldLabel>{t("engRooms.release.notes")}</FieldLabel>
            <TextArea value={notes} onChangeText={setNotes} maxLength={NOTE_MAX} editable={!busy} placeholder={t("engRooms.release.notesPlaceholder")} accessibilityLabel={t("engRooms.release.notes")} testID="release-notes" />

            <View style={[styles.impact, { backgroundColor: theme.status.pickupSoft }]}>
              <Ionicons name="information-circle-outline" size={16} color={theme.status.pickup} />
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.impactText, { color: theme.textPrimary }]}>
                {t("engRooms.release.impact")}
              </Text>
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: theme.textMuted, fontSize: 12.5 }}>
              {t("engRooms.pmsNote")}
            </Text>
          </>
        )}
        {error ? <InlineError testID="release-error">{error}</InlineError> : null}
      </View>
    </BottomSheet>
  );
}

function Check({ checked, onToggle, label, disabled, testID }: { checked: boolean; onToggle: () => void; label: string; disabled?: boolean; testID: string }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      accessibilityLabel={label}
      testID={testID}
      style={[styles.check, { borderColor: checked ? theme.primaryLine : theme.border, backgroundColor: checked ? theme.primarySoft : theme.surfaceSubtle, opacity: disabled ? 0.5 : 1 }]}
    >
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? theme.primaryAction : theme.textMuted} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.checkText, { color: theme.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  doneTitle: { fontSize: 17, fontWeight: "700", flex: 1 },
  heading: { fontSize: 15, fontWeight: "700" },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 3 },
  cardTitle: { fontSize: 14.5, fontWeight: "700" },
  check: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  checkText: { flex: 1, fontSize: 14, lineHeight: 19 },
  impact: { flexDirection: "row", gap: 8, padding: 12, borderRadius: 12, alignItems: "flex-start" },
  impactText: { flex: 1, fontSize: 13.5, lineHeight: 19 },
});
